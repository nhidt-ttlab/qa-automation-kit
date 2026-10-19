import type { QaVerdict } from './model.js';
import type { ReportableResult } from './result.js';

/** Reads `result.blocked` defensively — scenarios represent it either as a boolean flag or as the reason string itself. */
export function isBlockedResult(result: Pick<ReportableResult, 'blocked'>): boolean {
  const flag = result.blocked;
  if (typeof flag === 'string') return flag.length > 0;
  return Boolean(flag);
}

/**
 * True when a check's `expected`/`actual` carries the `NOT_EVALUATED` marker scenarios use for
 * checkpoints intentionally excluded from grading. That marker also makes `expected === actual`
 * trivially true, which is why the plain `passed` boolean alone is unsafe to grade on.
 */
export function isNotEvaluatedValue(value: unknown): boolean {
  return typeof value === 'string' && /^NOT_EVALUATED\b/.test(value.trim());
}

/** Row-level status for one checkpoint, keeping a not-evaluated checkpoint distinct from a real PASS/FAIL. */
export function checkpointRowStatus(check: { expected: unknown; actual: unknown; passed: boolean }): 'PASS' | 'FAIL' | 'NOT_EVALUATED' {
  if (isNotEvaluatedValue(check.expected) || isNotEvaluatedValue(check.actual)) return 'NOT_EVALUATED';
  return check.passed ? 'PASS' : 'FAIL';
}

/**
 * Derives a scenario-level verdict from its checklist plus its `passed`/`blocked` signals — the
 * single source of truth for the report header, the QA summary and the persisted run result.
 *
 * Priority:
 *  - a real FAIL checkpoint outside of a blocked run → FAIL.
 *  - any blocked signal downgrades the run: to BLOCKED when no checkpoint passed, else PARTIAL.
 *  - a NOT_EVALUATED checkpoint on an otherwise-clean run downgrades a would-be PASS to PARTIAL.
 *  - otherwise the scenario's own `passed` flag.
 */
export function deriveVerdict(input: {
  checks?: Array<{ expected: unknown; actual: unknown; passed: boolean }>;
  passed: boolean;
  blocked: boolean;
}): QaVerdict {
  const rows = (input.checks ?? []).map(checkpointRowStatus);
  const passCount = rows.filter((r) => r === 'PASS').length;
  const failCount = rows.filter((r) => r === 'FAIL').length;
  const notEvaluatedCount = rows.filter((r) => r === 'NOT_EVALUATED').length;

  if (failCount > 0 && !input.blocked) return 'FAIL';
  if (input.blocked) return passCount > 0 ? 'PARTIAL' : 'BLOCKED';
  if (notEvaluatedCount > 0) return 'PARTIAL';
  return input.passed ? 'PASS' : 'FAIL';
}

/** The verdict of a whole result. */
export function resultVerdict(result: Pick<ReportableResult, 'checks' | 'passed' | 'blocked'>): QaVerdict {
  return deriveVerdict({ checks: result.checks, passed: result.passed, blocked: isBlockedResult(result) });
}
