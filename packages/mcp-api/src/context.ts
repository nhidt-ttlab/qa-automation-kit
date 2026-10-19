import path from 'node:path';
import { AuditLog, createAuthProviders, newRunId, type AuthProvider, type AuthSource, type LoadedProjectConfig } from '@qakit/core';
import type { WriteGateOptions } from './executor.js';
import { OpenApiLoader } from './openapi.js';
import {
  ActionRegistry,
  BusinessGraph,
  DomainRegistry,
  buildFieldDependencyIndex,
  loadDomains,
  loadEdges,
  loadFieldDependencies,
} from './registry.js';
import { apiSourcesFromConfig, authSourcesFromConfig, type ApiSource } from './sources.js';
import type { DependencyEdge, Domain, FieldDependency } from './types.js';

export interface ApiMcpContext {
  domainRegistry: DomainRegistry;
  businessGraph: BusinessGraph;
  apiSources: Map<string, ApiSource>;
  fieldDependencyIndex: Map<string, FieldDependency>;
  openApiLoader: OpenApiLoader;
  actionRegistry: ActionRegistry;
  /** Keyed by config id (`ApiSource.configId`). */
  authProviders: Map<string, AuthProvider>;
  writeGate: WriteGateOptions;
  audit: AuditLog;
  fetchImpl: typeof fetch;
}

export interface ApiMcpContextOptions {
  domains: Domain[];
  edges: DependencyEdge[];
  apiSources: Map<string, ApiSource>;
  authSources: Record<string, AuthSource>;
  fieldDependencies?: FieldDependency[];
  cacheDir: string;
  auditPath: string;
  writeGate: WriteGateOptions;
  actionTtlMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

/** Builds the cheap, metadata-only registries once. No network calls happen here. */
export function createApiMcpContext(options: ApiMcpContextOptions): ApiMcpContext {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    domainRegistry: new DomainRegistry(options.domains),
    businessGraph: new BusinessGraph(options.edges),
    apiSources: options.apiSources,
    fieldDependencyIndex: buildFieldDependencyIndex(options.fieldDependencies ?? []),
    openApiLoader: new OpenApiLoader(options.cacheDir, env, fetchImpl),
    actionRegistry: new ActionRegistry(options.actionTtlMs),
    authProviders: createAuthProviders(options.authSources, { env }),
    writeGate: options.writeGate,
    audit: new AuditLog(options.auditPath),
    fetchImpl,
  };
}

/** Everything `qakit.config.yaml` says about the API MCP server. */
export function apiMcpContextOptionsFromConfig(loaded: LoadedProjectConfig, env: NodeJS.ProcessEnv = process.env): ApiMcpContextOptions {
  const { api, paths } = loaded.config;
  const optionalPath = (value: string | undefined): string | undefined => (value === undefined ? undefined : loaded.resolvePath(value));
  return {
    domains: loadDomains(optionalPath(api.domainsDir)),
    edges: loadEdges(optionalPath(api.businessGraph)),
    apiSources: apiSourcesFromConfig(loaded),
    authSources: authSourcesFromConfig(loaded),
    fieldDependencies: loadFieldDependencies(optionalPath(api.fieldDependencies)),
    cacheDir: loaded.resolvePath(api.cacheDir),
    auditPath: path.join(loaded.resolvePath(paths.evidence), 'mcp-api-sessions', newRunId(), 'audit.jsonl'),
    writeGate: {
      allowWrites: api.allowWrites || (api.allowWritesEnv !== undefined && env[api.allowWritesEnv] === '1'),
      readOnlyPostPatterns: api.readOnlyPostPatterns.map((pattern) => new RegExp(pattern)),
      destructiveOperations: new RegExp(api.destructiveOperations, 'i'),
    },
    actionTtlMs: api.actionTtlSeconds * 1000,
    env,
  };
}
