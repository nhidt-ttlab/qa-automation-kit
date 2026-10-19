import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import type { OpenAPIV3 } from 'openapi-types';
import { canonicalControllerName, resolveDomainForEndpoint, type DomainFileMapping } from './domain-file-mapping.js';
import type { Domain } from './types.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type EndpointConfidence = 'confirmed' | 'inferred' | 'unknown';

interface EndpointDoc {
  repo: string;
  domain: string;
  controller: string;
  action: string;
  http_method: HttpMethod;
  path: string;
  route_source: 'explicit_attribute';
  summary: string;
  description?: string;
  intent_tags: string[];
  request?: { dto?: string; important_fields?: string[] };
  response?: { dto?: string; important_fields?: string[] };
  preconditions?: string[];
  side_effects?: string[];
  related_endpoints?: string[];
  auth: { required: boolean; permissions?: string[] };
  dependencies: { domains: string[]; services: string[]; gateway_domain: string | null };
  confidence: EndpointConfidence;
  evidence: string[];
  notes?: string[];
  needs_human_review: boolean;
}

/** What docgen needs to know about one API source. */
export interface DocgenSource {
  id: string;
  repository: string;
  requiresAuth: boolean;
  /** Env var naming a spec file that replaces the one in `swaggerDir`. */
  specFileEnv?: string;
}

export interface GenerateSwaggerDocsOptions {
  sources: DocgenSource[];
  domains: Domain[];
  /** Holds `<id>.swagger.json` or `<repository>.swagger.json` per source. */
  swaggerDir: string;
  outputRoot: string;
  mapping?: DomainFileMapping | null;
  env?: NodeJS.ProcessEnv;
}

export interface GenerateSwaggerDocsResult {
  filesWritten: string[];
  endpointsWritten: number;
  missingSwaggerFiles: string[];
}

interface SwaggerSourceInput {
  source: DocgenSource;
  filePath: string;
}

const HTTP_METHODS: Array<{ key: 'get' | 'post' | 'put' | 'patch' | 'delete'; method: HttpMethod }> = [
  { key: 'get', method: 'GET' },
  { key: 'post', method: 'POST' },
  { key: 'put', method: 'PUT' },
  { key: 'patch', method: 'PATCH' },
  { key: 'delete', method: 'DELETE' },
];

/**
 * Turns local OpenAPI files into per-tag endpoint metadata (`metadata/generated/<repository>/<tag>.yaml`),
 * Markdown docs (`docs/<repository>/<tag>.md`) and empty manual-override stubs. Deterministic: run twice
 * on the same specs and nothing changes, so the output can be committed and checked for drift.
 */
export function generateSwaggerDocs(options: GenerateSwaggerDocsOptions): GenerateSwaggerDocsResult {
  const env = options.env ?? process.env;
  const mapping = options.mapping ?? null;
  const sources = resolveSwaggerSources(options.sources, options.swaggerDir, env);
  const filesWritten: string[] = [];
  const missingSwaggerFiles = options.sources.filter((source) => !sources.find((entry) => entry.source.id === source.id)).map((source) => source.id);

  for (const input of sources) {
    const document = JSON.parse(readFileSync(input.filePath, 'utf8')) as OpenAPIV3.Document;
    const grouped = buildGroupedFiles(document, input, options.domains, mapping);

    for (const [domainSlug, endpoints] of grouped.entries()) {
      if (endpoints.length === 0) continue;

      endpoints.sort((left, right) => {
        if (left.path !== right.path) return left.path.localeCompare(right.path);
        return left.http_method.localeCompare(right.http_method);
      });

      const generatedPath = join(options.outputRoot, 'metadata', 'generated', input.source.repository, `${domainSlug}.yaml`);
      mkdirSync(dirname(generatedPath), { recursive: true });
      writeFileSync(generatedPath, stringify({ endpoints }), 'utf8');
      filesWritten.push(generatedPath);

      const docsPath = join(options.outputRoot, 'docs', input.source.repository, `${domainSlug}.md`);
      mkdirSync(dirname(docsPath), { recursive: true });
      writeFileSync(docsPath, renderMarkdownDoc(input.source, domainSlug, endpoints), 'utf8');
      filesWritten.push(docsPath);

      const overridesPath = join(options.outputRoot, 'metadata', 'manual-overrides', input.source.repository, `${domainSlug}.yaml`);
      if (!existsSync(overridesPath)) {
        mkdirSync(dirname(overridesPath), { recursive: true });
        writeFileSync(overridesPath, stringify({ overrides: [] }), 'utf8');
        filesWritten.push(overridesPath);
      }
    }
  }

  return {
    filesWritten,
    endpointsWritten: filesWritten
      .filter((path) => path.endsWith('.yaml'))
      .reduce((count, path) => {
        if (!path.includes(`${join('metadata', 'generated')}`)) return count;
        const matches = readFileSync(path, 'utf8').match(/\n  - repo:/g);
        return count + (matches?.length ?? 0);
      }, 0),
    missingSwaggerFiles,
  };
}

