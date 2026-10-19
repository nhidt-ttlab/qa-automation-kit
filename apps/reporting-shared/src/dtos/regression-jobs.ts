/**
 * Regression Job DTOs.
 *
 * A regression job is one batch the web UI asked the runner to execute. This is the only surface
 * in the reporting API that describes an action taken *against* the runner rather than evidence
 * the runner produced, and the distinction shapes the whole contract:
 *
 *   - The job row is an audit record. `argv` and `env_patch` hold the exact command that was
 *     spawned, so "what did this job actually run" stays answerable months later without a log.
 *   - Job ids are never linked to run ids by a foreign key. A job describes an action, a test run
 *     describes evidence; linking them would invite deleting evidence when a job is cleaned up.
 *   - Nothing here is written by the sync. Every field is owned by this API.
 *
 * Wire format is snake_case (Prisma is camelCase), matching every other DTO in this package.
 */

import type {
  RegressionCleanScope,
  RegressionDataMode,
  RegressionJobLogStream,
  RegressionJobStatus,
  RegressionJobSyncStatus,
  RegressionSuiteKind,
  RegressionWorkspaceSyncStatus,
} from '../constants.js';

// ============================================================================
// Selection
// ============================================================================

/**
 * What to run. Every facet is ANDed, and an empty selector means the whole suite.
 *
 * `test_case_ids` and `grep` are NOT interchangeable: grep is a case-insensitive substring over
 * the scenario key or the testcase id, so `TC-DH-L0` also takes `TC-DH-L01..L09`, while
 * `test_case_ids` matches ids exactly. A caller that means "these five testcases and nothing
 * else" must use `test_case_ids`.
 */
export interface RegressionJobSelectorDto {
  kind?: RegressionSuiteKind | null;
  /** Suite module, docs domain, or one of the runner's aliases. Empty means every module. */
  modules?: string[] | null;
  /** Exact testcase ids, case-insensitive. Validated against the runner's live catalog. */
  test_case_ids?: string[] | null;
  grep?: string | null;
}

/** How the batch behaves once the selection is fixed. */
export interface RegressionJobFlagsDto {
  /** Defaults to `qa`; must name a `configs/environments/<name>.json` in the runner. */
  environment?: string;
  /** Omit for no cleaning at all. `all` is the destructive default the UI offers. */
  clean_scope?: RegressionCleanScope | null;
  data_mode?: RegressionDataMode;
  /**
   * Sets the runner's write switch (`RUNNER_WRITES_ENV`) in the child. When false the API passes `'0'` explicitly,
   * because the runner's own `.env` sets it to `1` and its loader only fills unset keys - so an
   * absent patch would silently mean write mode.
   */
  write_mode?: boolean;
  bail?: boolean;
  /**
   * Tri-state on purpose. `null`/absent says nothing and lets the runner's own default apply,
   * which flips with write mode; sending `false` unconditionally would emit `--no-cleanup` on
   * every write run and leave unmarked rows in shared UAT.
   */
  cleanup?: boolean | null;
  headed?: boolean;
  ui_slowmo_ms?: number | null;
  /**
   * Extra environment variables for the spawned runner — the "custom parameters" the Regression
   * form offers.
   *
   * Environment variables rather than extra CLI arguments, because that is the only input a suite
   * can read without the API knowing the suite exists. The runner's `parseArgs` merely *warns* on
   * an argument it does not recognise, so an unknown flag would be swallowed in silence, while a
   * suite gated on (say) `REPLACE_MATERIAL_PROJECT_IDS` reads its variable directly and refuses
   * loudly when it is wrong.
   *
   * Names are validated, and the ones the API owns cannot be overridden - see
   * `REGRESSION_CUSTOM_ENV_RESERVED`. Whatever survives is merged into `env_patch` on the job
   * record, so the audit trail keeps saying exactly what the child was given.
   *
   * Values are stored in plain text on the job row and readable by anyone who can open the run.
   * They are for configuration, not for credentials.
   */
  custom_env?: Record<string, string> | null;
}

export interface CreateRegressionJobRequestDto
  extends RegressionJobSelectorDto,
    RegressionJobFlagsDto {
  requested_by: string;
  /**
   * Required when `clean_scope` is `all`. Not a formality: that scope deletes the runner's whole
   * artifact tree and its SQLite history, well beyond the scenarios selected above.
   */
  confirm_clean_all?: boolean;
}

export type PreviewRegressionJobRequestDto = RegressionJobSelectorDto;

// ============================================================================
// Preview
// ============================================================================

/** One row of the runner's `--list` output. */
export interface RegressionScenarioDto {
  test_case_id: string;
  kind: RegressionSuiteKind;
  domain: string;
  scenario: string;
}

/**
 * What a selector resolves to, taken by running the runner's `--list`. That path returns before
 * the runner parses its environment or opens a session, so a preview needs no credentials,
 * touches no tenant and executes nothing.
 */
export interface RegressionPreviewResponseDto {
  /** Authoritative count, read off the runner's own summary line rather than counting rows. */
  total: number;
  /** A capped sample for display; `total` is the real number. */
  items: RegressionScenarioDto[];
  /** The batch label the runner will compute, which also names the summary file. */
  label: string;
  /** From the runner, so a "nothing matched" hint can name real tokens without duplicating them. */
  known_module_tokens: string[];
  /**
   * Non-fatal advisories for the confirmation dialog: destructive writes, seeded data on a shared
   * tenant, a clean scope wider than the selection, Playwright needed for a UI batch.
   */
  warnings: string[];
}

