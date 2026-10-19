import type { RequestTraceEntry } from '../http/http-client.js';
import type { KeyInputConfig, ReportWording } from './wording.js';

/** One row of the evidence table — a single call, or `count` consecutive identical calls collapsed together. */
export interface EvidenceRow {
  firstIndex: number;
  lastIndex: number;
  count: number;
  method: string;
  url: string;
  purpose: string;
  keyInput: string;
  result: string;
  signature: string;
}

/** The URL's pathname only (no scheme, host or query). */
export function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** True for a path segment that looks like an opaque id (GUID, or a long numeric code) rather than a fixed route word. */
function looksLikeIdSegment(segment: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  if (/^\d{4,}$/.test(segment)) return true;
  return false;
}

/** Path only, with opaque id segments collapsed to `{id}` so repeated calls to the same route read as one route. */
export function shortenEndpointForDisplay(url: string): string {
  return pathnameOf(url)
    .split('/')
    .map((seg) => (looksLikeIdSegment(seg) ? '{id}' : seg))
    .join('/');
}

/** Truncates a long opaque id/code for inline display (`693ec0e4…449e45`). */
export function truncateValue(value: string, keep = 8): string {
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-6)}`;
}

function formatKeyInputValue(value: unknown): string {
  if (typeof value === 'string') {
    if (/^[0-9a-f-]{16,}$/i.test(value)) return truncateValue(value);
    return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  }
  return String(value);
}

/** A handful of business-relevant request-body fields — item-level fields first, since they usually distinguish otherwise-identical calls. */
function summarizeRequestBody(body: unknown, keyInput: KeyInputConfig): string | undefined {
  if (body === null || body === undefined || typeof body !== 'object') return undefined;
  const obj = body as Record<string, unknown>;
  const parts: string[] = [];

  const items = Array.isArray(obj.items) ? (obj.items as Array<Record<string, unknown>>) : undefined;
  if (items?.length) {
    for (const field of keyInput.itemFields) {
      const value = items[0]?.[field];
      if (value !== undefined && value !== null) parts.push(`items[0].${field}=${formatKeyInputValue(value)}`);
    }
  }
  for (const field of keyInput.bodyFields) {
    const value = obj[field];
    if (value !== undefined && value !== null && value !== '') parts.push(`${field}=${formatKeyInputValue(value)}`);
  }

  if (parts.length) return parts.slice(0, 4).join(', ');
  if (obj.multipartFields) return 'multipart file upload';
  return undefined;
}

/** A GET/DELETE call's query string, minus ignored parameters such as pagination. */
function summarizeQueryParams(url: string, ignored: readonly string[]): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const skip = new Set(ignored.map((name) => name.toLowerCase()));
  const parts: string[] = [];
  for (const [key, value] of parsed.searchParams) {
    if (skip.has(key.toLowerCase())) continue;
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      /* keep raw value */
    }
    parts.push(`${key}=${decoded.length > 32 ? truncateValue(decoded) : decoded}`);
  }
  return parts.length ? parts.join(', ') : undefined;
}

function describeKeyInput(entry: RequestTraceEntry, keyInput: KeyInputConfig): string {
  if (entry.method === 'GET' || entry.method === 'DELETE') {
    return summarizeQueryParams(entry.url, keyInput.ignoredQueryParams) ?? '(no params)';
  }
  return summarizeRequestBody(entry.requestBody, keyInput) ?? '(see artifact)';
}

/** Compact status text, surfacing the backend error code for non-2xx responses. */
export function classifyCallResult(entry: RequestTraceEntry, extractError: ReportWording['extractError']): string {
  if (entry.error) return `Network error — ${entry.error}`;
  const { code } = extractError(entry.responseBody);
  if (entry.status >= 200 && entry.status < 300) {
    return entry.status === 204 ? '204 No Content' : `${entry.status} OK`;
  }
  if (entry.status >= 400 && entry.status < 500) return `${entry.status} Validation error${code ? ` (${code})` : ''}`;
  if (entry.status >= 500) return `${entry.status} Internal error${code ? ` (${code})` : ''}`;
  return `${entry.status || 'no response'}`;
}

/**
 * Full-fidelity request signature for deciding whether two calls are true duplicates — not the
 * truncated key-input display string, which can render two different bodies identically.
 */
function requestSignature(entry: RequestTraceEntry): string {
  try {
    return JSON.stringify(entry.requestBody ?? null);
  } catch {
    return String(entry.requestBody);
  }
}

/** Groups the raw trace into evidence rows, collapsing consecutive identical calls (e.g. polls) into one row. */
export function buildEvidenceRows(trace: RequestTraceEntry[], wording: Pick<ReportWording, 'describeApiCall' | 'extractError' | 'keyInput'>): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  trace.forEach((entry, i) => {
    const purpose = wording.describeApiCall(entry.method, entry.url) ?? `${entry.method} ${shortenEndpointForDisplay(entry.url)}`;
    const keyInput = describeKeyInput(entry, wording.keyInput);
    const result = classifyCallResult(entry, wording.extractError);
    const signature = requestSignature(entry);
    const prev = rows[rows.length - 1];
    const isRepeatOfPrev =
      prev !== undefined &&
      prev.lastIndex === i - 1 &&
      prev.method === entry.method &&
      prev.url === entry.url &&
      prev.signature === signature &&
      prev.result === result;
    if (isRepeatOfPrev) {
      prev.lastIndex = i;
      prev.count += 1;
    } else {
      rows.push({ firstIndex: i, lastIndex: i, count: 1, method: entry.method, url: entry.url, purpose, keyInput, result, signature });
    }
  });
  return rows;
}

export const MAX_KEY_EVIDENCE_ROWS = 8;

/** The evidence rows the QA summary shows (writes and errors first, capped) — shared so persistence marks the same rows as key. */
export function selectKeyEvidenceRows(rows: EvidenceRow[]): EvidenceRow[] {
  const isNoteworthy = (r: EvidenceRow) => r.method !== 'GET' || /error|4\d\d|5\d\d/i.test(r.result);
  const prioritized = [...rows].sort((a, b) => Number(isNoteworthy(b)) - Number(isNoteworthy(a)));
  return prioritized.slice(0, MAX_KEY_EVIDENCE_ROWS);
}
