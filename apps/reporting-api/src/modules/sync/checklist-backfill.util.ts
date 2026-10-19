/**
 * Recovering a historical assertion's checklist mapping.
 *
 * Lives in `src/modules/sync` rather than beside the script for the same reason
 * `backfill-resolution-issues.ts` reuses `ResolutionProjectionService`: the rule for what counts as
 * a recorded mapping must have exactly one definition, or the backfill and anything that later
 * reads these columns can disagree about the same row.
 */

/**
 * The row id a historical `test_id` recorded, if any.
 *
 * Before the checklist columns existed, the trace appended the sheet row to the assertion id —
 * `TC-CHVT-U16 / A1 / TC_16`. That third segment is the mapping **as it was actually recorded at
 * run time**, which is why the backfill is allowed to trust it: it is reading history, not
 * reconstructing it.
 *
 * The current form has two segments and deliberately carries no row. Requiring exactly three is
 * what stops a present-day assertion from acquiring a mapping it never had.
 */
export function testcaseIdFromTestId(testId: string | null | undefined): string | undefined {
  if (!testId) return undefined;
  const parts = testId.split('/').map((p) => p.trim());
  if (parts.length !== 3) return undefined;
  const candidate = parts[2];
  return candidate && candidate.length > 0 ? candidate : undefined;
}

/** The checklist columns as they sit on a runner SQLite row. */
export interface SqliteCsvColumns {
  csv_checklist_id?: string | null;
  csv_testcase_id?: string | null;
  csv_expected?: string | null;
  csv_business_rule?: string | null;
  csv_priority?: string | null;
}

/** The same set, named as Prisma expects them. */
export interface PrismaCsvColumns {
  csvChecklistId: string | null;
  csvTestcaseId: string | null;
  csvExpected: string | null;
  csvBusinessRule: string | null;
  csvPriority: string | null;
}

/**
 * Carries the checklist snapshot from a runner row to a Postgres row, unchanged.
 *
 * Extracted from the sync's inline `checks.create` so it can be tested without standing up both
 * databases, and so the one rule that matters here is stated once: **this transforms nothing**. The
 * runner froze the sheet text when the run executed, and re-deriving it here — from today's CSV,
 * on the day of the import — would silently give an old run new wording.
 *
 * `?? null` rather than leaving fields undefined: a runner database created before these columns
 * existed yields rows without the properties, and Prisma would then omit the field instead of
 * writing NULL. `csv_business_rule` arrived after the other four, so a runner database can be
 * missing that one alone — the same rule covers it.
 */
export function csvColumnsFromSqliteCheck(check: SqliteCsvColumns): PrismaCsvColumns {
  return {
    csvChecklistId: check.csv_checklist_id ?? null,
    csvTestcaseId: check.csv_testcase_id ?? null,
    csvExpected: check.csv_expected ?? null,
    csvBusinessRule: check.csv_business_rule ?? null,
    csvPriority: check.csv_priority ?? null,
  };
}
