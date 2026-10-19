/**
 * Data Transfer Objects (DTOs) for API requests and responses
 */

// Resolution Queue lives in its own file — it is a self-contained feature surface with its own
// request/response pairs, and inlining ~20 more interfaces here would not make either easier to read.
export * from './resolution.js';

// Regression Jobs, same call: a self-contained feature surface with its own request/response
// pairs, and the only one here that describes an action taken against the runner.
export * from './regression-jobs.js';

import {
  REVIEW_TESTCASE_QUALITY,
  MAX_REVIEW_NOTE_LENGTH,
  MAX_REVIEW_LONG_TEXT_LENGTH,
  MAX_REVIEW_ARRAY_ITEMS,
  MAX_REVIEW_ARRAY_ITEM_LENGTH,
} from '../constants.js';
import type {
  TestRunResult,
  TestCaseStatus,
  Reproducibility,
  DefectSeverity,
  ReviewVerdict,
  ReviewTestcaseQuality,
  EntityType,
  BugLinkType,
  RunType,
  UiEvidenceKind,
  SuiteModule,
  FeatureDomain,
  RedminePriority,
} from '../constants.js';
import type { CheckStatus } from '../check-status.js';
import type {
  PayloadEntry,
  CheckResult,
  ExecutionStep,
  RelatedEntity,
  HttpTraceEntry,
  TestRun,
  TestCase,
} from '../types/index.js';

// ============================================================================
// Request DTOs
// ============================================================================

