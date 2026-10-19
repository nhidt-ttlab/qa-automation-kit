import { type CheckResult, check } from '@qakit/core';
import type { RequestTraceEntry } from '@qakit/core';
import type { UiDiagnostics } from './types.js';

/**
 * Shared UI assertions. All of them go through `check()` so the assertion-ID chain
 * (step doc -> scenario -> stored check test_id -> dashboard) stays intact and UI checks render
 * identically to API ones.
 *
 * Their labels and expected/actual values are stored with every run, so the wording is a
 * `UiCheckText` a locale pack supplies — `createUiChecks(text)` binds it. The top-level exports
 * are bound to English.
 */
export interface UiCheckText {
  noPageErrorsLabel: string;
  noConsoleErrorsLabel: string;
  noFailedRequestsLabel: string;
  noMatchingRequest(urlContains: string): string;
  emptyGrid: string;
  contiguous(count: number, startsAt: number): string;
  sequenceBreak(position: number, expected: string | undefined, actual: string | undefined): string;
  allRowsContain(count: number, keyword: string): string;
  rowMismatch(value: string): string;
  /** Locale for case-insensitive matching in `checkAllContain`. */
  collationLocale: string;
  /** Receives the field ids already sorted; an empty list means nothing was flagged. */
  flaggedFields(sortedFields: string[]): string;
  fieldLevel: string;
  pageLevel: string;
  atLeastOneMessage(level: string): string;
  messageCount(count: number, level: string): string;
  noMessages(level: string): string;
  flaggedFieldsLabel: string;
  messageCountLabel(level: string): string;
  noWritesLabel: string;
  noWrites: string;
  /** `list` is the escaped requests as `METHOD url`, already joined. */
  escapedWrites(count: number, list: string): string;
}

export const englishUiCheckText: UiCheckText = {
  noPageErrorsLabel: 'No uncaught JavaScript error (pageerror) during the session',
  noConsoleErrorsLabel: 'No console.error (only meaningful against a dev build)',
  noFailedRequestsLabel: 'No request failed at the network level',
  noMatchingRequest: (urlContains) => `no request matching ${urlContains}`,
  emptyGrid: 'the grid has no rows',
  contiguous: (count, startsAt) => `1..${count} contiguous from ${startsAt}`,
  sequenceBreak: (position, expected, actual) => `wrong at position ${position}: expected "${expected}", got "${actual}"`,
  allRowsContain: (count, keyword) => `all ${count} rows contain "${keyword}"`,
  rowMismatch: (value) => `row does not match: "${value}"`,
  collationLocale: 'en',
  flaggedFields: (fields) => (fields.length === 0 ? 'no field flagged' : `fields flagged: ${fields.join(', ')}`),
  fieldLevel: 'field level',
  pageLevel: 'page level (modal/toast/dialog)',
  atLeastOneMessage: (level) => `at least 1 message at ${level}`,
  messageCount: (count, level) => `${count} message(s) at ${level}`,
  noMessages: (level) => `no message at ${level}`,
  flaggedFieldsLabel: 'Exactly the fields the doc declares required/invalid are flagged',
  messageCountLabel: (level) => `Number of error messages shown at ${level}`,
  noWritesLabel: 'No write request left the browser',
  noWrites: 'no write request',
  escapedWrites: (count, list) => `${count} write request(s): ${list}`,
};

export interface RequestMatcher {
  urlContains: string;
  method?: string;
  /** Query parameters that must be present, with these exact values. */
  query?: Record<string, string>;
}

function matches(entry: RequestTraceEntry, matcher: RequestMatcher): boolean {
  if (!entry.url.includes(matcher.urlContains)) return false;
  if (matcher.method && entry.method !== matcher.method) return false;
  if (matcher.query) {
    const params = new URL(entry.url).searchParams;
    for (const [key, value] of Object.entries(matcher.query)) {
      if (params.get(key) !== value) return false;
    }
  }
  return true;
}

export function findRequests(trace: RequestTraceEntry[], matcher: RequestMatcher): RequestTraceEntry[] {
  return trace.filter((entry) => matches(entry, matcher));
}

/* ------------------------------------------------------------------------------------- *
 * "Leave a field empty / enter bad input -> press Save -> blocked" — the most common UI case
 * ------------------------------------------------------------------------------------- */

/** Methods that never write. Kept here so the write-escape count has one definition. */
const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** A dialog entry as `UiDiagnostics['dialogs']` carries it — narrowed to what this helper reads. */
export interface RecordedDialog {
  type: string;
  message: string;
}

/** A guard-aborted request as `UiDiagnostics['blockedRequests']` carries it. */
export interface RecordedBlockedRequest {
  method: string;
  url: string;
}

/**
 * One reading of a form that has just refused to save, plus what the **step doc** says should
 * have happened. Everything here is measured; nothing is inferred from the DOM's own opinion of
 * itself.
 */
