/**
 * Tri-state status of a single verification check.
 *
 * The regression harness records checks with a plain `passed: boolean`, but it encodes a third
 * state — "this assertion could not be scored at all" — as a *string convention* on the check's
 * `expected`/`actual` values rather than as a field: both sides are set to the literal marker
 * `NOT_EVALUATED` (optionally followed by a reason). Because `passed` is computed as
 * `expected === actual` (see `platform/assertions/index.ts` in the runner),
 * such a check is *trivially* `passed: true` and would otherwise render as a green tick — while
 * the run it belongs to is correctly reported as `PARTIAL`.
 *
 * This module is the read-side counterpart of the harness' own `checkpointRowStatus`
 * (`src/harness/report/report.ts`), which applies the same rule when rendering markdown reports.
 * Keep the two in sync.
 */
export const CHECK_STATUS = {
  PASSED: 'passed',
  FAILED: 'failed',
  NOT_EVALUATED: 'not_evaluated',
} as const;

export type CheckStatus = (typeof CHECK_STATUS)[keyof typeof CHECK_STATUS];

/**
 * True when a value carries the harness' `NOT_EVALUATED` marker convention: the literal token at
 * the start of the string, optionally followed by a reason (`NOT_EVALUATED (BL-16 — ...)`,
 * `NOT_EVALUATED — no comparison set`).
 */
export function isNotEvaluatedValue(value: unknown): boolean {
  return typeof value === 'string' && /^NOT_EVALUATED\b/.test(value.trim());
}

/**
 * Derives the tri-state status of a check. The marker on either side wins over `passed`, because
 * a not-evaluated check is trivially `passed: true` by construction.
 */
export function checkStatus(check: {
  expected?: unknown;
  actual?: unknown;
  passed: boolean;
}): CheckStatus {
  if (isNotEvaluatedValue(check.expected) || isNotEvaluatedValue(check.actual)) {
    return CHECK_STATUS.NOT_EVALUATED;
  }
  return check.passed ? CHECK_STATUS.PASSED : CHECK_STATUS.FAILED;
}

/** Counts each tri-state bucket in one pass — used for checklist card subheaders. */
export function summarizeCheckStatuses(
  checks: ReadonlyArray<{ expected?: unknown; actual?: unknown; passed: boolean }>,
): Record<CheckStatus, number> {
  const totals: Record<CheckStatus, number> = {
    [CHECK_STATUS.PASSED]: 0,
    [CHECK_STATUS.FAILED]: 0,
    [CHECK_STATUS.NOT_EVALUATED]: 0,
  };
  for (const check of checks) totals[checkStatus(check)] += 1;
  return totals;
}
