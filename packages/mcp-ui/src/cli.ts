import path from 'node:path';
import { loadProjectAdapter, loadProjectConfigWithEnv } from '@qakit/core';
import { createDefaultUiMcpSetup, loadLocalePack, setupDefaultsFromConfig } from './default-setup.js';
import { createUiMcpServer, resolveUiMcpSetup, serveUiMcpOverStdio, type UiMcpSetup } from './server.js';
import { createStderrLogger, installStdoutGuard } from './stderr-logger.js';

export interface UiMcpCliArgs {
  configPath?: string;
  environment?: string;
}

/** `--config <path>` and `--env <name>`, also in `--flag=value` form. */
export function parseUiMcpArgs(argv: readonly string[]): UiMcpCliArgs {
  const args: UiMcpCliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s, 2) as [string, string | undefined];
    const value = inline ?? argv[i + 1];
    if (flag === '--config' || flag === '--env') {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
      if (flag === '--config') args.configPath = value;
      else args.environment = value;
      if (inline === undefined) i += 1;
    } else {
      throw new Error(`Unknown argument "${argv[i]}". Usage: qakit-mcp-ui --config <qakit.config.yaml> [--env <name>]`);
    }
  }
  return args;
}

export interface RunUiMcpCliOptions extends UiMcpCliArgs {
  argv?: readonly string[];
}

/**
 * Starts the UI MCP server over stdio for the project whose config is given by `--config`
 * (or `QAKIT_CONFIG`, or `./qakit.config.yaml`). The config's `envFiles` are loaded first.
 * The project's adapter supplies the setup through `mcpUi`; without it a generic setup is built.
 */
export async function runUiMcpCli(options: RunUiMcpCliOptions = {}): Promise<void> {
  // Must run before anything else can log: stdout is the JSON-RPC channel.
  installStdoutGuard();

  const parsed = parseUiMcpArgs(options.argv ?? []);
  const configPath = path.resolve(options.configPath ?? parsed.configPath ?? process.env.QAKIT_CONFIG ?? 'qakit.config.yaml');

  const logger = createStderrLogger();
  const loaded = loadProjectConfigWithEnv({ configPath, environment: options.environment ?? parsed.environment });
  const adapter = await loadProjectAdapter(loaded);
  const locale = await loadLocalePack(loaded);
  const context = { logger, locale };

  const setup = adapter?.mcpUi
    ? ((await adapter.mcpUi(loaded, context)) as UiMcpSetup)
    : createDefaultUiMcpSetup(loaded, adapter, context);
  if (!setup || typeof setup.openRuntime !== 'function' || typeof setup.writeRun !== 'function') {
    throw new Error(`Adapter "${adapter?.name}" mcpUi() must return a UiMcpSetup with openRuntime and writeRun.`);
  }

  const { defaults, overrides } = setupDefaultsFromConfig(loaded, locale);
  await serveUiMcpOverStdio(createUiMcpServer(resolveUiMcpSetup(setup, defaults, overrides)), logger);
}