export interface FormBlocksSaveInput {
  /**
   * Error messages currently attached to each field, keyed by the field id the step doc names.
   * A field with no complaint may be omitted or map to `[]` — both read as "not flagged".
   * Read it with the widget adapter, which knows how the UI library nests form items.
   */
  formErrors: Record<string, string[]>;
  /** Page-level surfaces: modal warnings, notifications, toast messages. */
  pageMessages?: string[];
  /**
   * `ui.diagnostics().dialogs` — native `window.confirm`/`alert`, recorded *before* the harness
   * dismisses them. Counted as a page-level complaint, because to a user a native dialog is one:
   * the app spoke, just through a different surface.
   */
  dialogs?: RecordedDialog[];
  /**
   * `ui.diagnostics().blockedRequests` — **not** `ui.networkTrace()`.
   *
   * A request the read-only guard aborts never reaches the trace, so a scenario that looks for an
   * escaped write in `trace()` finds nothing and reports a clean run. The guard's own registry is
   * the only place the attempt is recorded.
   */
  blockedRequests: RecordedBlockedRequest[];
  /**
   * The fields the **step doc** declares must be flagged — never a list scraped from the DOM.
   *
   * An app may draw its required markers by hand, outside the UI library's form item, so the
   * library's own `required` class can be missing on genuinely required fields. Deriving the
   * expectation from the rendered form would make every such testcase assert that the form agrees
   * with itself. Pass `[]` when the doc says the form complains at page level only.
   */
  expectedFields: string[];
  /**
   * Where the doc says the complaint appears. `field` = inline under each input; `page` = one
   * modal/toast for the whole form. The two are different products of different code paths and
   * conflating them hides a regression from one into the other.
   */
  messageLevel: 'field' | 'page';
  /** Exact message count the doc commits to. Omit when it only says "there is a complaint". */
  expectedMessageCount?: number;
  /**
   * Endpoints that are POST but do **not** write (list/lookup/duplicate-check endpoints). Matched
   * as url substrings and excluded from the write-escape count, since the guard aborts lookups
   * implemented as POST too.
   */
  knownPostLookups?: string[];
  /** Assertion ids from the step doc, one per returned check. */
  testIds: { fields: string; messages: string; noWrite: string };
}