export interface CreateTestCaseRequestDto {
  id: string;
  scenario_key: string;
  title: string;
  objective?: string;
  impacted_area?: string;
  module?: SuiteModule;
  domain?: FeatureDomain;
  owner?: string;
  status?: TestCaseStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateTestCaseRequestDto {
  title?: string;
  objective?: string;
  impacted_area?: string;
  module?: SuiteModule;
  domain?: FeatureDomain;
  owner?: string;
  status?: TestCaseStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateTestRunRequestDto {
  test_case_id: string;
  environment: string;
  dry_run?: boolean;
  result: TestRunResult;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  executed_by?: string;
  git_commit?: string;
  git_branch?: string;
  checks?: CheckResult[];
  steps?: ExecutionStep[];
  evidence?: HttpTraceEntry[];
  related_entities?: RelatedEntity[];
  business_scenario?: string;
  severity?: DefectSeverity;
  reproducibility?: Reproducibility;
  defect_statement?: string;
  blocked_reason?: string;
  error_summary?: string;
  conclusion?: string;
  overview_key_data?: string[];
  overview_highlights?: string[];
  payloads?: PayloadEntry[];
  tags?: string[];
  custom_data?: Record<string, unknown>;
}

export interface CreateReviewRequestDto {
  test_run_id: string;
  verdict: ReviewVerdict;
  note?: string;
  testcase_quality?: ReviewTestcaseQuality;
  should_improve_testcase?: boolean;
  improvement_summary?: string;
  missing_coverage?: string[];
  suggested_steps?: string[];
  suggested_assertions?: string[];
  suggested_test_data?: string[];
  ai_generation_hint?: string;
}

export interface UpdateReviewRequestDto {
  verdict?: ReviewVerdict;
  note?: string;
}

export interface CreateDefectSignatureRequestDto {
  title: string;
  severity: DefectSeverity;
  test_case_id?: string;
  scenario_key?: string;
  diagnosis?: string;
}

export interface LinkRedmineRequestDto {
  redmine_issue_id: number;
  redmine_url: string;
  redmine_project: string;
  link_type?: BugLinkType;
}

export interface RedmineCustomFieldValue {
  id: number;
  value: string | string[];
}

export interface CreateRedmineIssueRequestDto {
  project_key: string;
  tracker: string;
  subject: string;
  description?: string;
  priority?: RedminePriority;
  assigned_to?: string;

  /**
   * Redmine version name (e.g. `Harderning-T8/2026`), resolved to `fixed_version_id`.
   * A Bug tracker may require Target version, so when this is unset the service
   * falls back to REDMINE_DEFAULT_VERSION.
   */
  target_version?: string;

  /**
   * Instance-specific custom fields, passed through to Redmine as-is and merged over
   * REDMINE_DEFAULT_CUSTOM_FIELDS. A Bug tracker may make Report By (24),
   * ProjectCode (43), Actual/Expect Result (45) and Bugs_step_to_reproduce (46)
   * mandatory; omitting them makes Redmine reject the issue with HTTP 422.
   */
  custom_fields?: RedmineCustomFieldValue[];

  // Template-driven bug report fields (see bug-report-template.md). All optional:
  // when a run id is available (POST /api/runs/:runId/redmine) the service fills gaps
  // from the run record instead of requiring the caller to send everything manually.
  environment?: string;
  build_version?: string;
  device_os?: string;
  bug_type?: 'FE' | 'BE' | 'API';
  sprint?: string;
  steps_to_reproduce?: string[];
  actual_result?: string;
  expected_result?: string;
  impact?: string;
  severity?: DefectSeverity;
  is_regression?: boolean;
  related_bugs?: string;
  frequency?: string;
  notes?: string;

  // Extra labels to merge with the automatically-injected `Autotest` tag.
  tags?: string[];
}

// ============================================================================
// Query/Filter DTOs
// ============================================================================

export interface ListTestRunsQueryDto {
  test_case_id?: string;
  scenario_key?: string;
  run_type?: RunType;
  /**
   * Suite folder (`purchase-order`, ...) — the coarse grouping. Typed as a plain string, not
   * SuiteModule: the vocabulary grows with the suite tree, and rejecting a module this package
   * has not caught up with would be worse than returning its (correct) empty-or-not result.
   * SUITE_MODULE is what the UI offers as options.
   */
  module?: string;
  /** Documentation module (`don-hang`, `kho-bao-cao-kho`, ...) — the feature filter. See `module`. */
  domain?: string;
  environment?: string;
  result?: TestRunResult;
  reviewed?: boolean;
  dry_run?: boolean;
  tags?: string[];
  from_date?: string;
  to_date?: string;
  page: number;
  limit: number;
  sort_by?: 'created_at' | 'started_at' | 'result';
  sort_order?: 'ASC' | 'DESC';
}

export interface SearchQueryDto {
  q: string;
  entity_type?: 'test_case' | 'test_run' | 'defect' | 'bug' | 'resolution_issue';
  page: number;
  limit: number;
}

export interface DashboardQueryDto {
  environment?: string;
  module?: string;
  domain?: string;
  from_date?: string;
  to_date?: string;
}

export interface ListDefectSignaturesQueryDto {
  test_case_id?: string;
  scenario_key?: string;
  /** Resolved through the signature's test case: defect_signatures itself carries only scenario_key. */
  module?: string;
  domain?: string;
  severity?: DefectSeverity;
  status?: DefectSignatureStatus;
  page: number;
  limit: number;
}

export interface ListTestCasesQueryDto {
  status?: TestCaseStatus;
  owner?: string;
  scenario_key?: string;
  run_type?: RunType;
  module?: string;
  domain?: string;
  /** Screen number from the Feature List workbook. Matched as a case-insensitive substring. */
  feature_id?: string;
  /**
   * Hardening-checklist row filters, resolved through the case's runs: a case matches when any of
   * its runs has a check whose snapshot answers this checklist and, when both are given, this row
   * of it. Both are typed by the user and both match as case-insensitive substrings, like
   * `feature_id`: a prefix widens the result ("QLDN-VT" is a sheet family, "TC_1" also hits
   * "TC_16"), and a check answering several rows (stored joined with ` | `) is reached too.
   */
  csv_checklist_id?: string;
  csv_testcase_id?: string;
  q?: string;
  latest_run_result?: TestRunResult;
  page: number;
  limit: number;
  sort_by?: 'created_at' | 'updated_at' | 'title';
  sort_order?: 'ASC' | 'DESC';
}

/** Options for the Feature filter. Omit `run_type` for every domain across both layers. */
export interface ListTestCaseDomainsQueryDto {
  run_type?: RunType;
}

/**
 * The distinct `domain` values the runner has stamped on test cases, ascending with `_unknown`
 * last. Free strings rather than FeatureDomain: the DB is the source of truth and may hold a
 * documentation module this package does not know yet.
 */
export interface TestCaseDomainListResponseDto {
  domains: string[];
}

// ============================================================================
// Response DTOs
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface TestRunDetailResponseDto {
  id: string;
  test_case_id: string;
  scenario_key: string;
  /** Denormalized from the test case at read time — see TestCase#feature_id. */
  feature_id?: string;
  module?: SuiteModule;
  domain?: FeatureDomain;
  environment: string;
  dry_run: boolean;
  result: TestRunResult;
  run_type: RunType;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  executed_by?: string;
  git_commit?: string;
  git_branch?: string;
  business_scenario?: string;
  severity?: DefectSeverity;
  reproducibility?: Reproducibility;
  defect_statement?: string;
  blocked_reason?: string;
  error_summary?: string;
  conclusion?: string;
  overview_key_data: string[];
  overview_highlights: string[];
  payloads: PayloadEntry[];
  tags: string[];
  checks?: Array<{
    id: string;
    name: string;
    /**
     * Raw harness flag. A `not_evaluated` check is trivially `true` here (the harness builds it as
     * `expected === actual === 'NOT_EVALUATED …'`), so render from `status`, never from this.
     */
    passed: boolean;
    /** Tri-state derived by `checkStatus()` — the field UI should branch on. */
    status: CheckStatus;
    message?: string;
    expected?: unknown;
    actual?: unknown;
    /** Assertion id, e.g. `TC-UI-A01 / A2`. UI evidence references this via check_test_id. */
    test_id?: string;
    /**
     * Hardening-checklist snapshot: the CSV row this assertion answers, frozen at run time.
     *
     * Absent on assertions that answer no checklist row — most of them — and `csv_priority` is
     * additionally absent for sheets with no Priority column. Render an em dash for either case.
     *
     * These are the sheet's words about invented test data. They are **not** the value the
     * assertion was judged against: that stays `expected`/`actual` above, and `status` is derived
     * from those alone. An assertion answering several rows arrives joined with ` | `.
     */
    csv_checklist_id?: string;
    csv_testcase_id?: string;
    csv_expected?: string;
    /**
     * The `Business Rule / Checklist` cell — the rule the row exists to check, in the spec's own
     * words, where `csv_expected` says what one invented data set should produce under it. Absent
     * for sheets whose header has no such column, on top of the unmapped case above.
     */
    csv_business_rule?: string;
    csv_priority?: string;
  }>;
  steps?: Array<{
    id: string;
    name: string;
    description?: string;
    status: string;
    message?: string;
    /** 1-based position. UI evidence anchors to a step by matching step_sequence. */
    sequence: number;
  }>;
  evidence?: Array<{
    id: string;
    method: string;
    url: string;
    status: number;
    error?: string;
  }>;
  related_entities?: Array<{
    type: EntityType;
    id: string;
    label?: string;
    href?: string;
  }>;
  review?: ReviewRecordResponseDto;
  defects?: Array<{
    id: string;
    title: string;
    severity: DefectSeverity;
  }>;
  artifact_links?: Array<{
    type: string;
    url: string;
    label: string;
  }>;
  /**
   * Redmine tickets associated with this run: those filed from the run itself, merged
   * with those already attached to the run's defect signatures (which other runs
   * reproducing the same defect may have filed). Deduplicated by issue id.
   */
  redmine_links?: Array<{
    id: string;
    redmine_issue_id: number;
    redmine_url?: string | null;
    redmine_project?: string | null;
    link_type: BugLinkType;
    /** false when inherited from a defect signature another run reported. */
    created_from_this_run: boolean;
    created_at: string;
  }>;
  /** Present only on UI runs that have a synced evidence manifest. */
  ui_evidence?: UiEvidenceDto;
  created_at: string;
  updated_at: string;
}

/**
 * One captured browser artifact — a screenshot, the video, the Playwright trace, the HAR
 * or the console dump. Mirrors EvidenceItem in the regression runner, with two fields
 * already normalized for consumers:
 *   - `url` is an API route rather than the runner-relative `relPath`
 *   - `step_sequence` is 1-based to match TestRunStep.sequence (the manifest's `stepIndex`
 *     is 0-based; converting once in the sync keeps the off-by-one out of the UI)
 */
export interface UiEvidenceItemDto {
  id: string;
  kind: UiEvidenceKind;
  label: string;
  url: string;
  size_bytes: number;
  content_hash: string;
  captured_at: string;
  step_sequence?: number;
  /** Matches TestRunCheck.test_id, e.g. `TC-UI-A01 / A2`. */
  check_test_id?: string;
}

export interface UiEvidenceDto {
  scenario: string;
  generated_at: string;
  web_base_url: string;
  browser: { name: string; version: string };
  diagnostics: {
    page_errors: number;
    console_errors: number;
    failed_requests: number;
    blocked_requests: number;
  };
  /**
   * Set by the runner when console capture is unreliable (a terser `drop_console` build).
   * Must be surfaced anywhere `console_errors` is, or a 0 reads as "no problems".
   */
  console_capture_note?: string;
  items: UiEvidenceItemDto[];
}

export type DefectSignatureStatus = 'draft' | 'submitted' | 'duplicate' | 'resolved' | 'wontfix';

export interface DefectSignatureDetailResponseDto {
  id: string;
  title: string;
  severity: DefectSeverity;
  status: DefectSignatureStatus;
  diagnosis?: string;
  test_case_id?: string;
  scenario_key?: string;
  first_seen_at: string;
  last_seen_at: string;
  observation_count: number;
  linked_runs: Array<{
    id: string;
    environment: string;
    result: TestRunResult;
    observed_at: string;
  }>;
  bug_links?: Array<{
    id: string;
    redmine_issue_id: number;
    redmine_url: string;
    redmine_project: string;
    link_type: BugLinkType;
  }>;
  created_at: string;
  updated_at: string;
}

/**
 * Lightweight row shape for defect list views (no linked_runs/bug_links payload).
 */
export interface DefectSignatureSummaryResponseDto {
  id: string;
  title: string;
  severity: DefectSeverity;
  status: DefectSignatureStatus;
  scenario_key: string;
  first_seen_at: string;
  last_seen_at: string;
  observation_count: number;
  bug_link_count: number;
}

/**
 * Test run row shape for list views — the TestRun domain shape plus a
 * denormalized test case title for display, resolved via the testCase join.
 */
export interface TestRunListItemResponseDto extends TestRun {
  test_case_title?: string;
  /** Denormalized from the test case at read time — see TestCase#feature_id. */
  feature_id?: string;
}

export interface TestCaseListItemResponseDto extends TestCase {
  latest_run_id?: string;
  latest_run_result?: TestRunResult;
  latest_run_environment?: string;
  latest_run_started_at?: string;
  /** Screenshots on the latest run. UI cases only; counted from that run's evidence manifest. */
  latest_run_screenshot_count?: number;
  total_run_count: number;
}

export interface TestCaseDetailResponseDto extends TestCase {
  latest_run_id?: string;
  latest_run_result?: TestRunResult;
  latest_run_environment?: string;
  latest_run_started_at?: string;
  total_run_count: number;
}

export interface ReviewRecordResponseDto {
  id: string;
  test_run_id: string;
  verdict: ReviewVerdict;
  note?: string;
  reviewer: string;
  reviewed_at: string;
  testcase_quality?: ReviewTestcaseQuality;
  should_improve_testcase: boolean;
  improvement_summary: string;
  missing_coverage: string[];
  suggested_steps: string[];
  suggested_assertions: string[];
  suggested_test_data: string[];
  ai_generation_hint: string;
}

// ============================================================================
// Review normalization helpers
// ============================================================================

function clampText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.slice(0, maxLength);
}

function clampStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxItemLength));
}

