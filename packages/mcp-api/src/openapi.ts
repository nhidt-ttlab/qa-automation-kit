import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAPIV3 } from 'openapi-types';
import type { ApiSource } from './sources.js';
import type { Tool } from './types.js';

export type OpenApiDocument = OpenAPIV3.Document;

export interface CacheInfo {
  source: 'override' | 'cache' | 'network';
  fetchedAt: string;
  ageSeconds?: number;
}

export interface LoadResult {
  document: OpenApiDocument;
  cacheInfo: CacheInfo;
}

export function readFromCache(cacheDir: string, apiSourceId: string, ttlSeconds: number): { document: OpenApiDocument; ageSeconds: number } | null {
  const file = join(cacheDir, `${apiSourceId}.json`);
  if (!existsSync(file)) return null;
  const ageSeconds = (Date.now() - statSync(file).mtimeMs) / 1000;
  if (ageSeconds > ttlSeconds) return null;
  return { document: JSON.parse(readFileSync(file, 'utf8')) as OpenApiDocument, ageSeconds };
}

export function writeToCache(cacheDir: string, apiSourceId: string, document: OpenApiDocument): void {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, `${apiSourceId}.json`), JSON.stringify(document), 'utf8');
}

/**
 * Zero knowledge of domains, capabilities or the business graph — only `ApiSource` objects in, an
 * OpenAPI document out. Never called at startup; only on an actual tool call.
 */
