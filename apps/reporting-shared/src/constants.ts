/**
 * Constants for the QA Regression Reporting System
 */

export const TEST_RUN_RESULT = {
  PASS: 'PASS',
  PARTIAL: 'PARTIAL',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  ERROR: 'ERROR',
} as const;

export type TestRunResult = (typeof TEST_RUN_RESULT)[keyof typeof TEST_RUN_RESULT];

export const TEST_CASE_STATUS = {
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
  DRAFT: 'draft',
} as const;

export type TestCaseStatus = (typeof TEST_CASE_STATUS)[keyof typeof TEST_CASE_STATUS];

/**
 * Which layer a test case / run exercises.
 *
 * The regression runner knows this in memory ('kind' on a resolved scenario) but never
 * persists it, so the reporting DB derives it during sync: a run is UI when it has an
 * evidence manifest, with the 'ui-' scenario_key prefix as the fallback.
 */
export const RUN_TYPE = {
  API: 'api',
  UI: 'ui',
} as const;

export type RunType = (typeof RUN_TYPE)[keyof typeof RUN_TYPE];

/**
 * Suite module — the `src/suites/<module>/` folder a scenario lives in, mirroring the
 * `SuiteModule` union in the runner's harness/contract.ts. This is the
 * vocabulary the runner's own `--module` selector takes, so a value here reruns as
 * `npm run suite -- --module <value>`.
 *
 * Coarser than FEATURE_DOMAIN: `warehouse` covers two documentation modules.
 */
export const SUITE_MODULE = {
  PURCHASE_ORDER: 'purchase-order',
  SUPPLY_CONTRACT: 'supply-contract',
  WAREHOUSE: 'warehouse',
  CONTRACT_LABOR: 'contract-labor',
  PLATFORM: 'platform',
  PROJECT_ADMIN: 'project-admin',
  BOQ_ACCEPTANCE: 'boq-acceptance',
  ENTERPRISE_ADMIN: 'enterprise-admin',
  LABOR_REPORT: 'labor-report',
  MATERIAL_REPORT: 'material-report',
} as const;

export type SuiteModule = (typeof SUITE_MODULE)[keyof typeof SUITE_MODULE];

/**
 * Feature (documentation module) — the `docs/02-features/erp-feature-extraction/<domain>/`
 * vocabulary, mirroring DOMAIN_BY_TC_PREFIX in the runner's registry/artifact-group.ts. This is
 * the finer of the two and the one a QA lead filters by: `warehouse` splits into `kho` and
 * `kho-bao-cao-kho`.
 *
 * Includes domains that are documented but not yet automated — the runner pre-registers them for
 * the same reason, so a module's first run lands in the right bucket without a code change here.
 *
 * `_unknown` is not absence: it is the bucket for a producer that is not a registered scenario
 * (a probe, an ad hoc MCP session), matching UNKNOWN_DOMAIN in the runner.
 */
export const FEATURE_DOMAIN = {
  DON_HANG: 'don-hang',
  KHO: 'kho',
  KHO_BAO_CAO_KHO: 'kho-bao-cao-kho',
  HOP_DONG_VAT_TU: 'hop-dong-vat-tu',
  NHAN_CONG: 'nhan-cong',
  PLATFORM: 'platform',
  KIEM_SOAT_DAT_HANG_THUA: 'kiem-soat-dat-hang-thua',
  BOQ_GOP: 'boq-gop',
  BOQ_NGHIEM_THU_THANH_TOAN: 'boq-nghiem-thu-thanh-toan',
  CAU_HINH_VAT_TU: 'cau-hinh-vat-tu',
  QUY_CACH_DONG_GOI: 'quy-cach-dong-goi',
  QUAN_TRI_DOANH_NGHIEP: 'quan-tri-doanh-nghiep',
  QUAN_TRI_DU_AN: 'quan-tri-du-an',
  BAO_CAO_QUAN_TRI_NHAN_CONG: 'bao-cao-quan-tri-nhan-cong',
  BAO_CAO_QUAN_TRI_VAT_TU: 'bao-cao-quan-tri-vat-tu',
  UNKNOWN: '_unknown',
} as const;

