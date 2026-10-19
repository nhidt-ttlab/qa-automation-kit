import axios, { type AxiosInstance } from 'axios';
import type { AuthorizationParts, AuthProvider } from '../auth/providers.js';
import { redactObject } from '../logger.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;
  query?: QueryParams;
  body?: unknown;
}

export interface HttpResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
}

export interface RawHttpResult {
  ok: boolean;
  status: number;
  data: Buffer;
  headers: Record<string, string>;
  error?: string;
}

export interface MultipartRequestOptions {
  path: string;
  fields?: Record<string, string>;
  files?: Array<{ field: string; filename: string; contentType: string; data: Buffer }>;
}

export interface RequestTraceEntry {
  timestamp: string;
  sourceId: string;
  method: HttpMethod;
  /** The request URL without any credential query parameters. */
  url: string;
  requestBody?: unknown;
  status: number;
  responseBody?: unknown;
  error?: string;
}

export interface HttpSource {
  baseUrl: string;
  /** Omit for sources that need no credentials. */
  auth?: AuthProvider;
}

/**
 * Caps how much of one request/response body the trace keeps. A scenario that probes many
 * candidates before settling on a fixture can otherwise accumulate enough large bodies that the
 * final report's `JSON.stringify` throws `RangeError: Invalid string length`, losing the run's
 * evidence. A few KB of preview shows the shape; the full value is re-fetchable from the live API.
 */
const MAX_TRACE_BODY_CHARS = 20_000;

function capTraceBody(value: unknown): unknown {
  if (value === undefined) return value;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return value;
  }
  if (json.length <= MAX_TRACE_BODY_CHARS) return value;
  return { __truncated: true, originalLength: json.length, preview: json.slice(0, MAX_TRACE_BODY_CHARS) };
}

const NO_AUTH: AuthorizationParts = { headers: {}, query: {} };

/**
 * Shared HTTP client for live backend calls. Each request asks the source's `AuthProvider` for
 * credentials and records a redacted, size-capped trace for reporting.
 */
export class HttpClient {
  private readonly axios: AxiosInstance = axios.create({ validateStatus: () => true });
  private readonly trace: RequestTraceEntry[] = [];

  constructor(private readonly httpSources: ReadonlyMap<string, HttpSource>) {}

  getTrace(): RequestTraceEntry[] {
    return this.trace;
  }

  /** The bearer token `sourceId` would send, logging in first if needed. */
  async getToken(sourceId: string): Promise<string | undefined> {
    return this.requireSource(sourceId).auth?.getToken();
  }

  async request<T = unknown>(sourceId: string, options: HttpRequestOptions): Promise<HttpResult<T>> {
    const source = this.requireSource(sourceId);
    const { url, traceUrl, headers } = await this.prepare(source, options.path, options.query, { 'Content-Type': 'application/json' });
    const timestamp = new Date().toISOString();
    const requestBody = capTraceBody(redactObject(options.body));

    try {
      const response = await this.axios.request({ url, method: options.method, headers, data: options.body });
      this.trace.push({
        timestamp,
        sourceId,
        method: options.method,
        url: traceUrl,
        requestBody,
        status: response.status,
        responseBody: capTraceBody(redactObject(response.data)),
      });
      return { ok: isSuccess(response.status), status: response.status, data: response.data as T };
    } catch (error) {
      const message = errorMessage(error);
      this.trace.push({ timestamp, sourceId, method: options.method, url: traceUrl, requestBody, status: 0, error: message });
      return { ok: false, status: 0, data: undefined as unknown as T, error: message };
    }
  }

  /** Multipart form-data upload. `files` entries become form fields with an attached Blob part. */
  async requestMultipart<T = unknown>(sourceId: string, options: MultipartRequestOptions): Promise<HttpResult<T>> {
    const source = this.requireSource(sourceId);
    const { url, traceUrl, headers } = await this.prepare(source, options.path, undefined, {});
    const timestamp = new Date().toISOString();

    const form = new FormData();
    for (const [key, value] of Object.entries(options.fields ?? {})) form.append(key, value);
    for (const file of options.files ?? []) {
      form.append(file.field, new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.filename);
    }

    try {
      const response = await this.axios.post(url, form, { headers });
      this.trace.push({
        timestamp,
        sourceId,
        method: 'POST',
        url: traceUrl,
        requestBody: { multipartFields: Object.keys(options.fields ?? {}), files: (options.files ?? []).map((f) => f.filename) },
        status: response.status,
        responseBody: capTraceBody(redactObject(response.data)),
      });
      return { ok: isSuccess(response.status), status: response.status, data: response.data as T };
    } catch (error) {
      const message = errorMessage(error);
      this.trace.push({ timestamp, sourceId, method: 'POST', url: traceUrl, status: 0, error: message });
      return { ok: false, status: 0, data: undefined as unknown as T, error: message };
    }
  }

  /**
   * Raw binary request (e.g. a file export). Returns the body as a Buffer plus the response headers;
   * the trace records only the byte length, never the payload.
   */
  async requestRaw(sourceId: string, options: HttpRequestOptions): Promise<RawHttpResult> {
    const source = this.requireSource(sourceId);
    const { url, traceUrl, headers } = await this.prepare(source, options.path, options.query, { 'Content-Type': 'application/json' });
    const timestamp = new Date().toISOString();
    const requestBody = capTraceBody(redactObject(options.body));

    try {
      const response = await this.axios.request({
        url,
        method: options.method,
        headers,
        data: options.body,
        responseType: 'arraybuffer',
      });
      const data = Buffer.from(response.data as ArrayBuffer);
      this.trace.push({
        timestamp,
        sourceId,
        method: options.method,
        url: traceUrl,
        requestBody,
        status: response.status,
        responseBody: `<binary ${data.length} bytes>`,
      });
      return {
        ok: isSuccess(response.status),
        status: response.status,
        data,
        headers: Object.fromEntries(Object.entries(response.headers ?? {}).map(([k, v]) => [k, String(v)])),
      };
    } catch (error) {
      const message = errorMessage(error);
      this.trace.push({ timestamp, sourceId, method: options.method, url: traceUrl, requestBody, status: 0, error: message });
      return { ok: false, status: 0, data: Buffer.alloc(0), headers: {}, error: message };
    }
  }

  private requireSource(sourceId: string): HttpSource {
    const source = this.httpSources.get(sourceId);
    if (!source) throw new Error(`Unknown API source "${sourceId}"`);
    return source;
  }

  private async prepare(
    source: HttpSource,
    path: string,
    query: QueryParams | undefined,
    baseHeaders: Record<string, string>,
  ): Promise<{ url: string; traceUrl: string; headers: Record<string, string> }> {
    const target = resolveAgainstBase(path, source.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) target.searchParams.set(key, String(value));
    }
    const traceUrl = target.toString();

    const auth = source.auth ? await source.auth.authorize() : NO_AUTH;
    for (const [key, value] of Object.entries(auth.query)) target.searchParams.set(key, value);
    return { url: target.toString(), traceUrl, headers: { ...baseHeaders, ...auth.headers } };
  }
}

/**
 * `path` under the base URL, keeping the base's own path: `/users` against `https://host/api` is `https://host/api/users`.
 * Plain `new URL('/users', base)` would drop `/api` (a service behind a path prefix). An absolute URL is used as it is.
 */
export function resolveAgainstBase(path: string, baseUrl: string): URL {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return new URL(path);
  return new URL(path.replace(/^\/+/, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
