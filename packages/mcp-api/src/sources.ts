import type { AuthConfig, AuthSource, LoadedProjectConfig } from '@qakit/core';

/** One backend as the API MCP server sees it. */
export interface ApiSource {
  /** `mcpId` or the config key — what domains, actionIds and generated docs use. */
  id: string;
  /** The key in `apiSources`, which is also the auth provider's key. */
  configId: string;
  repository: string;
  requiresAuth: boolean;
  /** Read at call time, so env overrides set after startup are honoured. */
  baseUrl(): string;
  specUrl(): string;
  /** Env var naming a local spec file that replaces the network fetch. */
  specFileEnv?: string;
  cacheTtlSeconds: number;
  /** Env vars that would enable live calls, for explanations. */
  credentialEnvNames: string[];
}

const CREDENTIAL_FIELDS = ['staticTokenEnv', 'tokenEnv', 'keyEnv', 'usernameEnv', 'passwordEnv'] as const;

function credentialEnvNames(auth: AuthConfig, all: Record<string, { auth: AuthConfig }>): string[] {
  const names: string[] = [];
  const collect = (config: AuthConfig): void => {
    for (const field of CREDENTIAL_FIELDS) {
      const value = (config as Record<string, unknown>)[field];
      if (typeof value === 'string' && !names.includes(value)) names.push(value);
    }
  };
  collect(auth);
  if (auth.type === 'reuse') {
    const from = all[auth.from];
    if (from) collect(from.auth);
  }
  return names;
}

/** The config's api sources, keyed by the id the MCP server uses. */
export function apiSourcesFromConfig(loaded: LoadedProjectConfig): Map<string, ApiSource> {
  const { apiSources } = loaded.config;
  const map = new Map<string, ApiSource>();
  for (const [configId, source] of Object.entries(apiSources)) {
    const id = source.mcpId ?? configId;
    const baseUrl = (): string => loaded.resolveValue(source.baseUrl) ?? '';
    map.set(id, {
      id,
      configId,
      repository: source.repository ?? id,
      requiresAuth: source.auth.type !== 'none',
      baseUrl,
      specUrl: () => loaded.resolveValue(source.openapi?.url) ?? new URL(source.openapi?.path ?? '/openapi.json', baseUrl()).toString(),
      specFileEnv: source.openapi?.fileEnv,
      cacheTtlSeconds: source.openapi?.cacheTtlSeconds ?? 3600,
      credentialEnvNames: credentialEnvNames(source.auth, apiSources),
    });
  }
  return map;
}

/** The config's api sources in the shape `createAuthProviders` takes, keyed by config id. */
export function authSourcesFromConfig(loaded: LoadedProjectConfig): Record<string, AuthSource> {
  const sources: Record<string, AuthSource> = {};
  for (const [configId, source] of Object.entries(loaded.config.apiSources)) {
    sources[configId] = { baseUrl: loaded.resolveValue(source.baseUrl) ?? '', auth: source.auth };
  }
  return sources;
}
