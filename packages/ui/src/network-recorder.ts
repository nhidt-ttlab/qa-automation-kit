import type { Page, Request, Response } from 'playwright';
import type { HttpMethod, RequestTraceEntry } from '@qakit/core';
import { redactObject } from '@qakit/core';
import type { BlockedRequestRegistry } from './blocked-registry.js';

/** `sourceId` is an untyped string on RequestTraceEntry, so browser calls slot in beside erp-api ones. */
export const WEB_UI_SOURCE_ID = 'web-ui';

const MAX_BODY_CHARS = 8_192;

/** RequestTraceEntry.method is a closed union; anything else must not reach the trace. */
const TRACED_METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function truncate(text: string): string {
  return text.length <= MAX_BODY_CHARS ? text : `${text.slice(0, MAX_BODY_CHARS)}… [truncated ${text.length} chars]`;
}

function requestBodyOf(request: Request): unknown {
  // The token endpoint is form-encoded, so key-based redaction never sees a `password`
  // property. Drop the whole body rather than risk leaking credentials into a report.
  if (/\/connect\/token$/.test(request.url())) return '[REDACTED]';
  try {
    const json = request.postDataJSON();
    if (json !== null && json !== undefined) return redactObject(json);
  } catch {
    // Not JSON — fall through to the raw string.
  }
  const raw = request.postData();
  return raw === null ? undefined : truncate(raw);
}

async function responseBodyOf(response: Response): Promise<unknown> {
  const contentType = response.headers()['content-type'] ?? '';
  if (!contentType.includes('json')) {
    const length = response.headers()['content-length'];
    return length ? `<non-json ${contentType || 'body'}, ${length} bytes>` : `<non-json ${contentType || 'body'}>`;
  }
  try {
    return redactObject(await response.json());
  } catch {
    return undefined;
  }
}

/**
 * Turns browser XHR/fetch traffic into the harness's existing `RequestTraceEntry`.
 *
 * This is the single most important seam in the UI layer. `buildRunArtifact` derives
 * `visualSteps` *entirely* from the trace, and `buildEvidenceRows` / `test_run_evidence` /
 * the review viewer all read from it — so a UI run with an empty trace produces a report
 * whose evidence section reads "Không có lời gọi API nào được ghi nhận." By synthesizing
 * the same type, ~1900 lines of reporting code light up with no modification, and the
 * scenario gets a network-level oracle that is far more trustworthy than a second DOM read.
 */
export class BrowserNetworkRecorder {
  private readonly entries: RequestTraceEntry[] = [];
  private readonly pending = new Map<Request, string>();

  constructor(private readonly blocked?: BlockedRequestRegistry) {}

  attach(page: Page): void {
    page.on('request', (request) => {
      if (!this.shouldTrace(request)) return;
      this.pending.set(request, new Date().toISOString());
    });

    page.on('requestfinished', (request) => {
      if (!this.shouldTrace(request)) return;
      const timestamp = this.pending.get(request) ?? new Date().toISOString();
      this.pending.delete(request);
      void (async () => {
        try {
          const response = await request.response();
          if (!response) return;
          this.entries.push({
            timestamp,
            sourceId: WEB_UI_SOURCE_ID,
            method: request.method() as HttpMethod,
            url: request.url(),
            requestBody: requestBodyOf(request),
            status: response.status(),
            responseBody: await responseBodyOf(response),
          });
        } catch {
          // A navigation can tear the response down mid-read; losing one trace row is
          // strictly better than failing the run.
        }
      })();
    });

    page.on('requestfailed', (request) => {
      if (!this.shouldTrace(request)) return;
      // A guard-aborted request never reached the server, so it is not evidence of anything
      // the product did. Leaving it in would put status-0 rows for calls that were correctly
      // prevented into the report's evidence table.
      if (this.blocked?.has(request.method(), request.url())) {
        this.pending.delete(request);
        return;
      }
      const timestamp = this.pending.get(request) ?? new Date().toISOString();
      this.pending.delete(request);
      this.entries.push({
        timestamp,
        sourceId: WEB_UI_SOURCE_ID,
        method: request.method() as HttpMethod,
        url: request.url(),
        requestBody: requestBodyOf(request),
        status: 0,
        error: request.failure()?.errorText ?? 'request failed',
      });
    });
  }

  /**
   * Documents, scripts, images and fonts go to the HAR only — they are ~95% of the volume
   * and none of them is evidence of business behavior. OPTIONS/HEAD preflights are dropped
   * for a typing reason: widening `HttpMethod` would ripple into buildEvidenceRows,
   * shortenEndpointForDisplay, and persist-run's evidence insert.
   */
  private shouldTrace(request: Request): boolean {
    const type = request.resourceType();
    if (type !== 'xhr' && type !== 'fetch') return false;
    return TRACED_METHODS.has(request.method());
  }

  trace(): RequestTraceEntry[] {
    return this.entries;
  }

  /** Entries recorded since a marker, for attributing XHRs to the action that caused them. */
  since(marker: number): RequestTraceEntry[] {
    return this.entries.slice(marker);
  }

  marker(): number {
    return this.entries.length;
  }
}

/**
 * Interleaves the API client's trace with the browser's, so a hybrid scenario's evidence
 * table reads in real execution order.
 */
export function mergeTraces(...traces: RequestTraceEntry[][]): RequestTraceEntry[] {
  return traces
    .flat()
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.timestamp === b.entry.timestamp ? a.index - b.index : a.entry.timestamp < b.entry.timestamp ? -1 : 1))
    .map(({ entry }) => entry);
}