export type FeatureDomain = (typeof FEATURE_DOMAIN)[keyof typeof FEATURE_DOMAIN];

/** Vietnamese screen names for the feature filter, keyed by domain. */
export const FEATURE_DOMAIN_LABEL: Record<FeatureDomain, string> = {
  'don-hang': 'Đơn hàng',
  kho: 'Kho',
  'kho-bao-cao-kho': 'Kho — Báo cáo kho',
  'hop-dong-vat-tu': 'Hợp đồng vật tư',
  'nhan-cong': 'Nhân công',
  platform: 'Nền tảng (đăng nhập, dùng chung)',
  'kiem-soat-dat-hang-thua': 'Kiểm soát đặt hàng thừa',
  'boq-gop': 'BOQ gộp',
  'boq-nghiem-thu-thanh-toan': 'BOQ — Nghiệm thu thanh toán',
  'cau-hinh-vat-tu': 'Cấu hình vật tư',
  'quy-cach-dong-goi': 'Quy cách đóng gói',
  'quan-tri-doanh-nghiep': 'Quản trị doanh nghiệp',
  'quan-tri-du-an': 'Quản trị dự án',
  'bao-cao-quan-tri-nhan-cong': 'Báo cáo quản trị nhân công',
  'bao-cao-quan-tri-vat-tu': 'Báo cáo quản trị vật tư',
  _unknown: 'Chưa phân loại',
};

/** Mirrors EvidenceKind in @qakit/core (evidence/types.ts), minus 'manifest' (the index itself is not an item). */
export const UI_EVIDENCE_KIND = {
  SCREENSHOT: 'screenshot',
  VIDEO: 'video',
  TRACE_ZIP: 'trace_zip',
  CONSOLE_LOG: 'console_log',
  NETWORK_HAR: 'network_har',
  DOM_SNAPSHOT: 'dom_snapshot',
  GRID_SNAPSHOT: 'grid_snapshot',
} as const;

export type UiEvidenceKind = (typeof UI_EVIDENCE_KIND)[keyof typeof UI_EVIDENCE_KIND];

export const REPRODUCIBILITY = {
  ALWAYS: 'Always',
  INTERMITTENT: 'Intermittent',
  NA: 'N/A',
} as const;

export type Reproducibility = (typeof REPRODUCIBILITY)[keyof typeof REPRODUCIBILITY];

export const DEFECT_SEVERITY = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
} as const;

export type DefectSeverity = (typeof DEFECT_SEVERITY)[keyof typeof DEFECT_SEVERITY];

export const REVIEW_VERDICT = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending',
  NEEDS_CLARIFICATION: 'needs_clarification',
} as const;

export type ReviewVerdict = (typeof REVIEW_VERDICT)[keyof typeof REVIEW_VERDICT];

export const REVIEW_TESTCASE_QUALITY = {
  EXCELLENT: 'excellent',
  GOOD: 'good',
  NEEDS_IMPROVEMENT: 'needs_improvement',
  POOR: 'poor',
} as const;

export type ReviewTestcaseQuality = (typeof REVIEW_TESTCASE_QUALITY)[keyof typeof REVIEW_TESTCASE_QUALITY];

export const REVIEW_ARTIFACT_KIND = 'review_record';

export const MAX_REVIEW_ARRAY_ITEMS = 50;
export const MAX_REVIEW_ARRAY_ITEM_LENGTH = 500;
export const MAX_REVIEW_LONG_TEXT_LENGTH = 5000;

export const ENTITY_TYPE = {
  PURCHASE_ORDER: 'purchase_order',
  SALES_ORDER: 'sales_order',
  CONTRACT: 'contract',
  ITEM: 'item',
  PROJECT: 'project',
  LOCATION: 'location',
  WORKFLOW: 'workflow',
  SUPPLIER: 'supplier',
  PHASE: 'phase',
  WORK_PACKAGE: 'work_package',
} as const;

export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

export const HTTP_METHOD = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
} as const;

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