/** Static choices and runner health, for building the form. */
export interface RegressionJobOptionsResponseDto {
  environments: string[];
  module_tokens: string[];
  scenarios: RegressionScenarioDto[];
  /** False when the runner checkout or its `tsx` is missing; the form disables submit instead of failing at spawn. */
  runner_available: boolean;
  runner_unavailable_reason?: string | null;
}

// ============================================================================
// The job
// ============================================================================

/** List-row shape: everything the history table renders, and nothing heavier. */
export interface RegressionJobSummaryResponseDto {
  id: number;
  status: RegressionJobStatus;
  requested_by: string;
  label: string;
  environment: string;
  kind?: RegressionSuiteKind | null;
  modules: string[];
  test_case_ids: string[];
  grep?: string | null;
  clean_scope?: RegressionCleanScope | null;
  data_mode: RegressionDataMode;
  write_mode: boolean;
  /** From the pre-flight preview, so progress can be shown as `done / selected` from the first line. */
  selected_count?: number | null;
  pass_count?: number | null;
  blocked_count?: number | null;
  fail_count?: number | null;
  sync_status?: RegressionJobSyncStatus | null;
  queued_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
}

export interface RegressionJobDetailResponseDto extends RegressionJobSummaryResponseDto {
  bail: boolean;
  cleanup?: boolean | null;
  headed: boolean;
  ui_slowmo_ms?: number | null;
  /** The exact argv handed to `spawn`, excluding node, the tsx cli and the script path. */
  argv: string[];
  /** Only the deliberate patch, never the inherited environment. */
  env_patch: Record<string, string>;
  pid?: number | null;
  exit_code?: number | null;
  signal?: string | null;
  cancel_requested_at?: string | null;
  cancel_requested_by?: string | null;
  /** Sequence of the last line written. A page loaded mid-run opens its stream at this offset. */
  last_seq: number;
  /** Runner-relative path of the batch summary markdown, once the runner has reported it. */
  summary_path?: string | null;
  error_summary?: string | null;
  synced_run_count?: number | null;
}

/** The 409 body when a job is already in flight, so the UI can offer "Watch it" instead of a dead end. */
export interface RegressionJobConflictDetailsDto {
  active_job_id: number;
  active_job_status: RegressionJobStatus;
}

export interface CancelRegressionJobRequestDto {
  requested_by: string;
}

// ============================================================================
// Logs
// ============================================================================

export interface RegressionJobLogLineDto {
  /** 1-based, gapless, and the SSE event id. Reconnect asks for everything after a sequence. */
  seq: number;
  ts: string;
  stream: RegressionJobLogStream;
  text: string;
}

export interface RegressionJobLogTailResponseDto {
  job_id: number;
  lines: RegressionJobLogLineDto[];
  /** Sequence to ask for next; equals the last returned seq, or the request's `from_seq` when empty. */
  next_seq: number;
  /** Total lines written so far, so a caller can tell "caught up" from "more to fetch". */
  total: number;
  status: RegressionJobStatus;
}

/** Payload of the SSE `status` event: the cheap fields that change while a batch runs. */
export interface RegressionJobStatusEventDto {
  job_id: number;
  status: RegressionJobStatus;
  selected_count?: number | null;
  pass_count?: number | null;
  blocked_count?: number | null;
  fail_count?: number | null;
  /** Scenarios finished so far, parsed from the runner's `[n/total]` progress lines. */
  completed_count?: number | null;
}

// ============================================================================
// Workspace: the test-script checkout the runner executes from
// ============================================================================

/**
 * One pull of the runner checkout, triggered from the UI so new or changed scenario scripts can be
 * run without anyone logging on to the server. Returned by the sync endpoint and kept as
 * `last_sync` on the workspace status until the API restarts.
 */
export interface RegressionWorkspaceSyncResponseDto {
  status: RegressionWorkspaceSyncStatus;
  requested_by: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  branch: string | null;
  before_sha: string | null;
  after_sha: string | null;
  /** Commits the pull moved HEAD forward by. 0 when already up to date or failed. */
  commits_pulled: number;
  /**
   * Files changed under the runner checkout, relative to it. Capped at
   * MAX_REGRESSION_SYNC_CHANGED_FILES; `changed_file_count` is the real number.
   */
  changed_files: string[];
  changed_file_count: number;
  /** `*.scenario.ts` files among the changed ones: the scripts a tester actually cares about. */
  scenario_files_changed: number;
  /** package.json or its lockfile changed under the runner, so `npm install` was needed. */
  dependencies_changed: boolean;
  /** Whether `npm install` ran and succeeded. */
  dependencies_installed: boolean;
  /** The scenario catalog cache was dropped, so the form's module/testcase lists show the new scripts. */
  catalog_refreshed: boolean;
  /** One human-readable line for a toast or alert. */
  message: string;
  /** Tail of the git (and npm) output, for the operator when something goes wrong. */
  output: string;
}

/** Where the runner's scripts come from and what revision is checked out right now. */
export interface RegressionWorkspaceStatusResponseDto {
  /** Absolute path of the runner checkout (REGRESSION_RUNNER_PATH resolved). */
  runner_root: string;
  /** The git repository containing it; null when the runner is not inside a git checkout. */
  repo_root: string | null;
  is_git_repo: boolean;
  branch: string | null;
  /** The tracking branch, e.g. `origin/develop`; null when the branch has none, which makes sync impossible. */
  upstream: string | null;
  head_sha: string | null;
  head_short_sha: string | null;
  head_subject: string | null;
  head_committed_at: string | null;
  /** Tracked files under the runner with uncommitted modifications. A pull refuses to overwrite these. */
  dirty_file_count: number;
  sync_in_progress: boolean;
  last_sync: RegressionWorkspaceSyncResponseDto | null;
}

export interface SyncRegressionWorkspaceRequestDto {
  requested_by: string;
}