export class OpenApiLoader {
  constructor(
    private readonly cacheDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get(apiSource: ApiSource, opts: { forceRefresh?: boolean } = {}): Promise<LoadResult> {
    const overridePath = apiSource.specFileEnv ? this.env[apiSource.specFileEnv] : undefined;
    if (overridePath) {
      const document = JSON.parse(readFileSync(overridePath, 'utf8')) as OpenApiDocument;
      return { document, cacheInfo: { source: 'override', fetchedAt: new Date().toISOString() } };
    }

    if (!opts.forceRefresh) {
      const cached = readFromCache(this.cacheDir, apiSource.id, apiSource.cacheTtlSeconds);
      if (cached) {
        return {
          document: cached.document,
          cacheInfo: { source: 'cache', fetchedAt: new Date(Date.now() - cached.ageSeconds * 1000).toISOString(), ageSeconds: cached.ageSeconds },
        };
      }
    }

    const url = apiSource.specUrl();
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Failed to fetch OpenAPI spec from ${url}: ${response.status} ${response.statusText}`);
    const document = (await response.json()) as OpenApiDocument;
    writeToCache(this.cacheDir, apiSource.id, document);
    return { document, cacheInfo: { source: 'network', fetchedAt: new Date().toISOString() } };
  }
}

/* --------------------------------------------------------------------------------------------- *
 * Ranking
 * --------------------------------------------------------------------------------------------- */

const MIN_STEMMABLE_LENGTH = 4;
const NON_PLURAL_S_ENDINGS = ['ss', 'us', 'is']; // status, address, campus, analysis...

function stem(token: string): string {
  if (token.length < MIN_STEMMABLE_LENGTH) return token;
  if (NON_PLURAL_S_ENDINGS.some((suffix) => token.endsWith(suffix))) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`; // categories -> category
  if (/(?:s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2); // statuses -> status
  if (token.endsWith('s')) return token.slice(0, -1); // projects -> project
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
    .map(stem);
}

/** Token-overlap score between free-text intent and a candidate's tags/operationId/summary. */
export function scoreIntentMatch(intent: string, fields: string[]): number {
  const intentTokens = new Set(tokenize(intent));
  if (intentTokens.size === 0) return 0;
  const fieldTokens = new Set(fields.flatMap((f) => tokenize(f)));
  let overlap = 0;
  for (const token of intentTokens) if (fieldTokens.has(token)) overlap += 1;
  return overlap;
}

const MAX_REF_DEPTH = 5;

function getRefTarget(spec: OpenApiDocument, ref: string): unknown {
  // Only local component refs are supported.
  let node: unknown = spec;
  for (const segment of ref.replace(/^#\//, '').split('/')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Bounded, cycle-safe $ref resolution — used only for the top-N candidates that survive ranking. */
export function resolveRefsDeep(spec: OpenApiDocument, node: unknown, depth = 0, visited: Set<string> = new Set()): unknown {
  if (depth > MAX_REF_DEPTH || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item) => resolveRefsDeep(spec, item, depth, visited));

  const obj = node as Record<string, unknown>;
  const ref = obj['$ref'];
  if (typeof ref === 'string') {
    if (visited.has(ref)) return { $circularRef: ref };
    const target = getRefTarget(spec, ref);
    if (target === undefined) return { $unresolvedRef: ref };
    const nextVisited = new Set(visited);
    nextVisited.add(ref);
    return resolveRefsDeep(spec, target, depth + 1, nextVisited);
  }

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) resolved[key] = resolveRefsDeep(spec, value, depth, visited);
  return resolved;
}

const HTTP_METHODS = Object.values(OpenAPIV3.HttpMethods);

interface OperationRecord {
  operationId: string;
  /** True when the spec had no real operationId. */
  operationIdIsFallback: boolean;
  method: string;
  path: string;
  tags: string[];
  summary: string;
  operation: OpenAPIV3.OperationObject;
}

function listOperations(spec: OpenApiDocument): OperationRecord[] {
  const records: OperationRecord[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as OpenAPIV3.PathItemObject)[method];
      if (!operation) continue;
      records.push({
        operationId: operation.operationId ?? `${method.toUpperCase()} ${path}`,
        operationIdIsFallback: operation.operationId === undefined,
        method: method.toUpperCase(),
        path,
        tags: operation.tags ?? [],
        summary: operation.summary ?? operation.description ?? '',
        operation,
      });
    }
  }
  return records;
}

// Authored summary/tags reflect a deliberate choice by the API author — most trustworthy. A
// synthetic fallback operationId is just "METHOD + path" glued together, so it earns partial
// credit; an authored operationId sits in between.
const SUMMARY_OR_TAG_WEIGHT = 3;
const OPERATION_ID_AUTHORED_WEIGHT = 1;
const OPERATION_ID_FALLBACK_WEIGHT = 0.5;

const LISTING_INTENT_TOKENS = new Set(['list', 'search', 'find', 'filter', 'query', 'browse', 'all', 'listing']);

function impliesListing(intentTokens: Set<string>): boolean {
  for (const token of intentTokens) if (LISTING_INTENT_TOKENS.has(token)) return true;
  return false;
}

const isBareCollectionPath = (path: string): boolean => !path.includes('{');
const pathDepth = (path: string): number => path.split('/').filter(Boolean).length;

// A bare (no {param}) GET path is structurally the canonical list/search endpoint for its resource.
// Nested sub-resource paths are also bare but deeper, so reward shallower bare-GET paths relative to
// the shallowest one in this operation set, tapering per extra segment — the true collection root
// wins close calls even when a deeper sub-resource's path text contains a stray keyword overlap.
const COLLECTION_BONUS_BASE = 2;
const COLLECTION_BONUS_DEPTH_PENALTY = 1;

function scoreOperationForIntent(intentTokens: Set<string>, record: OperationRecord, minBareCollectionDepth: number): number {
  if (intentTokens.size === 0) return 0;

  const summaryOrTagTokens = new Set([...tokenize(record.summary), ...record.tags.flatMap(tokenize)]);
  // For a fallback operationId, score against the raw path only — the HTTP verb is a mechanical
  // artifact of the fallback, not a deliberate word choice.
  const operationIdTokens = new Set(tokenize(record.operationIdIsFallback ? record.path : record.operationId));
  const operationIdWeight = record.operationIdIsFallback ? OPERATION_ID_FALLBACK_WEIGHT : OPERATION_ID_AUTHORED_WEIGHT;

  let score = 0;
  for (const token of intentTokens) {
    if (summaryOrTagTokens.has(token)) score += SUMMARY_OR_TAG_WEIGHT;
    else if (operationIdTokens.has(token)) score += operationIdWeight;
  }

  if (record.method === 'GET' && isBareCollectionPath(record.path) && impliesListing(intentTokens)) {
    const depth = pathDepth(record.path);
    score += Math.max(0, COLLECTION_BONUS_BASE - COLLECTION_BONUS_DEPTH_PENALTY * (depth - minBareCollectionDepth));
  }
  return score;
}

/** Path/query/body parameter shapes for a candidate, with bounded $ref resolution. */
function buildInputSchema(spec: OpenApiDocument, operation: OpenAPIV3.OperationObject): Record<string, unknown> {
  const parameters = (operation.parameters ?? []).map((p) => resolveRefsDeep(spec, p));
  const requestBody = operation.requestBody ? resolveRefsDeep(spec, operation.requestBody) : undefined;
  return { parameters, ...(requestBody ? { requestBody } : {}) };
}

export interface ToolCandidatesResult {
  tools: Tool[];
  totalCandidates: number;
  truncated: boolean;
}

/** Ranks every operation of `spec` against `intent` and returns the top `maxTools` as actionable tools. */
export function buildToolCandidates(
  spec: OpenApiDocument,
  domainId: string,
  apiSource: Pick<ApiSource, 'id' | 'requiresAuth'>,
  intent: string | undefined,
  opts: { maxTools?: number } = {},
): ToolCandidatesResult {
  const maxTools = opts.maxTools ?? 8;
  const operations = listOperations(spec);

  const intentTokens = new Set(intent ? tokenize(intent) : []);
  const bareDepths = operations.filter((r) => r.method === 'GET' && isBareCollectionPath(r.path)).map((r) => pathDepth(r.path));
  const minBareCollectionDepth = bareDepths.length ? Math.min(...bareDepths) : 0;

  const ranked = operations
    .map((record) => ({ record, score: intent ? scoreOperationForIntent(intentTokens, record, minBareCollectionDepth) : 0 }))
    .sort((a, b) => b.score - a.score);

  const tools: Tool[] = ranked.slice(0, maxTools).map(({ record }) => ({
    actionId: `${apiSource.id}::${record.method}::${record.path}`,
    operationId: record.operationId,
    httpMethod: record.method,
    path: record.path,
    domainId,
    apiSourceId: apiSource.id,
    summary: record.summary,
    intentKeywords: record.tags,
    requiresAuth: apiSource.requiresAuth,
    inputSchema: buildInputSchema(spec, record.operation),
  }));

  return { tools, totalCandidates: operations.length, truncated: ranked.length > maxTools };
}