function resolveSwaggerSources(sources: DocgenSource[], swaggerDir: string, env: NodeJS.ProcessEnv): SwaggerSourceInput[] {
  return sources.flatMap((source) => {
    const candidates = [
      source.specFileEnv ? env[source.specFileEnv] : undefined,
      join(swaggerDir, `${source.id}.swagger.json`),
      join(swaggerDir, `${source.repository}.swagger.json`),
    ].filter((value): value is string => Boolean(value));
    const filePath = candidates.find((candidate) => existsSync(candidate));
    return filePath ? [{ source, filePath }] : [];
  });
}

function buildGroupedFiles(
  document: OpenAPIV3.Document,
  input: SwaggerSourceInput,
  domains: Domain[],
  mapping: DomainFileMapping | null,
): Map<string, EndpointDoc[]> {
  const grouped = new Map<string, EndpointDoc[]>();
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) continue;
    for (const { key, method } of HTTP_METHODS) {
      const operation = pathItem[key];
      if (!operation || '$ref' in operation) continue;

      const tag = operation.tags?.[0] ?? inferTagFromPath(path);
      const domainSlug = slugify(tag);
      const endpoint = buildEndpointDoc({ document, input, domainSlug, method, path, operation, tag, domains, mapping });
      const list = grouped.get(domainSlug);
      if (list) list.push(endpoint);
      else grouped.set(domainSlug, [endpoint]);
    }
  }
  return grouped;
}

function buildEndpointDoc(args: {
  document: OpenAPIV3.Document;
  input: SwaggerSourceInput;
  domainSlug: string;
  method: HttpMethod;
  path: string;
  operation: OpenAPIV3.OperationObject;
  tag: string;
  domains: Domain[];
  mapping: DomainFileMapping | null;
}): EndpointDoc {
  const { source } = args.input;
  const request = readBodyDoc(args.document, args.operation.requestBody);
  const response = readBodyDoc(args.document, pickPreferredResponse(args.operation.responses));
  const owningDomain = guessOwningDomain(source.repository, args.tag, args.path, args.domains, args.mapping);
  const summary = args.operation.summary?.trim() || fallbackSummary(args.method, args.path, args.operation.operationId);
  const description = args.operation.description?.trim();
  const notes: string[] = [];

  if (!args.operation.summary) notes.push('Summary missing in swagger; generated from HTTP method/path.');
  if (!request.dto && args.operation.requestBody) notes.push('Request DTO could not be resolved from requestBody schema.');
  if (!response.dto) notes.push('Response DTO could not be resolved from 2xx response schema.');

  const authRequired = (args.operation.security?.length ?? 0) > 0 || source.requiresAuth;

  return {
    repo: source.repository,
    domain: args.domainSlug,
    controller: args.tag,
    action: args.operation.operationId?.trim() || `${args.method.toLowerCase()}_${args.domainSlug}`,
    http_method: args.method,
    path: args.path,
    route_source: 'explicit_attribute',
    summary,
    description,
    intent_tags: buildIntentTags(args.tag, args.operation.operationId, summary),
    request:
      request.dto || request.importantFields.length > 0
        ? { dto: request.dto, important_fields: request.importantFields.length > 0 ? request.importantFields : undefined }
        : undefined,
    response:
      response.dto || response.importantFields.length > 0
        ? { dto: response.dto, important_fields: response.importantFields.length > 0 ? response.importantFields : undefined }
        : undefined,
    preconditions: authRequired ? ['Requires authenticated API access.'] : undefined,
    side_effects: inferSideEffects(args.method, summary),
    related_endpoints: undefined,
    auth: { required: authRequired },
    dependencies: { domains: owningDomain?.dependsOn ?? [], services: [source.id], gateway_domain: owningDomain?.id ?? null },
    confidence: 'confirmed',
    evidence: [`swagger_file:${basename(args.input.filePath)}`, `swagger_tag:${args.tag}`, `operation_id:${args.operation.operationId ?? 'missing'}`],
    notes: notes.length > 0 ? notes : undefined,
    needs_human_review: notes.length > 0 || !args.operation.tags?.length,
  };
}

type BodyLike = OpenAPIV3.RequestBodyObject | OpenAPIV3.ResponseObject | OpenAPIV3.ReferenceObject | undefined;

function readBodyDoc(document: OpenAPIV3.Document, body: BodyLike): { dto?: string; importantFields: string[] } {
  if (!body || '$ref' in body) return { importantFields: [] };
  const mediaType = pickJsonLikeMediaType(body.content);
  if (!mediaType?.schema) return { importantFields: [] };
  return { dto: extractSchemaName(mediaType.schema), importantFields: extractImportantFields(dereferenceSchema(document, mediaType.schema)) };
}

function pickPreferredResponse(responses: OpenAPIV3.ResponsesObject | undefined): OpenAPIV3.ResponseObject | OpenAPIV3.ReferenceObject | undefined {
  if (!responses) return undefined;
  for (const key of Object.keys(responses).filter((k) => k.startsWith('2')).sort()) {
    const response = responses[key];
    if (response) return response;
  }
  return responses.default;
}

