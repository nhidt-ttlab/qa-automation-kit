import type { CsvCheckMeta } from '../assertions.js';

/** Multi-row assertions collapse to one cell with this separator. */
export const CSV_COLUMN_JOIN = ' | ';

/** The checklist columns stored per check. All optional; all `undefined` when unmapped. */
export interface CsvCheckColumns {
  csvChecklistId?: string;
  csvTestcaseId?: string;
  csvExpected?: string;
  csvBusinessRule?: string;
  csvPriority?: string;
}

/**
 * Flattens an assertion's checklist rows to the stored shape.
 *
 * The single-row case round-trips byte for byte. An assertion answering several rows joins every
 * column with the same separator so the positions stay aligned; a row missing `Priority` or
 * `Business Rule` contributes an em dash rather than an empty segment, so the columns never shift.
 */
export function flattenCsvMeta(csv: readonly CsvCheckMeta[] | undefined): CsvCheckColumns {
  if (!csv || csv.length === 0) return {};
  const join = (parts: string[]): string => parts.join(CSV_COLUMN_JOIN);
  return {
    // One assertion never spans two sheets, so the ids collapse to the distinct set.
    csvChecklistId: join([...new Set(csv.map((c) => c.checklistId))]),
    csvTestcaseId: join(csv.map((c) => c.testcaseId)),
    csvExpected: join(csv.map((c) => c.expected)),
    csvBusinessRule: csv.some((c) => c.businessRule !== undefined) ? join(csv.map((c) => c.businessRule ?? '—')) : undefined,
    csvPriority: csv.some((c) => c.priority !== undefined) ? join(csv.map((c) => c.priority ?? '—')) : undefined,
  };
}

/** The stored columns, as they come back off a row. */
export interface StoredCsvColumns {
  csv_checklist_id: string | null;
  csv_testcase_id: string | null;
  csv_expected: string | null;
  /** Absent on a database written before the column existed, hence optional rather than nullable. */
  csv_business_rule?: string | null;
  csv_priority: string | null;
}

/**
 * Rebuilds the in-memory array from the stored columns — the inverse of {@link flattenCsvMeta}.
 *
 * `csvFile` and `csvLine` come back absent because they were never stored. Free-text columns are
 * split only when the segment count matches the id count; otherwise every entry keeps the whole
 * joined string, which is visibly a concatenation rather than a plausible-looking fragment.
 */
export function rebuildCsvMeta(row: StoredCsvColumns): CsvCheckMeta[] | undefined {
  const testcaseIds = row.csv_testcase_id?.split(CSV_COLUMN_JOIN) ?? [];
  if (testcaseIds.length === 0) return undefined;
  const checklistIds = row.csv_checklist_id?.split(CSV_COLUMN_JOIN) ?? [];

  const splitAligned = (value: string | null): string[] | undefined => {
    if (value === null) return undefined;
    const parts = value.split(CSV_COLUMN_JOIN);
    return parts.length === testcaseIds.length ? parts : undefined;
  };
  const expected = splitAligned(row.csv_expected);
  const businessRule = splitAligned(row.csv_business_rule ?? null);
  const priority = splitAligned(row.csv_priority);

  /** Undoes the em-dash placeholder the join inserts for a sheet missing the column entirely. */
  const cell = (parts: string[] | undefined, whole: string | null | undefined, i: number): string | undefined => {
    const value = parts?.[i] ?? whole ?? undefined;
    return value === '—' ? undefined : (value ?? undefined);
  };

  return testcaseIds.map((testcaseId, i) => ({
    checklistId: checklistIds[i] ?? checklistIds[0] ?? '',
    testcaseId,
    expected: expected?.[i] ?? row.csv_expected ?? '',
    businessRule: cell(businessRule, row.csv_business_rule, i),
    priority: cell(priority, row.csv_priority, i),
  }));
}
