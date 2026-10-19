import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStderrLogger, installStdoutGuard, loadProjectConfig, loadProjectConfigWithEnv, type LoadedProjectConfig } from '@qakit/core';
import { stringify } from 'yaml';
import { apiMcpContextOptionsFromConfig, createApiMcpContext, type ApiMcpContext } from './context.js';
import { generateSwaggerDocs, type DocgenSource } from './docgen.js';
import { loadDomainFileMapping, type DomainFileMapping } from './domain-file-mapping.js';
import { bootstrapDomainsFromOpenApi, generateDomainsFromMetadata, generateFieldDependencies, writeDomainFiles } from './generators.js';
import { OpenApiLoader, type OpenApiDocument } from './openapi.js';
import { loadDomains } from './registry.js';
import { apiSourcesFromConfig } from './sources.js';
import { registerApiTools } from './tools.js';

interface ParsedArgs {
  configPath?: string;
  environment?: string;
  flags: Set<string>;
  positional: string[];
}

const VALUE_OPTIONS = new Set(['--config', '--env']);

export function parseApiArgs(argv: readonly string[], allowedFlags: readonly string[] = []): ParsedArgs {
  const parsed: ParsedArgs = { flags: new Set(), positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const [name, inline] = arg.split(/=(.*)/s, 2) as [string, string | undefined];
    if (VALUE_OPTIONS.has(name)) {
      const value = inline ?? argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value.`);
      if (name === '--config') parsed.configPath = value;
      else parsed.environment = value;
      if (inline === undefined) i += 1;
    } else if (arg.startsWith('--')) {
      if (!allowedFlags.includes(arg)) throw new Error(`Unknown argument "${arg}".`);
      parsed.flags.add(arg);
    } else {
      parsed.positional.push(arg);
    }
  }
  return parsed;
}

const configPathOf = (parsed: ParsedArgs): string => path.resolve(parsed.configPath ?? process.env.QAKIT_CONFIG ?? 'qakit.config.yaml');

export function createApiMcpServer(ctx: ApiMcpContext, info: { name: string; version?: string }): McpServer {
  const server = new McpServer({ name: info.name, version: info.version ?? '0.1.0' });
  registerApiTools(server, ctx);
  return server;
}

/** `qakit-mcp-api --config <qakit.config.yaml> [--env <name>]` — the API MCP server over stdio. */
export async function runApiMcpCli(options: { argv?: readonly string[]; configPath?: string; environment?: string } = {}): Promise<void> {
  // Must run before anything else can log: stdout is the JSON-RPC channel.
  installStdoutGuard();
  const parsed = parseApiArgs(options.argv ?? []);
  const logger = createStderrLogger();
  const loaded = loadProjectConfigWithEnv({
    configPath: options.configPath ?? configPathOf(parsed),
    environment: options.environment ?? parsed.environment,
  });
  const ctx = createApiMcpContext(apiMcpContextOptionsFromConfig(loaded));
  const server = createApiMcpServer(ctx, { name: `${loaded.config.mcp.apiServerName}-mcp` });
  logger.info(
    `${loaded.config.mcp.apiServerName}-mcp ready — ${ctx.domainRegistry.list().length} domains, ` +
      `${ctx.apiSources.size} api sources, writes ${ctx.writeGate.allowWrites ? 'ENABLED' : 'blocked'}.`,
  );
  await server.connect(new StdioServerTransport());
}

export function docgenSourcesFromConfig(loaded: LoadedProjectConfig): DocgenSource[] {
  return [...apiSourcesFromConfig(loaded).values()].map((source) => ({
    id: source.id,
    repository: source.repository,
    requiresAuth: source.requiresAuth,
    specFileEnv: source.specFileEnv,
  }));
}

function mappingOf(loaded: LoadedProjectConfig, required: boolean): DomainFileMapping | null {
  const configured = loaded.config.api.docs.domainFileMapping;
  const mapping = loadDomainFileMapping(configured === undefined ? undefined : loaded.resolvePath(configured));
  if (!mapping && required) throw new Error('This command needs api.docs.domainFileMapping to point at an existing mapping file.');
  return mapping;
}

function domainsDirOf(loaded: LoadedProjectConfig): string {
  const dir = loaded.config.api.domainsDir;
  if (dir === undefined) throw new Error('Set api.domainsDir in the config first.');
  return loaded.resolvePath(dir);
}

const USAGE = [
  'Usage: qakit-api <command> --config <qakit.config.yaml> [--env <name>]',
  '  docgen                     OpenAPI files in api.docs.swaggerDir -> metadata/generated + docs under api.docs.outputDir',
  '  domains [--force]          bootstrap api.domainsDir from the live OpenAPI tags (existing files kept unless --force)',
  '  domains --from-metadata [--dry-run]  regenerate mapped domains from docgen metadata + api.docs.domainFileMapping',
  '  field-deps                 metadata/generated/*/dto-reference-graph.json -> api.fieldDependencies',
].join('\n');

/** `qakit-api <docgen|domains|field-deps>`. Returns the process exit code. */
export async function runApiToolsCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const parsed = parseApiArgs(rest, ['--force', '--from-metadata', '--dry-run']);
  const log = (line: string): void => console.log(line);

  switch (command) {
    case 'docgen': {
      // Offline and deterministic: no .env files, so committed output never depends on a local environment.
      const loaded = loadProjectConfig({ configPath: configPathOf(parsed), environment: parsed.environment });
      const { docs, domainsDir } = loaded.config.api;
      let mapping: DomainFileMapping | null = null;
      try {
        mapping = mappingOf(loaded, false);
      } catch (error) {
        console.warn(`Ignoring invalid domain-file mapping: ${error instanceof Error ? error.message : String(error)}`);
      }
      const outputRoot = loaded.resolvePath(docs.outputDir);
      const result = generateSwaggerDocs({
        sources: docgenSourcesFromConfig(loaded),
        domains: loadDomains(domainsDir === undefined ? undefined : loaded.resolvePath(domainsDir)),
        swaggerDir: loaded.resolvePath(docs.swaggerDir),
        outputRoot,
        mapping,
      });
      if (result.missingSwaggerFiles.length > 0) console.warn(`Missing swagger files for: ${result.missingSwaggerFiles.join(', ')}`);
      log(`Generated ${result.endpointsWritten} endpoints into ${outputRoot}`);
      return 0;
    }

    case 'domains': {
      if (parsed.flags.has('--from-metadata')) {
        const loaded = loadProjectConfig({ configPath: configPathOf(parsed), environment: parsed.environment });
        generateDomainsFromMetadata({
          metadataRoot: loaded.resolvePath(loaded.config.api.docs.outputDir),
          mapping: mappingOf(loaded, true)!,
          domainsDir: domainsDirOf(loaded),
          dryRun: parsed.flags.has('--dry-run'),
          log,
        });
        return 0;
      }
      const loaded = loadProjectConfigWithEnv({ configPath: configPathOf(parsed), environment: parsed.environment });
      const loader = new OpenApiLoader(loaded.resolvePath(loaded.config.api.cacheDir));
      const entries: Array<{ sourceId: string; document: OpenApiDocument }> = [];
      for (const source of apiSourcesFromConfig(loaded).values()) {
        try {
          entries.push({ sourceId: source.id, document: (await loader.get(source)).document });
        } catch (error) {
          console.warn(`Skipping "${source.id}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const domains = bootstrapDomainsFromOpenApi(entries);
      const header = '# Bootstrapped from OpenAPI tags by `qakit-api domains` — review, regroup and add dependsOn.\n';
      const { written, skipped } = writeDomainFiles(domains, domainsDirOf(loaded), { force: parsed.flags.has('--force'), header });
      log(`Wrote ${written.length} domain files${skipped.length > 0 ? `, kept ${skipped.length} existing (use --force to overwrite)` : ''}.`);
      return 0;
    }

    case 'field-deps': {
      const loaded = loadProjectConfig({ configPath: configPathOf(parsed), environment: parsed.environment });
      const target = loaded.config.api.fieldDependencies;
      if (target === undefined) throw new Error('Set api.fieldDependencies in the config first.');
      const entries = generateFieldDependencies(loaded.resolvePath(loaded.config.api.docs.outputDir), mappingOf(loaded, false), apiSourcesFromConfig(loaded).values());
      const header = [
        '# Generated file — do not hand-edit blindly.',
        '# Source: metadata/generated/*/dto-reference-graph.json',
        '# Regenerate: qakit-api field-deps --config <qakit.config.yaml>',
        '',
      ].join('\n');
      writeFileSync(loaded.resolvePath(target), header + stringify({ entries }, { lineWidth: 100 }), 'utf8');
      log(`Wrote ${entries.length} field dependencies.`);
      return 0;
    }

    default:
      console.error(USAGE);
      return command === undefined || command === '--help' ? 0 : 1;
  }
}