const REVIEW_TESTCASE_QUALITY_VALUES: readonly string[] = Object.values(REVIEW_TESTCASE_QUALITY);

/**
 * Normalizes a raw review artifact blob (freshly built or read back from storage)
 * into the full `ReviewRecordResponseDto` shape. Backfills defaults for fields
 * missing from older, minimal review artifacts, and clamps every field to its
 * defensive size bound regardless of source — the single mechanism for both
 * backward compatibility and payload-size safety.
 */
export function normalizeReviewRecord(raw: Record<string, unknown>): ReviewRecordResponseDto {
  const testcaseQuality =
    typeof raw.testcase_quality === 'string' && REVIEW_TESTCASE_QUALITY_VALUES.includes(raw.testcase_quality)
      ? (raw.testcase_quality as ReviewTestcaseQuality)
      : undefined;

  return {
    id: String(raw.id),
    test_run_id: String(raw.test_run_id),
    verdict: raw.verdict as ReviewVerdict,
    note: typeof raw.note === 'string' ? clampText(raw.note, MAX_REVIEW_NOTE_LENGTH) : undefined,
    reviewer: String(raw.reviewer),
    reviewed_at: String(raw.reviewed_at),
    testcase_quality: testcaseQuality,
    should_improve_testcase: raw.should_improve_testcase === true,
    improvement_summary: clampText(raw.improvement_summary, MAX_REVIEW_LONG_TEXT_LENGTH),
    missing_coverage: clampStringArray(raw.missing_coverage, MAX_REVIEW_ARRAY_ITEMS, MAX_REVIEW_ARRAY_ITEM_LENGTH),
    suggested_steps: clampStringArray(raw.suggested_steps, MAX_REVIEW_ARRAY_ITEMS, MAX_REVIEW_ARRAY_ITEM_LENGTH),
    suggested_assertions: clampStringArray(
      raw.suggested_assertions,
      MAX_REVIEW_ARRAY_ITEMS,
      MAX_REVIEW_ARRAY_ITEM_LENGTH,
    ),
    suggested_test_data: clampStringArray(
      raw.suggested_test_data,
      MAX_REVIEW_ARRAY_ITEMS,
      MAX_REVIEW_ARRAY_ITEM_LENGTH,
    ),
    ai_generation_hint: clampText(raw.ai_generation_hint, MAX_REVIEW_LONG_TEXT_LENGTH),
  };
}

