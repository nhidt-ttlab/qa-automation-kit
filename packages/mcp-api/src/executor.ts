import type { AuthorizationParts } from '@qakit/core';
import type { ApiSource } from './sources.js';
import type { Tool } from './types.js';

export interface ExecuteParams {
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
}

export interface LiveExecutionResult {
  mode: 'live';
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

export interface StubExecutionResult {
  mode: 'stub';
  reason: string;
  wouldCall: { method: string; url: string; headers: Record<string, string>; body?: unknown };
  explanation: string;
}

export interface DeniedExecutionResult {
  mode: 'denied';
  reason: string;
  hint: string;
  wouldCall: { method: string; url: string; body?: unknown };
}

export type ExecutionResult = LiveExecutionResult | StubExecutionResult | DeniedExecutionResult;

function substitutePathParams(path: string, pathParams: Record<string, string | number> = {}): string {
  return path.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const value = pathParams[name];
    return value === undefined ? match : encodeURIComponent(String(value));
  });
}

export function buildRequestUrl(apiSource: Pick<ApiSource, 'baseUrl'>, tool: Tool, params: ExecuteParams): string {
  const url = new URL(substitutePathParams(tool.path, params.pathParams), apiSource.baseUrl());
  for (const [key, value] of Object.entries(params.query ?? {})) url.searchParams.set(key, String(value));
  return url.toString();
}

/** Sends the request with the source's credentials. Never throws: a failure comes back as `ok: false`. */
export async function executeLive(
  apiSource: Pick<ApiSource, 'baseUrl'>,
  tool: Tool,
  params: ExecuteParams,
  authorize: () => Promise<AuthorizationParts>,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveExecutionResult> {
  try {
    const auth = await authorize();
    const url = new URL(buildRequestUrl(apiSource, tool, params));
    // Credentials carried in the query (api-key sources) are added here only, never reported.
    for (const [key, value] of Object.entries(auth.query)) url.searchParams.set(key, value);
    const response = await fetchImpl(url, {
      method: tool.httpMethod,
      headers: { 'Content-Type': 'application/json', ...auth.headers },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
    });
    const text = await response.text();
    let data: unknown = text.length > 0 ? text : undefined;
    try {
      if (text.length > 0) data = JSON.parse(text);
    } catch {
      // Not JSON — keep the text.
    }
    return { mode: 'live', ok: response.status >= 200 && response.status < 300, status: response.status, data };
  } catch (err) {
    return { mode: 'live', ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** What a live call would send, when no credentials are configured. Never contains a token. */
export function buildStubResult(apiSource: ApiSource, tool: Tool, params: ExecuteParams): StubExecutionResult {
  const url = buildRequestUrl(apiSource, tool, params);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tool.requiresAuth) headers['Authorization'] = 'Bearer <redacted, not set>';
  const names = apiSource.credentialEnvNames;
  const reason = `no credentials are configured for "${apiSource.id}"`;
  return {
    mode: 'stub',
    reason,
    wouldCall: { method: tool.httpMethod, url, headers, body: params.body },
    explanation: `Would call ${tool.httpMethod} ${url}, but ${reason}.${names.length > 0 ? ` Set ${names.join(' / ')} to enable a live call.` : ''}`,
  };
}

export interface WriteGateOptions {
  allowWrites: boolean;
  /** POST paths that only read. */
  readOnlyPostPatterns: RegExp[];
  /** Matched against `operationId path summary`; a match needs `confirm: true`. */
  destructiveOperations: RegExp;
}

export type WriteGateDecision = { allowed: true } | { allowed: false; reason: string; hint: string };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Decides whether a live call may go out. Reads always may. Anything else needs writes enabled for
 * the server, and a destructive-looking operation additionally needs the caller's explicit
 * `confirm` — an agent that can reach a shared test environment must not delete or approve a
 * record on the strength of a ranking guess.
 */
export function checkWriteGate(tool: Tool, confirm: boolean | undefined, options: WriteGateOptions): WriteGateDecision {
  const method = tool.httpMethod.toUpperCase();
  if (SAFE_METHODS.has(method)) return { allowed: true };
  if (method === 'POST' && options.readOnlyPostPatterns.some((pattern) => pattern.test(tool.path))) return { allowed: true };

  if (!options.allowWrites) {
    return {
      allowed: false,
      reason: `${method} ${tool.path} changes data, and writes are disabled for this server.`,
      hint: 'Writes are off by default. Enable them explicitly for this server (api.allowWrites, or its allowWritesEnv switch) only for an environment whose data may change.',
    };
  }

  const destructive = method === 'DELETE' || options.destructiveOperations.test(`${tool.operationId} ${tool.path} ${tool.summary}`);
  if (destructive && confirm !== true) {
    return {
      allowed: false,
      reason: `${method} ${tool.path} looks destructive (${tool.operationId}).`,
      hint: 'Call again with confirm: true once the user has approved this exact call.',
    };
  }
  return { allowed: true };
}