/** The UI checks, reporting in the given wording. */
export function createUiChecks(text: UiCheckText = englishUiCheckText) {
  /**
   * Uncaught exceptions. This is the diagnostic worth asserting on against a deployed build:
   * unlike `console.*`, `pageerror` survives minification, so it catches "the page threw an
   * error while still looking fine" — the main thing UI testing adds over API testing.
   */
  const checkNoPageErrors = (diagnostics: UiDiagnostics, testId: string): CheckResult =>
    check(text.noPageErrorsLabel, 0, diagnostics.pageErrors.length, testId);

  /**
   * Application console errors.
   *
   * WARNING: against a deployment whose bundler strips console calls (e.g. terser's
   * `drop_console`), this reads 0 even when the app is misbehaving. Use `checkNoPageErrors`
   * for a deployed target; this one is for local dev-build runs.
   */
  const checkNoConsoleErrors = (diagnostics: UiDiagnostics, testId: string): CheckResult =>
    check(text.noConsoleErrorsLabel, 0, diagnostics.consoleErrors.length, testId);

  /** Requests that never completed — a network-level failure, distinct from an HTTP error. */
  const checkNoFailedRequests = (diagnostics: UiDiagnostics, testId: string): CheckResult =>
    check(text.noFailedRequestsLabel, 0, diagnostics.failedRequests.length, testId);

  /** Asserts the UI fired the request it was supposed to fire, and that it succeeded. */
  const checkRequestObserved = (
    trace: RequestTraceEntry[],
    matcher: RequestMatcher,
    label: string,
    testId: string,
    expectedStatus = 200,
  ): CheckResult => {
    const found = findRequests(trace, matcher);
    const last = found[found.length - 1];
    return check(label, expectedStatus, last?.status ?? text.noMatchingRequest(matcher.urlContains), testId);
  };

  /** Asserts an action produced exactly `expected` matching requests — catches double-fires. */
  const checkRequestCount = (
    trace: RequestTraceEntry[],
    matcher: RequestMatcher,
    expected: number,
    label: string,
    testId: string,
  ): CheckResult => check(label, expected, findRequests(trace, matcher).length, testId);

  /**
   * Asserts a sequence is 1..n with no gaps, starting at `startsAt`.
   *
   * Returns the offending value rather than just `false`, because "the row number starts at 2"
   * is actionable in a report and "false" is not.
   */
  const checkContiguousSequence = (values: string[], startsAt: number, label: string, testId: string): CheckResult => {
    const expected = values.map((_, i) => String(startsAt + i));
    const firstMismatch = values.findIndex((value, i) => value.trim() !== expected[i]);
    const actual =
      values.length === 0
        ? text.emptyGrid
        : firstMismatch === -1
          ? text.contiguous(values.length, startsAt)
          : text.sequenceBreak(firstMismatch + 1, expected[firstMismatch], values[firstMismatch]);

    return check(label, values.length === 0 ? text.emptyGrid : text.contiguous(values.length, startsAt), actual, testId);
  };

  /** Asserts every value contains `keyword`, case-insensitively under the text's collation locale. */
  const checkAllContain = (values: string[], keyword: string, label: string, testId: string): CheckResult => {
    const needle = keyword.trim().toLocaleLowerCase(text.collationLocale);
    const offender = values.find((value) => !value.toLocaleLowerCase(text.collationLocale).includes(needle));
    return check(
      label,
      text.allRowsContain(values.length, keyword.trim()),
      offender === undefined ? text.allRowsContain(values.length, keyword.trim()) : text.rowMismatch(offender),
      testId,
    );
  };

  /**
   * Nothing that writes left the browser — read from the read-only guard's own registry.
   *
   * The most reusable assertion of a UI suite: most UI testcases run read-only, and for every one
   * of them "a write escaped" is a RED assertion about the scenario or the product, never an
   * infrastructure note. Split out of `checkFormBlocksSave` so cases that are not form validation
   * (a locked wizard button, a cancelled confirm dialog, a read-only screen) get the same reading
   * without dragging in two checks they never asked about.
   *
   * `knownPostLookups` covers apps that implement *lookups* as POST: the guard aborts those too, so
   * a scenario that visits such a screen must declare them, or its clean run reddens on the app's
   * own search box. Declare the narrowest path that identifies the lookup — passing the host would
   * disarm the assertion entirely.
   */
  const checkNoEscapedWrites = (
    blockedRequests: RecordedBlockedRequest[],
    testId: string,
    knownPostLookups: string[] = [],
  ): CheckResult => {
    const escaped = blockedRequests.filter(
      (request) =>
        !SAFE_HTTP_METHODS.has(request.method.toUpperCase()) && !knownPostLookups.some((lookup) => request.url.includes(lookup)),
    );
    return check(
      text.noWritesLabel,
      text.noWrites,
      escaped.length === 0 ? text.noWrites : text.escapedWrites(escaped.length, escaped.map((r) => `${r.method} ${r.url}`).join(' · ')),
      testId,
    );
  };

  /**
   * The three questions every "leave empty / enter bad input -> press Save" testcase asks,
   * answered the same way each time.
   *
   * Writing the comparison by hand per testcase is one more chance each time to make the same three
   * mistakes — reading `required` off the DOM, looking for an escaped write in `trace()` instead of
   * `blockedRequests`, and returning a chattier string on the PASS branch than `expected` carries,
   * which reddens a passing assertion. None of the three is reachable through this function.
   *
   * Returns exactly three checks, in step-matrix order: which fields were flagged, how many messages
   * and at which level, and whether anything left the browser. A caller that needs only some of them
   * still gets all three — dropping one silently is how an assertion id goes missing.
   */
  const checkFormBlocksSave = (input: FormBlocksSaveInput): CheckResult[] => {
    const flagged = Object.entries(input.formErrors)
      .filter(([, messages]) => messages.length > 0)
      .map(([field]) => field);

    const fieldMessageCount = Object.values(input.formErrors).reduce((sum, messages) => sum + messages.length, 0);
    const pageMessageCount = (input.pageMessages?.length ?? 0) + (input.dialogs?.length ?? 0);
    const observedCount = input.messageLevel === 'field' ? fieldMessageCount : pageMessageCount;
    const levelLabel = input.messageLevel === 'field' ? text.fieldLevel : text.pageLevel;

    const expectedMessages =
      input.expectedMessageCount === undefined ? text.atLeastOneMessage(levelLabel) : text.messageCount(input.expectedMessageCount, levelLabel);
    const actualMessages =
      input.expectedMessageCount === undefined
        ? observedCount >= 1
          ? expectedMessages
          : text.noMessages(levelLabel)
        : text.messageCount(observedCount, levelLabel);

    return [
      check(text.flaggedFieldsLabel, text.flaggedFields([...input.expectedFields].sort()), text.flaggedFields([...flagged].sort()), input.testIds.fields),
      check(text.messageCountLabel(levelLabel), expectedMessages, actualMessages, input.testIds.messages),
      checkNoEscapedWrites(input.blockedRequests, input.testIds.noWrite, input.knownPostLookups),
    ];
  };

  return {
    checkNoPageErrors,
    checkNoConsoleErrors,
    checkNoFailedRequests,
    findRequests,
    checkRequestObserved,
    checkRequestCount,
    checkContiguousSequence,
    checkAllContain,
    checkNoEscapedWrites,
    checkFormBlocksSave,
  };
}

export type UiChecks = ReturnType<typeof createUiChecks>;

export const {
  checkNoPageErrors,
  checkNoConsoleErrors,
  checkNoFailedRequests,
  checkRequestObserved,
  checkRequestCount,
  checkContiguousSequence,
  checkAllContain,
  checkNoEscapedWrites,
  checkFormBlocksSave,
} = createUiChecks();
