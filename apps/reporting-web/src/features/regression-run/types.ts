/**
 * Presentation vocabulary for the Regression Runs screens: the form draft, its translation to a
 * request, and the label/tone maps the table and chips read.
 */
import {
  REGRESSION_JOB_STATUS,
  type CreateRegressionJobRequestDto,
  type PreviewRegressionJobRequestDto,
  type RegressionCleanScope,
  type RegressionDataMode,
  type RegressionJobStatus,
  type RegressionJobSummaryResponseDto,
  type RegressionSuiteKind,
} from '@qakit/reporting-shared';
import type { StatusTone } from '../../shared/components/StatusChip';

/** Clean scope in the form, where "don't clean" needs to be a selectable third option. */
export type CleanChoice = 'none' | 'run' | 'all';

/**
 * One custom parameter row in the form.
 *
 * An ordered list rather than the `Record` the request carries, because a record cannot hold a
 * half-typed key: editing `FOO` into `FOOBAR` one keystroke at a time would rename the property
 * on every keystroke, and two blank rows would collapse into one.
 */
export interface CustomParam {
  key: string;
  value: string;
}

/**
 * The form's own state.
 *
 * Kind and clean are widened to include an explicit empty/none member because a radio group and a
 * select need a value for "not chosen"; `draftToRequest` narrows them back.
 */
export interface RunJobDraft {
  kind: RegressionSuiteKind | '';
  modules: string[];
  testCaseIds: string[];
  grep: string;
  environment: string;
  clean: CleanChoice;
  dataMode: RegressionDataMode;
  writeMode: boolean;
  bail: boolean;
  /** Tri-state: null means "let the runner decide", which is not the same as false. */
  cleanup: boolean | null;
  headed: boolean;
  uiSlowMoMs: number | null;
  /**
   * Extra environment variables for the runner — how a suite gets an input this form knows
   * nothing about (a fixture path, a project-id scope). See RegressionJobFlagsDto.custom_env.
   */
  customParams: CustomParam[];
}

/**
 * Clean defaults to `all` deliberately: a fresh workspace per run is what the team asked for. It
 * is also the reason the preview dialog cannot be skipped — see RunPreviewDialog.
 */
export function createEmptyDraft(): RunJobDraft {
  return {
    kind: '',
    modules: [],
    testCaseIds: [],
    grep: '',
    environment: 'qa',
    clean: 'all',
    dataMode: 'existing',
    writeMode: false,
    bail: false,
    cleanup: null,
    headed: false,
    uiSlowMoMs: null,
    customParams: [],
  };
}

/**
 * The draft's parameter rows as the request's `custom_env` object.
 *
 * Rows with a blank key are dropped — they are the empty row the editor keeps at the bottom, not
 * an instruction. A blank *value* is kept, because `FOO=` is a thing a caller can mean and the
 * API is where that argument gets settled, not here.
 *
 * Keys are upper-cased to match what the API accepts, so a lowercase paste is corrected rather
 * than rejected. A later row with the same key wins, which is what the last thing you typed
 * looking like the thing that takes effect means.
 */
