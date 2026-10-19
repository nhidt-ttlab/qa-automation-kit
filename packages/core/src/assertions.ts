/**
 * Checklist metadata attached to one assertion, taken verbatim from a hardening-checklist sheet.
 *
 * **Never an oracle.** These strings are the sheet's wording about invented data; the value an
 * assertion is judged against stays `expected`/`actual` on the {@link CheckResult}. Nothing here
 * reaches `passed`.
 */
export interface CsvCheckMeta {
  /** Sheet id. Scopes `testcaseId`, which repeats across sheets. */
  checklistId: string;
  /** The sheet's row id, e.g. 'TC_16'. */
  testcaseId: string;
  /** The sheet's `Expected Result` cell, verbatim. */
  expected: string;
  /**
   * The sheet's business-rule cell, verbatim — the rule the row exists to check.
   *
   * Absent where the sheet has no such column. It states the rule in the spec's own terms, where
   * {@link expected} states what one invented data set should produce under it, which is why a
   * reviewer reads this first and the expected cell second.
   */
  businessRule?: string;
  /** The sheet's `Priority` cell, verbatim. Absent where the sheet has no such column. */
  priority?: string;
  /**
   * Project-relative CSV path. Rendered in Markdown, **not** stored per check.
   *
   * Optional because of that: a live run always has it (the trace reads it from the imported
   * sheet), while a result rebuilt from the database does not — only the four stored columns
   * survive a round trip. Absent here means "not persisted", never "unknown at run time".
   */
  csvFile?: string;
  /** 1-based line in that CSV. Optional for the same reason as {@link csvFile}. */
  csvLine?: number;
}

export interface CheckResult {
  label: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  /** Test-case/test-step id this check maps to (e.g. "TC-ORD-R02 / A2"). Prefer setting it explicitly over letting the report infer it. */
  testId?: string;
  /**
   * Hardening-checklist rows this assertion answers, if any.
   *
   * An array because one assertion can answer several rows; the overwhelming majority carry zero or
   * one. Attached by the checklist trace, never built by hand in a scenario — the whole point is
   * that the text comes from the sheet rather than from a literal someone retyped.
   */
  csv?: CsvCheckMeta[];
}

/** Builds a single labeled expected-vs-actual comparison for a report's verification checklist. */
export function check(label: string, expected: unknown, actual: unknown, testId?: string): CheckResult {
  return { label, expected, actual, passed: expected === actual, testId };
}

export class AssertionError extends Error {}

export function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new AssertionError(message);
  return value;
}
