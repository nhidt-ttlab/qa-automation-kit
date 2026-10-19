import type {
  ReviewRecordResponseDto,
  ReviewVerdict,
} from '@qakit/reporting-shared';

import { toCsv } from '../../common/csv.util';

/**
 * CSV export of review records, for feeding QA's review feedback back into the scenario scripts
 * it was written about.
 *
 * One row per **suggestion item**, not per review: the consumer is an agent walking a list of
 * concrete edits to make, so every row has to name a single actionable thing. A review carrying
 * three suggested steps and two missing-coverage notes produces five rows, with the review's
 * verdict, summary and scenario identity repeated on each — that repetition is what makes a row
 * readable on its own, and is the point rather than redundancy.
 *
 * Pure: no Prisma, no filesystem, no clock. The clock is a parameter so the filename is testable.
 */

/** Columns, in the order an agent needs them: what to edit, then the verdict, then the one edit. */
export const REVIEW_CSV_COLUMNS = [
  'run_id',
  'test_case_id',
  'test_case_title',
  'scenario_key',
  'scenario_script',
  'run_type',
  'module',
  'domain',
  'feature_id',
  'run_result',
  'started_at',
  'verdict',
  'testcase_quality',
  'should_improve_testcase',
  'reviewer',
  'reviewed_at',
  'improvement_summary',
  'ai_generation_hint',
  'note',
  'suggestion_type',
  'suggestion_index',
  'suggestion_text',
] as const;

/**
 * The four review arrays, in the order an agent should work through them: what is missing first,
 * then how to cover it, then what to assert, then the data to do it with.
 *
 * `review_only` is not in here — it is the fallback emitted when all four are empty.
 */
const SUGGESTION_SOURCES = [
  { type: 'missing_coverage', field: 'missing_coverage' },
  { type: 'suggested_step', field: 'suggested_steps' },
  { type: 'suggested_assertion', field: 'suggested_assertions' },
  { type: 'suggested_test_data', field: 'suggested_test_data' },
] as const satisfies ReadonlyArray<{
  type: string;
  field: keyof ReviewRecordResponseDto;
}>;

/** A review joined to the run it was written about — everything one CSV row needs. */
export interface ExportableReview {
  review: ReviewRecordResponseDto;
  runId: string;
  testCaseId: string;
  testCaseTitle: string | null;
  scenarioKey: string;
  runType: string;
  module: string | null;
  domain: string | null;
  featureId: string | null;
  result: string;
  startedAt: Date | null;
}

/** ISO-8601, or empty. Dates stay machine-readable; the spreadsheet can reformat them. */
function iso(date: Date | null | undefined): string {
  return date ? date.toISOString() : '';
}

/**
 * The `.scenario.ts` an agent has to open, derived from the run alone: the suite folder is
 * `module`, the kind folder is `run_type`, and the file slug IS the scenario key (see
 * `scan-scenario-groups.ts` in the regression runner, which builds the key from the filename).
 *
 * Empty when `module` is NULL — that means the producer was not a registered scenario (a probe,
 * an MCP session), so there is no script to point at. An invented path would be worse than none.
 */
export function scenarioScriptPath(
  module: string | null,
  runType: string,
  scenarioKey: string,
): string {
  if (!module) return '';
  // Where the runner sits in the repository the CSV is read against, e.g. `tests/qa`.
  const prefix = (process.env.RUNNER_SCENARIO_PATH_PREFIX ?? '').replace(/\/+$/, '');
  const file = `src/suites/${module}/${runType}/${scenarioKey}.scenario.ts`;
  return prefix ? `${prefix}/${file}` : file;
}

/** The columns repeated on every row of one review, in REVIEW_CSV_COLUMNS order up to the split. */
function contextCells(entry: ExportableReview): unknown[] {
  const { review } = entry;
  return [
    entry.runId,
    entry.testCaseId,
    entry.testCaseTitle ?? '',
    entry.scenarioKey,
    scenarioScriptPath(entry.module, entry.runType, entry.scenarioKey),
    entry.runType,
    entry.module ?? '',
    entry.domain ?? '',
    entry.featureId ?? '',
    entry.result,
    iso(entry.startedAt),
    review.verdict,
    review.testcase_quality ?? '',
    review.should_improve_testcase,
    review.reviewer,
    review.reviewed_at,
    review.improvement_summary,
    review.ai_generation_hint,
    review.note ?? '',
  ];
}

/**
 * Rows for the given reviews, one per suggestion item.
 *
 * A review whose four arrays are all empty still gets exactly one row, typed `review_only`: its
 * verdict and improvement summary are the whole point of having reviewed it, and a review that
 * vanished from the export would read as "this run was never reviewed", which is a different and
 * wrong claim.
 */
export function buildReviewRows(
  entries: ReadonlyArray<ExportableReview>,
): unknown[][] {
  const rows: unknown[][] = [];

  for (const entry of entries) {
    const context = contextCells(entry);
    let emitted = 0;

    for (const source of SUGGESTION_SOURCES) {
      const items = entry.review[source.field];
      items.forEach((item, index) => {
        rows.push([...context, source.type, index + 1, item]);
        emitted += 1;
      });
    }

    if (emitted === 0) {
      rows.push([...context, 'review_only', '', '']);
    }
  }

  return rows;
}

/** Header row plus every suggestion row, BOM'd and CRLF'd by `toCsv`. */
export function buildReviewsCsv(
  entries: ReadonlyArray<ExportableReview>,
  options: { bom?: boolean } = {},
): string {
  return toCsv([[...REVIEW_CSV_COLUMNS], ...buildReviewRows(entries)], options);
}

/**
 * Timestamped to the second in UTC, so successive exports -- even two on the same day -- land
 * beside each other instead of overwriting. Colons become dashes because Windows forbids them.
 */
export function buildReviewExportFilename(now: Date): string {
  return `run-reviews-${now.toISOString().slice(0, 19).replace(/:/g, '-')}Z.csv`;
}

/** Verdict filter applied after parsing — see the note in ReviewsService.exportReviewsCsv. */
export function matchesReviewFilters(
  review: ReviewRecordResponseDto,
  filters: { verdict?: ReviewVerdict; should_improve_testcase?: boolean },
): boolean {
  if (filters.verdict && review.verdict !== filters.verdict) return false;
  if (
    filters.should_improve_testcase !== undefined &&
    review.should_improve_testcase !== filters.should_improve_testcase
  ) {
    return false;
  }
  return true;
}