export const REDMINE_LINK_TYPE = {
  FOLLOWS: 'follows',
  PRECEDES: 'precedes',
  RELATED: 'related',
  DUPLICATES: 'duplicates',
  DUPLICATED_BY: 'duplicated_by',
  BLOCKS: 'blocks',
  BLOCKED_BY: 'blocked_by',
} as const;

export type RedmineLinkType = (typeof REDMINE_LINK_TYPE)[keyof typeof REDMINE_LINK_TYPE];

/**
 * `bug_links.link_type` vocabulary — how a Redmine issue came to be associated with a
 * defect signature. Mirrors the `bug_links_link_type_check` CHECK constraint.
 *
 * Distinct from REDMINE_LINK_TYPE above, which is Redmine's *issue-to-issue relation*
 * vocabulary (follows/blocks/duplicates) and never appears in this column.
 */
export const BUG_LINK_TYPE = {
  CREATED_FROM_RUN: 'created_from_run',
  MANUALLY_LINKED: 'manually_linked',
  DUPLICATE_OF: 'duplicate_of',
} as const;

export type BugLinkType = (typeof BUG_LINK_TYPE)[keyof typeof BUG_LINK_TYPE];

export const API_RESPONSE_CODE = {
  SUCCESS: 'SUCCESS',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ApiResponseCode = (typeof API_RESPONSE_CODE)[keyof typeof API_RESPONSE_CODE];

// Pagination defaults
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Query limits
export const MAX_ARTIFACT_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_REVIEW_NOTE_LENGTH = 5000;
export const MAX_TAGS_PER_ITEM = 20;

// Filter defaults
export const DEFAULT_SORT_ORDER = 'DESC';
export const SORT_ORDERS = ['ASC', 'DESC'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/**
 * Issue priorities as configured on the target Redmine (`GET /enumerations/issue_priorities.json`).
 *
 * NOT Redmine's stock `Low/Normal/High/Urgent/Immediate` list — this install replaced it, so
 * sending a stock name makes RedmineService.resolvePriorityId() reject the request before it
 * ever reaches Redmine. The first five are the bug-triage scale; the MoSCoW entries below them
 * are used on story-type trackers.
 */
export const REDMINE_PRIORITY = [
  'Highest',
  'High',
  'Medium',
  'Low',
  'Lowest',
  'Must Have',
  'Should Have',
  'Could Have',
  "Won't Have",
] as const;

export type RedminePriority = (typeof REDMINE_PRIORITY)[number];

/** The subset of REDMINE_PRIORITY that applies to Bug/Defect trackers. */
export const REDMINE_BUG_PRIORITY = [
  'Highest',
  'High',
  'Medium',
  'Low',
  'Lowest',
] as const satisfies readonly RedminePriority[];

// ---------------------------------------------------------------------------
// Resolution Queue
//
// The queue groups *unresolved* evidence — BLOCKED / ERROR runs and NOT_EVALUATED
// checks — into canonical issues a human works through. It is deliberately NOT the
// defect workflow: an unresolved blocker is "the source does not tell us what to
// expect", not "the product is wrong". Only an issue a human classifies as
// PRODUCT_DEFECT ever reaches Redmine.
// ---------------------------------------------------------------------------

/**
 * What kind of thing is actually blocking the assertion. Set by a human, never by sync —
 * see `RESOLUTION_KIND.UNCLASSIFIED`, which is where every imported issue starts.
 */
export const RESOLUTION_KIND = {
  /** The specification is ambiguous/contradictory; a BA or tech lead must choose. */
  SPEC_DECISION: 'SPEC_DECISION',
  /** The environment lacks a record in the state the assertion needs. */
  TEST_DATA: 'TEST_DATA',
  /** Infrastructure, credentials, deploy state. */
  ENVIRONMENT: 'ENVIRONMENT',
  /** The harness cannot drive or observe the thing (missing driver verb, selector, API). */
  AUTOMATION: 'AUTOMATION',
  /** The feature is specified but not built yet. */
  MISSING_IMPLEMENTATION: 'MISSING_IMPLEMENTATION',
  /** Confirmed product defect — the only kind that belongs in Redmine. */
  PRODUCT_DEFECT: 'PRODUCT_DEFECT',
  /** Imported state. Nobody has triaged it. */
  UNCLASSIFIED: 'UNCLASSIFIED',
} as const;

export type ResolutionKind = (typeof RESOLUTION_KIND)[keyof typeof RESOLUTION_KIND];

/** What was actually done about it. Paired with the free-text `resolution`. */
export const RESOLUTION_TYPE = {
  SPEC_CLARIFIED: 'SPEC_CLARIFIED',
  DATA_PREPARED: 'DATA_PREPARED',
  ENVIRONMENT_FIXED: 'ENVIRONMENT_FIXED',
  AUTOMATION_FIXED: 'AUTOMATION_FIXED',
  PRODUCT_FIXED: 'PRODUCT_FIXED',
  DUPLICATE: 'DUPLICATE',
  WONT_RESOLVE: 'WONT_RESOLVE',
} as const;

export type ResolutionType = (typeof RESOLUTION_TYPE)[keyof typeof RESOLUTION_TYPE];

/**
 * Where the issue sits in the workflow. Transitions are validated in exactly one place —
 * `ResolutionWorkflowService` in the API — against RESOLUTION_TRANSITIONS below.
 */
export const RESOLUTION_WORKFLOW_STATUS = {
  OPEN: 'OPEN',
  WAITING_FOR_DECISION: 'WAITING_FOR_DECISION',
  DECIDED: 'DECIDED',
  READY_FOR_RERUN: 'READY_FOR_RERUN',
  VERIFIED: 'VERIFIED',
  RECURRED: 'RECURRED',
  WONT_RESOLVE: 'WONT_RESOLVE',
} as const;

export type ResolutionWorkflowStatus =
  (typeof RESOLUTION_WORKFLOW_STATUS)[keyof typeof RESOLUTION_WORKFLOW_STATUS];

/**
 * The complete transition table. A transition absent from here is rejected with
 * VALIDATION_ERROR — including no-op self-transitions, which are almost always a
 * double-submit rather than an intent.
 *
 * `VERIFIED -> RECURRED` is the one transition sync may perform on its own, and only when
 * new evidence arrives for an already-verified issue; it is always audited.
 */
export const RESOLUTION_TRANSITIONS: Record<
  ResolutionWorkflowStatus,
  readonly ResolutionWorkflowStatus[]
> = {
  OPEN: ['WAITING_FOR_DECISION', 'DECIDED', 'WONT_RESOLVE'],
  WAITING_FOR_DECISION: ['DECIDED', 'OPEN', 'WONT_RESOLVE'],
  DECIDED: ['READY_FOR_RERUN', 'WAITING_FOR_DECISION', 'WONT_RESOLVE'],
  READY_FOR_RERUN: ['VERIFIED', 'DECIDED', 'WONT_RESOLVE'],
  // Reopening is the only way out of a final state, and it demands a reason.
  VERIFIED: ['RECURRED', 'OPEN'],
  RECURRED: ['READY_FOR_RERUN', 'VERIFIED', 'DECIDED', 'WAITING_FOR_DECISION', 'WONT_RESOLVE'],
  WONT_RESOLVE: ['OPEN'],
};

/** Statuses a user may move to directly via `POST /:id/status` (the rest have dedicated verbs). */
export const RESOLUTION_DIRECT_STATUS_TARGETS = [
  'WAITING_FOR_DECISION',
  'READY_FOR_RERUN',
  'WONT_RESOLVE',
  'OPEN',
] as const satisfies readonly ResolutionWorkflowStatus[];

export type ResolutionDirectStatusTarget = (typeof RESOLUTION_DIRECT_STATUS_TARGETS)[number];

/** Triage priority. Same vocabulary as DEFECT_SEVERITY so the two lists sort alike. */
export const RESOLUTION_PRIORITY = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
} as const;

export type ResolutionPriority = (typeof RESOLUTION_PRIORITY)[keyof typeof RESOLUTION_PRIORITY];

/**
 * What a single observation actually observed.
 *
 * NOT_EVALUATED is a *check-level* fact; BLOCKED/PARTIAL/ERROR are *run-level*. Keeping them
 * in one column is what lets the list filter "show me only run-level blockers".
 */
export const RESOLUTION_OBSERVED_RESULT = {
  NOT_EVALUATED: 'NOT_EVALUATED',
  BLOCKED: 'BLOCKED',
  PARTIAL: 'PARTIAL',
  ERROR: 'ERROR',
} as const;

export type ResolutionObservedResult =
  (typeof RESOLUTION_OBSERVED_RESULT)[keyof typeof RESOLUTION_OBSERVED_RESULT];

/** Append-only audit vocabulary. Every state change writes exactly one of these. */
export const RESOLUTION_EVENT_ACTION = {
  CREATED: 'CREATED',
  CLASSIFIED: 'CLASSIFIED',
  ASSIGNED: 'ASSIGNED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  SUMMARY_UPDATED: 'SUMMARY_UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  DECISION_RECORDED: 'DECISION_RECORDED',
  RESOLUTION_RECORDED: 'RESOLUTION_RECORDED',
  VERIFIED: 'VERIFIED',
  VERIFIED_WITHOUT_RUN: 'VERIFIED_WITHOUT_RUN',
  REOPENED: 'REOPENED',
  RECURRED: 'RECURRED',
  DEFECT_LINKED: 'DEFECT_LINKED',
  REDMINE_LINKED: 'REDMINE_LINKED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  COMMENT_EDITED: 'COMMENT_EDITED',
} as const;

export type ResolutionEventAction =
  (typeof RESOLUTION_EVENT_ACTION)[keyof typeof RESOLUTION_EVENT_ACTION];

/**
 * The actor is self-asserted: this application has no authentication, no user model and no
 * guards. `actor` is whatever the caller typed, stored verbatim for traceability. See
 * docs/resolution-queue.md — "Identity and authorization".
 */
export const SYSTEM_ACTOR_SYNC = 'system:sync';

// Input caps. Enforced by the API DTOs; the UI mirrors them as maxLength hints.
export const MAX_RESOLUTION_ACTOR_LENGTH = 120;
export const MAX_RESOLUTION_TITLE_LENGTH = 500;
export const MAX_RESOLUTION_SUMMARY_LENGTH = 4000;
export const MAX_RESOLUTION_COMMENT_LENGTH = 8000;
export const MAX_RESOLUTION_DECISION_LENGTH = 8000;
export const MAX_RESOLUTION_RESOLUTION_LENGTH = 8000;
export const MAX_RESOLUTION_NOTE_LENGTH = 4000;
/** Free-text `reason` is required on reopen and on a verification override. */
export const MIN_RESOLUTION_REASON_LENGTH = 3;

/**
 * `TC-KHO-A08` -> `kho`. Mirrors DOMAIN_BY_TC_PREFIX and domainFromTestCaseId in the runner's
 * `src/harness/registry/artifact-group.ts`; keep the two in step.
 *
 * The reporting DB has this denormalized onto `test_runs.domain` and `test_cases.domain`, but
 * only for rows the runner persisted after those columns existed — 603 of the runs currently in
 * Postgres still have NULL, and the module_and_domain migration deliberately did not backfill
 * them. Deriving the domain from the test case id recovers almost all of those, which matters:
 * `_unknown` is a single bucket, and grouping a named blocker under it would let `BL-11` from two
 * unrelated features collide into one issue.
 */
const DOMAIN_BY_TC_PREFIX: Record<string, FeatureDomain> = {
  'TC-DH': FEATURE_DOMAIN.DON_HANG,
  'TC-KHO': FEATURE_DOMAIN.KHO,
  'TC-BCK': FEATURE_DOMAIN.KHO_BAO_CAO_KHO,
  'TC-HDVT': FEATURE_DOMAIN.HOP_DONG_VAT_TU,
  'TC-NC': FEATURE_DOMAIN.NHAN_CONG,
  'TC-UI': FEATURE_DOMAIN.PLATFORM,
  'TC-KSDH': FEATURE_DOMAIN.KIEM_SOAT_DAT_HANG_THUA,
  'TC-BOQG': FEATURE_DOMAIN.BOQ_GOP,
  'TC-BOQT': FEATURE_DOMAIN.BOQ_NGHIEM_THU_THANH_TOAN,
  'TC-CHVT': FEATURE_DOMAIN.CAU_HINH_VAT_TU,
  'TC-QCDG': FEATURE_DOMAIN.QUY_CACH_DONG_GOI,
  'TC-QTDN': FEATURE_DOMAIN.QUAN_TRI_DOANH_NGHIEP,
  'TC-QTDA': FEATURE_DOMAIN.QUAN_TRI_DU_AN,
  'TC-BCNC': FEATURE_DOMAIN.BAO_CAO_QUAN_TRI_NHAN_CONG,
  'TC-BCVT': FEATURE_DOMAIN.BAO_CAO_QUAN_TRI_VAT_TU,
};

/** Undefined for an id that is not shaped `TC-<CODE>-<SERIES><NN>` (probes, MCP sessions). */
export function domainFromTestCaseId(testCaseId: string | null | undefined): FeatureDomain | undefined {
  if (!testCaseId) return undefined;
  const parts = testCaseId.split('-');
  if (parts.length < 3 || parts[0] !== 'TC') return undefined;
  return DOMAIN_BY_TC_PREFIX[`${parts[0]}-${parts[1]}`];
}

// ============================================================================
// Regression Jobs — triggering a runner batch from the web UI
// ============================================================================

/**
 * Job lifecycle. Four non-terminal statuses, five terminal ones.
 *
 * The split between FAILED and ERRORED is the one that matters: FAILED means the batch ran and
 * the suite reported failures (the runner exits 1 on any FAIL, on "no scenario matched", and on
 * a harness throw); ERRORED means the job machinery broke — a spawn failure, a locked SQLite
 * file, a timeout — and the suite's verdict is unknown. Rendering both red is fine; conflating
 * them in the data is not, because only one of them says anything about the product.
 *
 * BLOCKED does not fail a batch (run-suite.ts sets its exit code from FAIL alone), so a
 * SUCCEEDED job can still carry a non-zero blocked_count.
 */
export const REGRESSION_JOB_STATUS = {
  QUEUED: 'QUEUED',
  PREPARING: 'PREPARING',
  RUNNING: 'RUNNING',
  SYNCING: 'SYNCING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  ERRORED: 'ERRORED',
  ORPHANED: 'ORPHANED',
} as const;

export type RegressionJobStatus = (typeof REGRESSION_JOB_STATUS)[keyof typeof REGRESSION_JOB_STATUS];

/**
 * The statuses that hold the single-job mutex. Mirrors the CHECK constraint on
 * `regression_jobs.active_slot`; the two must be changed together.
 *
 * QUEUED is in this set today because v1 rejects a second job rather than queueing it. Widening
 * to a real queue later means dropping QUEUED from here and from the CHECK, and adding a
 * dispatcher — nothing else in the state machine moves.
 */
export const REGRESSION_JOB_ACTIVE_STATUSES = [
  REGRESSION_JOB_STATUS.QUEUED,
  REGRESSION_JOB_STATUS.PREPARING,
  REGRESSION_JOB_STATUS.RUNNING,
  REGRESSION_JOB_STATUS.SYNCING,
] as const satisfies readonly RegressionJobStatus[];

export const REGRESSION_JOB_TERMINAL_STATUSES = [
  REGRESSION_JOB_STATUS.SUCCEEDED,
  REGRESSION_JOB_STATUS.FAILED,
  REGRESSION_JOB_STATUS.CANCELLED,
  REGRESSION_JOB_STATUS.ERRORED,
  REGRESSION_JOB_STATUS.ORPHANED,
] as const satisfies readonly RegressionJobStatus[];

export function isRegressionJobActive(status: RegressionJobStatus): boolean {
  return (REGRESSION_JOB_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** The runner's two suite kinds. Anything else makes `--kind` throw, so it must never be sent. */
export const REGRESSION_SUITE_KIND = { API: 'api', UI: 'ui' } as const;
export type RegressionSuiteKind = (typeof REGRESSION_SUITE_KIND)[keyof typeof REGRESSION_SUITE_KIND];

/**
 * How much of the runner's artifact tree a job wipes before running.
 *
 * `run` - delegated to the runner's own `--clean`: the `<domain>/<kind>/<TC-ID>` folders of the
 *         selected scenarios plus their rows in the runner's SQLite. Delegated because
 *         `purgeRuns` needs the runner's schema, which this package must not learn.
 * `all` - a hard reset, performed by the API itself and deliberately NOT the runner's
 *         `--clean-all`. That flag ignores the selection, also deletes `evidence/mcp-sessions/`
 *         (non-regenerable MCP audit logs), `reports/_batches/` and loose `outputs/*` files, and
 *         removes the three artifact trees BEFORE it discovers the database is locked, leaving a
 *         half-wiped workspace on Windows. See runner-workspace.util.ts in the API.
 */
export const REGRESSION_CLEAN_SCOPE = { RUN: 'run', ALL: 'all' } as const;
export type RegressionCleanScope = (typeof REGRESSION_CLEAN_SCOPE)[keyof typeof REGRESSION_CLEAN_SCOPE];

export const REGRESSION_DATA_MODE = { EXISTING: 'existing', SEEDED: 'seeded' } as const;
export type RegressionDataMode = (typeof REGRESSION_DATA_MODE)[keyof typeof REGRESSION_DATA_MODE];

/** Outcome of the Postgres/evidence sync a job runs after its batch. */
export const REGRESSION_JOB_SYNC_STATUS = {
  SKIPPED: 'SKIPPED',
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  OK: 'OK',
  FAILED: 'FAILED',
} as const;
export type RegressionJobSyncStatus =
  (typeof REGRESSION_JOB_SYNC_STATUS)[keyof typeof REGRESSION_JOB_SYNC_STATUS];

/** Which producer a log line came from. All three are tee'd into one file, in order. */
export const REGRESSION_JOB_LOG_STREAM = {
  /** The runner's stdout/stderr, verbatim. */
  RUNNER: 'runner',
  /** The API's own narration: guard results, wipe decisions, status transitions. */
  API: 'api',
  /** The sync's onProgress output. */
  SYNC: 'sync',
} as const;
export type RegressionJobLogStream =
  (typeof REGRESSION_JOB_LOG_STREAM)[keyof typeof REGRESSION_JOB_LOG_STREAM];

/** SSE event names on GET /api/regression-jobs/:id/logs/stream. */
export const REGRESSION_JOB_SSE_EVENT = {
  LOG: 'log',
  STATUS: 'status',
  HEARTBEAT: 'heartbeat',
  END: 'end',
} as const;
export type RegressionJobSseEvent =
  (typeof REGRESSION_JOB_SSE_EVENT)[keyof typeof REGRESSION_JOB_SSE_EVENT];

/**
 * Outcome of one "sync test scripts" pull of the runner checkout (POST
 * /api/regression-jobs/workspace/sync). `UP_TO_DATE` is a successful pull that moved nothing.
 */
export const REGRESSION_WORKSPACE_SYNC_STATUS = {
  UPDATED: 'updated',
  UP_TO_DATE: 'up_to_date',
  FAILED: 'failed',
} as const;
export type RegressionWorkspaceSyncStatus =
  (typeof REGRESSION_WORKSPACE_SYNC_STATUS)[keyof typeof REGRESSION_WORKSPACE_SYNC_STATUS];

/** Changed-file lists on a sync result are capped so a huge merge cannot bloat the response. */
export const MAX_REGRESSION_SYNC_CHANGED_FILES = 200;

// --- Input validation -------------------------------------------------------
//
// These are a security boundary, not a convenience: every value guarded here is spliced into an
// argv array handed to `spawn`. There is no shell, so injection is not the threat - a value that
// *looks like a flag* is. `--module` swallowing the next token, or a token beginning with `-`
// becoming a flag the runner silently ignores (parseArgs only warns on unknown args), turns a
// scoped run into a full 1140-scenario batch against shared UAT.

/** Module tokens, docs domains and the runner's aliases are all lowercase-and-hyphen. */
export const REGRESSION_MODULE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Testcase ids are NOT uniformly shaped - the runner's generated index holds `TC-DH-L01`,
 * `TC-BOQG-A04b`, `TC-DH-PCLoc`, `TC-BCVT-BK01` and `SPIKE-R01`. So this checks the character
 * set only, and the API validates the *value* against the live `--list` catalog instead:
 * syntax here, semantics there.
 */
export const REGRESSION_TEST_CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/;

/** Environment names map 1:1 to `configs/environments/<name>.json` in the runner. */
export const REGRESSION_ENV_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Grep is a free-text substring, so it bans only what would break the argv or a log line. */
export const REGRESSION_GREP_PATTERN = /^[^\r\n ]{1,120}$/;

/**
 * Custom parameter names, which become environment variables in the spawned runner.
 *
 * Upper snake case only. Not cosmetic: it is what makes a custom parameter unmistakably an
 * environment variable rather than something the form might have meant to send as a flag, and it
 * keeps the names out of the lowercase space every other selector in this file lives in.
 */
export const REGRESSION_CUSTOM_ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Values are free text — a fixture path, a GUID list, a base URL — so this bans only what would
 * corrupt the environment block itself. A NUL terminates a C string, and a newline would split one
 * value into two in every tool that prints an environment.
 */
export const REGRESSION_CUSTOM_ENV_VALUE_PATTERN = /^[^\0\r\n]*$/;

export const MAX_REGRESSION_CUSTOM_ENV_ENTRIES = 25;
export const MAX_REGRESSION_CUSTOM_ENV_VALUE_LENGTH = 2000;

export const MAX_REGRESSION_MODULES = 20;
export const MAX_REGRESSION_TEST_CASE_IDS = 100;
export const MAX_REGRESSION_GREP_LENGTH = 120;
export const MAX_REGRESSION_UI_SLOWMO_MS = 5000;
export const MAX_REGRESSION_REQUESTED_BY_LENGTH = 120;
/** A runaway line (a stack trace, a dumped payload) is truncated rather than left to bloat the log. */
export const MAX_REGRESSION_LOG_LINE_LENGTH = 4000;
/** Page-size cap for the log-tail endpoint. */
export const MAX_REGRESSION_LOG_TAIL_LIMIT = 5000;

/**
 * Environment variables the child runner must never inherit. It has no business with the
 * reporting database or the Redmine credentials, and a leaked DATABASE_URL reaching a scenario's
 * request trace would be written to disk as evidence.
 */
export const REGRESSION_CHILD_ENV_DENY_LIST = [
  'DATABASE_URL',
  'REDMINE_URL',
  'REDMINE_API_KEY',
  'REDMINE_DEFAULT_CUSTOM_FIELDS',
  'REDMINE_DEFAULT_VERSION',
  'EVIDENCE_STORAGE_PATH',
  'JOB_LOG_STORAGE_PATH',
] as const;

/**
 * Names a custom parameter may never set, on top of {@link REGRESSION_CHILD_ENV_DENY_LIST}.
 *
 * Two different hazards, both of which end with the job record describing a run that did not
 * happen:
 *
 * - **Process hijacking.** `PATH`, `NODE_OPTIONS` and the loader variables decide which binary and
 *   which code run. A custom parameter is a text box on a web form; it does not get to choose the
 *   interpreter.
 * - **Lying about the run.** The API owns the write switch, the cancel-file path and the colour
 *   settings. If a custom parameter could set the write switch, the "Allow destructive writes"
 *   checkbox and the preview's warning would both be false while real records were being modified.
 *
 * The write switch and the cancel-file variable are named by the deployment, so they are appended
 * at validation time rather than listed here (see `reservedCustomEnvNames`).
 */
export const REGRESSION_CUSTOM_ENV_RESERVED = [
  'PATH',
  'Path',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NO_COLOR',
  'FORCE_COLOR',
] as const;