export function customEnvFromDraft(draft: RunJobDraft): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const { key, value } of draft.customParams) {
    const name = key.trim().toUpperCase();
    if (name === '') continue;
    out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Selector-only projection, for the preview call. */
export function draftToPreviewRequest(draft: RunJobDraft): PreviewRegressionJobRequestDto {
  return {
    // The house rule is that '' means "All" and the key is omitted rather than sent empty. Extended
    // to arrays here: an empty array is not "no filter" to a backend that receives it, so it is
    // omitted too.
    kind: draft.kind || undefined,
    modules: draft.modules.length > 0 ? draft.modules : undefined,
    test_case_ids: draft.testCaseIds.length > 0 ? draft.testCaseIds : undefined,
    grep: draft.grep.trim() || undefined,
  };
}

export function draftToRequest(
  draft: RunJobDraft,
  requestedBy: string,
): CreateRegressionJobRequestDto {
  return {
    ...draftToPreviewRequest(draft),
    requested_by: requestedBy,
    environment: draft.environment,
    clean_scope: draft.clean === 'none' ? undefined : (draft.clean as RegressionCleanScope),
    data_mode: draft.dataMode,
    write_mode: draft.writeMode,
    bail: draft.bail,
    // The tri-state again: null must not become false, or every write run would be told
    // --no-cleanup and leave unmarked rows in shared UAT.
    cleanup: draft.cleanup === null ? undefined : draft.cleanup,
    headed: draft.headed,
    ui_slowmo_ms: draft.uiSlowMoMs ?? undefined,
    custom_env: customEnvFromDraft(draft),
    confirm_clean_all: draft.clean === 'all' ? true : undefined,
  };
}

/**
 * Which draft fields differ from the defaults, for the "N changed" badge on the advanced section.
 * The default environment is the runner's first, which is not necessarily the built-in 'qa'.
 */
export function countChangedAdvanced(
  draft: RunJobDraft,
  defaultEnvironment: string = createEmptyDraft().environment,
): number {
  const base = createEmptyDraft();
  let n = 0;
  if (draft.environment !== defaultEnvironment) n++;
  if (draft.dataMode !== base.dataMode) n++;
  if (draft.writeMode !== base.writeMode) n++;
  if (draft.bail !== base.bail) n++;
  if (draft.cleanup !== base.cleanup) n++;
  if (draft.headed !== base.headed) n++;
  if (draft.uiSlowMoMs !== base.uiSlowMoMs) n++;
  // Counted as one, not one per row: the badge answers "is anything non-default hidden in there",
  // and five parameters are one decision to look.
  if (customEnvFromDraft(draft) !== undefined) n++;
  return n;
}

// --- URL prefill (the Rerun contract) --------------------------------------
//
// Query params rather than router state: a link survives a reload and can be pasted into a ticket,
// and TestCaseListPage already establishes ?type=ui as the idiom for cross-page intent.

export function draftFromSearchParams(params: URLSearchParams): Partial<RunJobDraft> {
  const patch: Partial<RunJobDraft> = {};
  const kind = params.get('kind');
  if (kind === 'api' || kind === 'ui') patch.kind = kind;
  const modules = params.get('module');
  if (modules) patch.modules = modules.split(',').map((m) => m.trim()).filter(Boolean);
  const tc = params.get('tc');
  if (tc) patch.testCaseIds = tc.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  const grep = params.get('grep');
  if (grep) patch.grep = grep;
  const env = params.get('env');
  if (env) patch.environment = env;
  // Repeatable: `?param=FOO%3D1&param=BAR%3D2`. A value may itself contain `=` (a URL, a query
  // string), so only the FIRST one separates the name from the value.
  const customParams = params
    .getAll('param')
    .map((entry) => {
      const eq = entry.indexOf('=');
      return eq < 0
        ? { key: entry.trim(), value: '' }
        : { key: entry.slice(0, eq).trim(), value: entry.slice(eq + 1) };
    })
    .filter((p) => p.key !== '');
  if (customParams.length > 0) patch.customParams = customParams;
  return patch;
}

export function rerunSearchParams(testCaseIds: string[], kind?: string | null): string {
  const params = new URLSearchParams();
  if (testCaseIds.length > 0) params.set('tc', testCaseIds.join(','));
  if (kind === 'api' || kind === 'ui') params.set('kind', kind);
  return params.toString();
}

// --- Status presentation ----------------------------------------------------

export const JOB_STATUS_LABEL: Record<RegressionJobStatus, string> = {
  QUEUED: 'Queued',
  PREPARING: 'Preparing',
  RUNNING: 'Running',
  SYNCING: 'Syncing',
  SUCCEEDED: 'Passed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  ERRORED: 'Harness error',
  ORPHANED: 'Orphaned',
};

/**
 * Tones follow "is it finished, and did it finish well?".
 *
 * SYNCING is `info`, not `success`: the batch is over but the reporting database does not have it
 * yet, and the user's very next click - opening the run in Test Cases - would come up empty. A
 * green chip there would be a lie about where the data is.
 *
 * CANCELLED is `neutral`, not `error`: a human stopped it on purpose, which is not a failure.
 * ERRORED (the machinery broke) is deliberately distinct from FAILED (scenarios failed), because
 * the two lead to completely different next actions.
 */
export const JOB_STATUS_TONE: Record<RegressionJobStatus, StatusTone> = {
  QUEUED: 'neutral',
  PREPARING: 'info',
  RUNNING: 'info',
  SYNCING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'error',
  CANCELLED: 'neutral',
  ERRORED: 'error',
  ORPHANED: 'warning',
};

const LIVE_STATUSES: readonly RegressionJobStatus[] = [
  REGRESSION_JOB_STATUS.QUEUED,
  REGRESSION_JOB_STATUS.PREPARING,
  REGRESSION_JOB_STATUS.RUNNING,
  REGRESSION_JOB_STATUS.SYNCING,
];

export function isLiveStatus(status: RegressionJobStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

/** One compact line describing what a job selected, for the history table. */
export function selectorLabel(job: RegressionJobSummaryResponseDto): string {
  const parts: string[] = [];
  if (job.kind) parts.push(job.kind);
  if (job.modules.length > 0) parts.push(job.modules.join(', '));
  if (job.test_case_ids.length > 0) parts.push(job.test_case_ids.join(', '));
  if (job.grep) parts.push(`grep "${job.grep}"`);
  return parts.length > 0 ? parts.join(' · ') : 'all';
}

// --- Console ----------------------------------------------------------------

/**
 * A single cap covering both memory and DOM. 2000 static rows in an overflow container is well
 * within budget, and the tail is what anyone actually watches; the rest is a download away.
 */
export const MAX_CONSOLE_LINES = 2000;

export const PREVIEW_SAMPLE_SIZE = 20;

export interface ConsoleLine {
  seq: number;
  text: string;
  tone: ConsoleTone;
}

export type ConsoleTone =
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'warn'
  | 'error'
  | 'info'
  | 'sync'
  | 'plain';

/**
 * Per-line colour, as Tailwind text utilities.
 *
 * The house rule puts MUI component appearance in the theme and leaves Tailwind for layout, but a
 * log line is not an MUI component - there is nothing to theme. An `sx` prop would also allocate
 * an emotion object per row, which is exactly the cost the console's batching exists to avoid.
 * The values mirror StatusChip's TONE map so the console agrees with the chips beside it.
 */
export const CONSOLE_TONE_CLASS: Record<ConsoleTone, string> = {
  pass: 'text-green-700',
  fail: 'text-red-600',
  blocked: 'text-amber-600',
  warn: 'text-amber-600',
  error: 'text-red-600',
  info: 'text-gray-700',
  sync: 'text-sky-700',
  plain: 'text-gray-500',
};

export const CLEAN_CHOICE_OPTIONS: { value: CleanChoice; label: string; hint: string }[] = [
  {
    value: 'all',
    label: 'Everything',
    hint: 'Empties reports/, outputs/ and evidence/ and deletes the runner database. Not limited to the tests selected above.',
  },
  {
    value: 'run',
    label: 'Only the selected tests',
    hint: 'Removes just the artifact folders and database rows of the scenarios about to run.',
  },
  { value: 'none', label: "Don't clean", hint: 'Leaves every previous artifact in place.' },
];

export const CLEANUP_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Runner default' },
  { value: 'true', label: 'Force cleanup' },
  { value: 'false', label: 'Skip cleanup' },
];