export interface DashboardSummaryResponseDto {
  metric_date: string;
  /**
   * Every execution ever recorded under the current filter. A scenario re-run twenty times while
   * a defect was being chased counts twenty times here — which is why these are NOT what
   * `pass_rate` divides. See `latest`.
   */
  total_runs: number;
  passed_runs: number;
  failed_runs: number;
  blocked_runs: number;
  error_runs: number;
  /**
   * Current state of the suite: one run per test case — its most recent — under the same filter.
   * A test case executed twenty times contributes exactly one row, carrying the verdict it holds
   * now, so re-running a failing scenario cannot move the number by repetition alone.
   */
  latest: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    error: number;
  };
  /**
   * `latest.passed / latest.total`, as a percentage rounded to two decimals — deliberately NOT
   * `passed_runs / total_runs`. "How much of the suite passes today" is the question this card
   * answers; the historical ratio answers "how often did executions pass", which drifts with
   * debugging churn rather than with product health.
   */
  pass_rate: number;
  reviewed_count: number;
  open_bugs: number;
  top_defects: Array<{
    id: string;
    title: string;
    observation_count: number;
    severity: DefectSeverity;
  }>;
  recent_failures: Array<{
    id: string;
    test_case_id: string;
    scenario_key: string;
    result: TestRunResult;
    created_at: string;
  }>;
  /**
   * Pass rate per documentation module, for the current filter — the breakdown the denormalized
   * `domain` column on test_runs exists to make cheap (no join). Runs whose producer was not a
   * registered scenario appear under `_unknown`.
   *
   * Counted on the same latest-run-per-test-case basis as the headline `pass_rate`, so a feature
   * cannot look healthier than the top-line number simply because its scenarios were re-run more
   * often. `total_runs`/`passed_runs` remain the all-executions counts, for context.
   */
  by_domain: Array<{
    domain: string;
    total_runs: number;
    passed_runs: number;
    latest_total: number;
    latest_passed: number;
    pass_rate: number;
  }>;
  /**
   * Resolution Queue health. Deliberately separate from `open_bugs`: an unresolved blocker is
   * "the source does not say what to expect", not a confirmed product defect, and counting the
   * two together is exactly the conflation the queue exists to undo.
   */
  resolution: {
    open_blockers: number;
    waiting_for_decision: number;
    ready_for_rerun: number;
    recurring: number;
    unclassified: number;
    verified: number;
    by_kind: Array<{ kind: string; total: number }>;
    by_domain: Array<{ domain: string; total: number; unresolved: number }>;
    by_owner: Array<{ owner: string; total: number }>;
    oldest_unresolved: Array<{
      id: string;
      display_key: string;
      title: string;
      workflow_status: string;
      first_seen_at: string;
    }>;
  };
}

export interface SearchResultResponseDto {
  type: 'test_case' | 'test_run' | 'defect' | 'bug' | 'resolution_issue';
  id: string;
  title?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
}

export interface RedmineIssueResponseDto {
  id: number;
  subject: string;
  description?: string;
  status: string;
  priority: string;
  assigned_to?: string;
  url: string;
  project: string;
  /** Tags applied to the issue, always including `Autotest` (see RedmineService for tagging strategy). */
  tags?: string[];
}
