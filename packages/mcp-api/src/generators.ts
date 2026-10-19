import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { humanize, slugify } from './docgen.js';
import {
  getMergeEntriesForFile,
  getSummaryOverrideForFile,
  resolveDomainForEndpoint,
  stripResourceSuffix,
  type DomainFileMapping,
  type NewDomainSpec,
} from './domain-file-mapping.js';
import type { OpenApiDocument } from './openapi.js';
import type { Capability, Domain, FieldDependency } from './types.js';

const generatedRoot = (metadataRoot: string): string => join(metadataRoot, 'metadata', 'generated');

/* --------------------------------------------------------------------------------------------- *
 * Domains from OpenAPI tags — a working domain set for a project with nothing but a spec
 * --------------------------------------------------------------------------------------------- */

const OPERATION_KEYS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * One domain per OpenAPI tag (first tag of each operation), one capability per operation. A
 * mechanical starting point: names come straight from the spec and every domain is marked
 * `confidence: inferred` for a human to review and regroup.
 */
export function bootstrapDomainsFromOpenApi(entries: Array<{ sourceId: string; document: OpenApiDocument }>): Domain[] {
  const byId = new Map<string, Domain>();
  for (const { sourceId, document } of entries) {
    for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
      if (!pathItem) continue;
      for (const key of OPERATION_KEYS) {
        const operation = pathItem[key];
        if (!operation) continue;
        const tag = operation.tags?.[0] ?? path.split('/').filter((s) => s && !s.startsWith('{')).at(-1) ?? 'default';
        const id = slugify(tag) || 'default';
        let domain = byId.get(id);
        if (!domain) {
          domain = {
            id,
            displayName: humanize(tag),
            description: `Operations tagged "${tag}" in the ${sourceId} API.`,
            apiSourceIds: [],
            capabilities: [],
            tags: [id],
            dependsOn: [],
            status: 'active',
            confidence: 'inferred',
            notes: 'Bootstrapped from OpenAPI tags by `qakit-api domains`; review names, descriptions, capabilities and dependsOn.',
          };
          byId.set(id, domain);
        }
        if (!domain.apiSourceIds.includes(sourceId)) domain.apiSourceIds.push(sourceId);
        const capabilityId = slugify(operation.operationId ?? `${key} ${path.replace(/[/{}]+/g, ' ')}`);
        if (!domain.capabilities.some((c) => c.id === capabilityId)) {
          const capability: Capability = { id: capabilityId, summary: operation.summary?.trim() || `${key.toUpperCase()} ${path}`, status: 'active', source: tag };
          domain.capabilities.push(capability);
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Writes `<domainsDir>/<id>.yaml` per domain; existing files are kept unless `force`. */
export function writeDomainFiles(domains: Domain[], domainsDir: string, options: { force?: boolean; header?: string } = {}): { written: string[]; skipped: string[] } {
  mkdirSync(domainsDir, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  for (const domain of domains) {
    const file = join(domainsDir, `${domain.id}.yaml`);
    if (existsSync(file) && !options.force) {
      skipped.push(file);
      continue;
    }
    writeFileSync(file, `${options.header ?? ''}${stringify(domain, { lineWidth: 100 })}`, 'utf8');
    written.push(file);
  }
  return { written, skipped };
}

/* --------------------------------------------------------------------------------------------- *
 * Domains from generated metadata + the domain-file mapping
 * --------------------------------------------------------------------------------------------- */

interface EndpointRecord {
  repo: string;
  domain: string;
  controller?: string;
  http_method?: string;
  path?: string;
}

function listGeneratedFiles(metadataRoot: string): Array<{ repo: string; file: string }> {
  const root = generatedRoot(metadataRoot);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((repo) =>
      readdirSync(join(root, repo.name))
        .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
        .map((name) => ({ repo: repo.name, file: name.replace(/\.ya?ml$/i, '') })),
    );
}

function readEndpoints(metadataRoot: string, repo: string, file: string): EndpointRecord[] {
  const raw = parse(readFileSync(join(generatedRoot(metadataRoot), repo, `${file}.yaml`), 'utf8')) as { endpoints?: EndpointRecord[] };
  return raw.endpoints ?? [];
}

function assertNoDuplicateFiles(mapping: DomainFileMapping): void {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  const record = (file: string, owner: string): void => {
    const previous = seen.get(file);
    if (previous && previous !== owner) {
      duplicates.push(`${file} assigned to both "${previous}" and "${owner}"`);
      return;
    }
    seen.set(file, owner);
  };
  for (const [domainId, files] of Object.entries(mapping.existingDomainFiles)) for (const file of files) record(file, domainId);
  // Shared files are owned by their default domain; their entry only adds per-endpoint claim rules.
  for (const shared of mapping.sharedFiles) record(shared.file, shared.defaultDomain);
  for (const domain of mapping.newDomains) for (const file of domain.files) record(file, domain.id);
  if (duplicates.length > 0) throw new Error(`Duplicate file assignments in the domain-file mapping:\n${duplicates.join('\n')}`);
}

function findOrphanFiles(metadataRoot: string, mapping: DomainFileMapping): string[] {
  const indexed = new Set<string>();
  for (const files of Object.values(mapping.existingDomainFiles)) for (const file of files) indexed.add(file);
  for (const shared of mapping.sharedFiles) indexed.add(shared.file);
  for (const domain of mapping.newDomains) for (const file of domain.files) indexed.add(file.replace(/\.yaml$/i, ''));
  return listGeneratedFiles(metadataRoot)
    .map(({ repo, file }) => `${repo}/${file}`)
    .filter((key) => !indexed.has(key));
}

function buildCapabilitiesForFile(metadataRoot: string, mapping: DomainFileMapping, spec: NewDomainSpec, fileKey: string): Capability[] {
  const slashIndex = fileKey.indexOf('/');
  const repo = fileKey.slice(0, slashIndex);
  const fileSlug = fileKey.slice(slashIndex + 1);

  const sharedRule = mapping.sharedFiles.find((rule) => rule.file === fileKey);
  const claimedSuffixes = new Set((sharedRule?.claims ?? []).flatMap((claim) => claim.suffixes));

  const endpoints = readEndpoints(metadataRoot, repo, fileSlug);
  if (endpoints.length === 0) throw new Error(`No endpoints found in ${repo}/${fileSlug}.yaml — mapping may be stale.`);

  const controller = endpoints.find((endpoint) => endpoint.controller)?.controller;
  const summaryOverride = getSummaryOverrideForFile(mapping, repo, fileSlug);

  if (spec.tier === 'a') {
    return [{ id: `manage-${fileSlug}`, summary: summaryOverride ?? `Manage ${humanize(fileSlug)}`, status: 'active', source: controller }];
  }

  const mergeEntries = getMergeEntriesForFile(mapping, repo, fileSlug);
  const groups = new Map<string, Capability>();
  let crudCount = 0;

  for (const endpoint of endpoints) {
    if (!endpoint.path) continue;
    const suffix = stripResourceSuffix(endpoint.path, fileSlug);
    // Endpoints claimed by another domain (shared files) are not capabilities here.
    if (claimedSuffixes.has(suffix)) continue;

    if (suffix === '') {
      crudCount += 1;
      groups.set(`manage-${fileSlug}`, {
        id: `manage-${fileSlug}`,
        summary: summaryOverride ?? `Create, read, update and delete ${humanize(fileSlug)} records`,
        status: 'active',
        source: controller,
      });
      continue;
    }

    const override = mergeEntries.find((entry) => entry.suffixes.includes(suffix));
    const capabilityId = override?.capabilityId ?? `${suffix}-${fileSlug}`;
    const summary = override?.summary ?? `${humanize(suffix)} (${humanize(fileSlug)})`;
    groups.set(capabilityId, { id: capabilityId, summary, status: 'active', source: controller });
  }

  if (crudCount === 0) groups.delete(`manage-${fileSlug}`);
  return Array.from(groups.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export interface GenerateDomainsFromMetadataOptions {
  /** Folder holding `metadata/generated/<repository>/*.yaml` (docgen's output root). */
  metadataRoot: string;
  mapping: DomainFileMapping;
  domainsDir: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}

/**
 * Regenerates `<domainsDir>/<id>.yaml` for every domain under `newDomains` in the mapping.
 *
 * Capability granularity: tier A (CRUD/reference domains) gets one `manage-<resource>` capability
 * per file; tier B (workflow-rich domains) collapses the plain-CRUD group into `manage-<resource>`
 * and groups the remaining endpoints by exact leftover path suffix, with the mapping's merge-group
 * overrides. Hand-maintained domains (`existingDomainFiles`) are never touched.
 */
export function generateDomainsFromMetadata(options: GenerateDomainsFromMetadataOptions): Array<{ id: string; capabilities: Capability[] }> {
  const { metadataRoot, mapping } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  assertNoDuplicateFiles(mapping);

  const orphans = findOrphanFiles(metadataRoot, mapping);
  if (orphans.length > 0) {
    throw new Error(`Unmapped metadata/generated files detected — add them to the domain-file mapping first:\n${orphans.join('\n')}`);
  }

  const results: Array<{ id: string; capabilities: Capability[] }> = [];
  for (const spec of mapping.newDomains) {
    const capabilities = spec.files.flatMap((file) => buildCapabilitiesForFile(metadataRoot, mapping, spec, file));
    const ids = new Set<string>();
    for (const capability of capabilities) {
      if (ids.has(capability.id)) throw new Error(`Duplicate capability id "${capability.id}" in domain "${spec.id}".`);
      ids.add(capability.id);
    }
    log(`${spec.id}: ${capabilities.length} capabilities from ${spec.files.length} files`);
    results.push({ id: spec.id, capabilities });

    if (options.dryRun) {
      for (const capability of capabilities) log(`  - ${capability.id}: ${capability.summary}`);
      continue;
    }

    const domain = {
      id: spec.id,
      displayName: spec.displayName,
      description: spec.description,
      apiSourceIds: spec.apiSourceIds,
      dependsOn: [] as string[],
      tags: spec.tags,
      status: 'active' as const,
      confidence: 'inferred' as const,
      notes:
        'Generated by qakit-api domains --from-metadata from metadata/generated data. ' +
        'Mechanical provenance — capability coverage is source-grounded, but display/summary ' +
        'wording has not been human-reviewed yet.',
      capabilities,
    };
    const header = [
      '# Generated file — do not hand-edit blindly.',
      '# Source: the domain-file mapping + metadata/generated/**.yaml',
      '# Regenerate: qakit-api domains --from-metadata --config <qakit.config.yaml>',
      '',
    ].join('\n');
    mkdirSync(options.domainsDir, { recursive: true });
    writeFileSync(join(options.domainsDir, `${spec.id}.yaml`), header + stringify(domain, { lineWidth: 100 }), 'utf8');
  }
  log(options.dryRun ? 'Dry run complete.' : `Wrote ${mapping.newDomains.length} domain files.`);
  return results;
}

/* --------------------------------------------------------------------------------------------- *
 * Field dependencies from DTO reference graphs
 * --------------------------------------------------------------------------------------------- */

interface DtoReferenceGraph {
  repo: string;
  endpointsById: Record<string, { id: string; method: string; path: string; tag: string }>;
  resourceIndex: Record<string, { name: string; referencedByFields: Array<{ dto: string; field: string; ambiguous: boolean }>; candidateEndpoints: string[] }>;
}

/**
 * Scans every repository's `metadata/generated/<repository>/dto-reference-graph.json` and resolves
 * each confidently-referenced field to a lookup endpoint and owning domain. Only same-repository
 * references resolve; a field whose lookup lives elsewhere is skipped, not guessed.
 */
export function generateFieldDependencies(
  metadataRoot: string,
  mapping: DomainFileMapping | null,
  sources: Iterable<{ id: string; repository: string }>,
  warn: (message: string) => void = (message) => console.error(message),
): FieldDependency[] {
  const sourceIdByRepo = new Map<string, string>();
  for (const source of sources) sourceIdByRepo.set(source.repository, source.id);

  const root = generatedRoot(metadataRoot);
  const repos = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];

  const entries = repos.flatMap((repo) => {
    const graphPath = join(root, repo, 'dto-reference-graph.json');
    if (!existsSync(graphPath)) return [];
    const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as DtoReferenceGraph;

    const apiSourceId = sourceIdByRepo.get(graph.repo);
    if (!apiSourceId) {
      warn(`field-deps: no api source declares repository "${graph.repo}" — skipping repository.`);
      return [];
    }

    const found: FieldDependency[] = [];
    const seenFieldNames = new Set<string>();
    for (const resource of Object.values(graph.resourceIndex)) {
      const endpointId = resource.candidateEndpoints[0];
      const endpoint = endpointId ? graph.endpointsById[endpointId] : undefined;
      if (!endpoint) continue;

      const fileSlug = slugify(endpoint.tag);
      const domainId = mapping ? resolveDomainForEndpoint(mapping, graph.repo, fileSlug, endpoint.path) : undefined;
      if (!domainId) {
        warn(
          `field-deps: could not resolve a domain for resource "${resource.name}" ` +
            `(endpoint ${endpoint.method} ${endpoint.path}, tag "${endpoint.tag}") — skipping.`,
        );
        continue;
      }

      for (const ref of resource.referencedByFields) {
        if (ref.ambiguous || seenFieldNames.has(ref.field)) continue;
        seenFieldNames.add(ref.field);
        found.push({
          fieldName: ref.field,
          resource: resource.name,
          repo: graph.repo,
          domainId,
          apiSourceId,
          lookupMethod: endpoint.method,
          lookupPath: endpoint.path,
          confidence: 'inferred',
        });
      }
    }
    return found;
  });

  return entries.sort((a, b) => a.fieldName.localeCompare(b.fieldName));
}