function pickJsonLikeMediaType(content: Record<string, OpenAPIV3.MediaTypeObject> | undefined): OpenAPIV3.MediaTypeObject | undefined {
  if (!content) return undefined;
  return content['application/json'] || content['text/json'] || Object.entries(content).find(([key]) => key.includes('json'))?.[1];
}

function dereferenceSchema(document: OpenAPIV3.Document, schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): OpenAPIV3.SchemaObject | undefined {
  if (!schema) return undefined;
  if ('$ref' in schema) {
    const name = extractSchemaName(schema);
    return name ? (document.components?.schemas?.[name] as OpenAPIV3.SchemaObject | undefined) : undefined;
  }
  return schema;
}

function extractSchemaName(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined): string | undefined {
  if (!schema || !('$ref' in schema)) return undefined;
  const parts = schema.$ref.split('/');
  return parts[parts.length - 1];
}

function extractImportantFields(schema: OpenAPIV3.SchemaObject | undefined): string[] {
  if (!schema) return [];
  const direct = Object.keys(schema.properties ?? {});
  if (direct.length > 0) return direct.slice(0, 8);
  for (const item of schema.allOf ?? schema.oneOf ?? schema.anyOf ?? []) {
    if ('$ref' in item) continue;
    const keys = Object.keys(item.properties ?? {});
    if (keys.length > 0) return keys.slice(0, 8);
  }
  if (schema.type && schema.type !== 'object') return [schema.type];
  return [];
}

function inferTagFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'unknown';
}

function buildIntentTags(tag: string, operationId: string | undefined, summary: string): string[] {
  const tags = [slugify(tag), slugify(summary)];
  if (operationId) tags.push(slugify(operationId));
  return Array.from(new Set(tags.filter(Boolean)));
}

function fallbackSummary(method: HttpMethod, path: string, operationId: string | undefined): string {
  return operationId ? humanize(operationId) : `${method} ${path}`;
}

function inferSideEffects(method: HttpMethod, summary: string): string[] | undefined {
  if (method === 'GET') return undefined;
  const text = summary.toLowerCase();
  if (text.includes('delete') || text.includes('cancel')) return ['Mutates backend state by removing or cancelling existing data.'];
  if (text.includes('create') || text.includes('import')) return ['Mutates backend state by creating or importing data.'];
  if (method === 'PUT' || method === 'PATCH') return ['Mutates backend state by updating existing data.'];
  if (method === 'POST') return ['Mutates backend state.'];
  return undefined;
}

/**
 * Which business domain an endpoint belongs to.
 *
 * 1. Capability-source match: a domain whose `capabilities[].source` canonicalizes to the tag
 *    (e.g. IPurchaseOrderAppService <-> PurchaseOrder).
 * 2. Fallback: the domain-file mapping keyed by `<repository>/<slugified-tag>`, including
 *    per-endpoint claim rules for shared controller files.
 *
 * Deliberately NOT a blind per-repository fallback: that silently assigns every unmapped endpoint
 * to whichever domain happened to load first once a repository maps to more than one domain.
 */
function guessOwningDomain(repository: string, tag: string, path: string, domains: Domain[], mapping: DomainFileMapping | null): Domain | undefined {
  const canonicalTag = canonicalControllerName(tag);
  const bySource = domains.find((domain) =>
    domain.capabilities.some((capability) => Boolean(capability.source) && canonicalControllerName(capability.source!) === canonicalTag && canonicalTag.length > 0),
  );
  if (bySource) return bySource;
  if (!mapping) return undefined;
  const domainId = resolveDomainForEndpoint(mapping, repository, slugify(tag), path);
  return domainId ? domains.find((domain) => domain.id === domainId) : undefined;
}

function renderMarkdownDoc(source: DocgenSource, domainSlug: string, endpoints: EndpointDoc[]): string {
  const lines = [`# ${humanize(domainSlug)}`, '', `Generated from Swagger for \`${source.repository}\` / \`${source.id}\`.`, '', `Endpoints: ${endpoints.length}`, ''];
  for (const endpoint of endpoints) {
    lines.push(`## ${endpoint.summary}`);
    lines.push('');
    lines.push(`- Method: \`${endpoint.http_method}\``);
    lines.push(`- Path: \`${endpoint.path}\``);
    lines.push(`- Controller/Tag: \`${endpoint.controller}\``);
    lines.push(`- Action: \`${endpoint.action}\``);
    if (endpoint.request?.dto) lines.push(`- Request DTO: \`${endpoint.request.dto}\``);
    if (endpoint.response?.dto) lines.push(`- Response DTO: \`${endpoint.response.dto}\``);
    if (endpoint.dependencies.gateway_domain) lines.push(`- Gateway Domain: \`${endpoint.dependencies.gateway_domain}\``);
    if (endpoint.description) lines.push(`- Description: ${endpoint.description}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

export function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}
