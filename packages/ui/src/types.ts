import type { RequestTraceEntry } from '@qakit/core';

/**
 * How to find one element. Strategies are tried in a fixed order by `resolveLocator`
 * (see locator.ts) and the winning one is recorded on the step, so selector rot shows up
 * in the report instead of silently degrading.
 */
export interface LocatorSpec {
  /** `#id`. Tried FIRST — this app labels controls with `id`, not `data-testid`. */
  domId?: string;
  /** `[data-testid="..."]`. Present on only 30 of ~600 page components. */
  testId?: string;
  /** ARIA role, optionally narrowed by accessible name. */
  role?: string;
  name?: string;
  /** Form label text. Low priority: the app hard-pins Vietnamese and many forms omit `name`, so labels collide. */
  label?: string;
  placeholder?: string;
  /** Visible text. Same i18n caveat as `label`. */
  text?: string;
  /** Raw CSS. Last resort — a step doc using this must justify it under section 9. */
  css?: string;
  /** Disambiguates a deliberately non-unique target. Without it, a multi-match is an error. */
  nth?: number;
  /** Scopes the search to another element (a tab panel, a modal, a grid). */
  within?: LocatorSpec;
}

export type LocatorStrategy = 'domId' | 'testId' | 'role' | 'label' | 'placeholder' | 'text' | 'css';

export interface ResolvedLocator {
  strategy: LocatorStrategy;
  /** How many elements the winning strategy matched (1 unless `nth` was given). */
  matched: number;
  /** Human-readable form for step titles and audit logs. */
  description: string;
}

/** One recorded browser step. Structurally `ReportableResult['steps'][number]`. */
export interface UiStepRecord {
  title: string;
  ok: boolean;
  status?: number;
  data: {
    locator?: { spec: LocatorSpec; resolvedBy: LocatorStrategy; matched: number };
    url?: string;
    durationMs?: number;
    /** "GET /api/app/..." for each XHR this action triggered. */
    triggeredRequests?: string[];
    /** Evidence relPaths captured for this step. */
    evidence?: string[];
    pageErrors?: number;
    error?: string;
    [key: string]: unknown;
  };
}

export interface ConsoleEntry {
  type: string;
  text: string;
  location?: string;
  timestamp: string;
}

export interface PageErrorEntry {
  message: string;
  stack?: string;
  timestamp: string;
}

export interface FailedRequestEntry {
  url: string;
  method: string;
  failure?: string;
  timestamp: string;
}

export interface UiDiagnostics {
  /**
   * Almost always empty against a deployed build whose bundler sets
   * `terserOptions.compress.drop_console = true`, so application `console.*` calls are
   * stripped from the bundle. Populated against a local `npm run dev` build.
   */
  consoleErrors: ConsoleEntry[];
  consoleWarnings: ConsoleEntry[];
  /** Uncaught exceptions. These DO survive minification and are the real signal. */
  pageErrors: PageErrorEntry[];
  failedRequests: FailedRequestEntry[];
  httpErrorResponses: Array<{ url: string; status: number; timestamp: string }>;
  dialogs: Array<{ type: string; message: string; timestamp: string }>;
  /**
   * Requests the read-only guard aborted. Non-empty means a scenario tried to mutate.
   *
   * `body` is what the page was about to send, captured just before the abort (plan
   * `plan-vai-tro-phan-quyen-scenario-scripts.md` §3.5). `null` means **not readable** — a request
   * with no body, or a binary/multipart one — never "the page sent nothing"; `''` is a genuinely
   * empty body. Any assertion that reads it must keep those two apart.
   */
  blockedRequests: Array<{ url: string; method: string; reason: string; timestamp: string; body: string | null }>;
}

export function emptyDiagnostics(): UiDiagnostics {
  return {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    httpErrorResponses: [],
    dialogs: [],
    blockedRequests: [],
  };
}

/** One row of an AG Grid read, keyed by `col-id`. */
export type GridRow = Record<string, string>;

export interface GridSnapshot {
  /** Column ids actually found, in the order requested. */
  columns: string[];
  rows: GridRow[];
  /**
   * Rows present in the DOM. NOT the dataset size: BaseTableAg paginates client-side over
   * one server page, so this is the current page length at most.
   */
  domRowCount: number;
}

export interface UiTrace {
  entries: RequestTraceEntry[];
}

/** The web application under test. */
export interface WebTarget {
  /** Origin of the app, e.g. https://shop.example.test */
  baseUrl: string;
  /** Route the app redirects to when unauthenticated. */
  loginPath: string;
  /** Hosts the browser may reach — enforced by the route guard, not just the tool boundary. */
  allowedHosts: string[];
  /**
   * The identity provider's protocol endpoints, as regular expression sources matched against the URL.
   * The guard lets them through in read-only mode and never records their bodies. Unset: `/connect/token`
   * and `/connect/authorize`.
   */
  authPaths?: string[];
  /** Explicit viewport. Grids that size off the window height render differently in a small one. */
  viewport?: { width: number; height: number };
}
