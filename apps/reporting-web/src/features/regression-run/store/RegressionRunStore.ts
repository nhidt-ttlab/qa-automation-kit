import { makeAutoObservable, observable, runInAction } from 'mobx';
import type {
  RegressionJobDetailResponseDto,
  RegressionJobLogLineDto,
  RegressionJobOptionsResponseDto,
  RegressionJobSummaryResponseDto,
  RegressionPreviewResponseDto,
  RegressionWorkspaceStatusResponseDto,
  RegressionWorkspaceSyncResponseDto,
} from '@qakit/reporting-shared';
import { extractApiMessage } from '../../resolution-queue/store/ResolutionQueueStore';
import type { RegressionRunService } from '../service/regressionRunService';
import { classifyLogLine } from '../log-format';
import {
  createEmptyDraft,
  draftToPreviewRequest,
  draftToRequest,
  isLiveStatus,
  MAX_CONSOLE_LINES,
  type ConsoleLine,
  type RunJobDraft,
} from '../types';

const DEFAULT_LIMIT = 20;
/** One MobX notification per tick, however fast the runner talks. */
const FLUSH_INTERVAL_MS = 100;
const MAX_STREAM_RETRIES = 6;
const ACTOR_STORAGE_KEY = 'qakit-reporting.regression-actor';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

function toMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  return extractApiMessage(data) ?? (error instanceof Error ? error.message : fallback);
}

/** The 409 body carries the active job so the UI can offer "Watch it" instead of a dead end. */
function extractActiveJobId(error: unknown): number | null {
  const details = (
    error as { response?: { data?: { error?: { details?: { active_job_id?: unknown } } } } }
  )?.response?.data?.error?.details;
  return typeof details?.active_job_id === 'number' ? details.active_job_id : null;
}

export class RegressionRunStore {
  // --- form -----------------------------------------------------------------
  //
  // The draft lives in the store rather than in component state, which is a deliberate deviation
  // from the house convention. It has to survive navigation to the detail page and back, be
  // seedable from a URL (the Rerun contract), and be readable by the preview dialog. Nothing
  // reloads on change, so the usual reason for local drafts - not firing a fetch per keystroke -
  // does not apply here.
  draft: RunJobDraft = createEmptyDraft();
  actor = '';

  // --- options --------------------------------------------------------------
  options: RegressionJobOptionsResponseDto | null = null;
  isLoadingOptions = false;
  optionsError: string | null = null;

  // --- workspace (the test-script checkout) ---------------------------------
  workspace: RegressionWorkspaceStatusResponseDto | null = null;
  isLoadingWorkspace = false;
  workspaceError: string | null = null;
  isSyncing = false;
  /** The most recent sync this page triggered or the API remembered; drives the result alert. */
  syncResult: RegressionWorkspaceSyncResponseDto | null = null;

  // --- history --------------------------------------------------------------
  jobs: RegressionJobSummaryResponseDto[] = [];
  totalJobs = 0;
  currentPage = 1;
  pageSize = DEFAULT_LIMIT;
  isLoadingJobs = false;
  jobsError: string | null = null;

  // --- preview --------------------------------------------------------------
  preview: RegressionPreviewResponseDto | null = null;
  isPreviewOpen = false;
  isLoadingPreview = false;
  previewError: string | null = null;

  // --- one job --------------------------------------------------------------
  job: RegressionJobDetailResponseDto | null = null;
  isLoadingJob = false;
  jobError: string | null = null;

  // --- actions --------------------------------------------------------------
  isSubmitting = false;
  actionError: string | null = null;
  /** Set when a create is refused because another job holds the slot. */
  conflictJobId: number | null = null;

  // --- console --------------------------------------------------------------
  logLines: ConsoleLine[] = [];
  droppedLineCount = 0;
  streamStatus: StreamStatus = 'idle';
  streamError: string | null = null;
  lastSeq = 0;

  private eventSource: EventSource | null = null;
  /** Plain array, never observable: the staging buffer between SSE and the flush tick. */
  private pendingLines: ConsoleLine[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;

  constructor(private readonly service: RegressionRunService) {
    // The second type parameter admits private members into the annotations map. They are ordinary
    // properties at runtime, so without naming them here makeAutoObservable would wrap the
    // EventSource and the staging buffer in proxies — which is exactly what the batching below
    // exists to avoid.
    makeAutoObservable<
      RegressionRunStore,
      'eventSource' | 'pendingLines' | 'flushTimer' | 'retryTimer'
    >(this, {
      // Services and the transport are never rendered.
      eventSource: false,
      pendingLines: false,
      flushTimer: false,
      retryTimer: false,
      // Lines are frozen value objects that are never mutated in place, so a proxy per line at
      // 2000 of them is pure waste. Same call RootStore makes for apiClient.
      logLines: observable.shallow,
    });

    try {
      this.actor = localStorage.getItem(ACTOR_STORAGE_KEY) ?? '';
    } catch {
      // Private mode or blocked storage: an empty actor is a fine default.
    }
  }

  // --- form -----------------------------------------------------------------

  setActor(actor: string): void {
    this.actor = actor;
    try {
      localStorage.setItem(ACTOR_STORAGE_KEY, actor);
    } catch {
      // Not worth surfacing: the value is a convenience, not state the run depends on.
    }
  }

  patchDraft(patch: Partial<RunJobDraft>): void {
    // A rerun or a pasted link can carry an environment this runner no longer offers.
    this.draft = this.withOfferedEnvironment({ ...this.draft, ...patch });
  }

  resetDraft(): void {
    this.draft = this.withOfferedEnvironment(createEmptyDraft());
  }

  /** The environment a fresh draft starts on: the runner's first, or the built-in default before options load. */
  get defaultEnvironment(): string {
    return this.options?.environments[0] ?? createEmptyDraft().environment;
  }

  /**
   * The built-in default ('qa') is only a placeholder until the runner says what it offers; a draft
   * must never carry an environment outside that list, or the API rejects the run at confirm time.
   */
  private withOfferedEnvironment(draft: RunJobDraft): RunJobDraft {
    const offered = this.options?.environments ?? [];
    if (offered.length === 0 || offered.includes(draft.environment)) return draft;
    return { ...draft, environment: offered[0] };
  }

  get canSubmit(): boolean {
    return (
      this.actor.trim().length > 0 &&
      !this.isSubmitting &&
      !this.isSyncing &&
      this.options?.runner_available !== false
    );
  }

  /**
   * Sync needs a name (it is recorded, like a run), a git checkout with a tracking branch, and no
   * batch in flight: the API refuses the last case with a 409 anyway, but a disabled button says
   * so before the click.
   */
  get canSync(): boolean {
    return (
      this.actor.trim().length > 0 &&
      !this.isSyncing &&
      !this.isSubmitting &&
      this.workspace?.is_git_repo === true &&
      this.workspace.upstream !== null &&
      !this.workspace.sync_in_progress &&
      !this.jobs.some((j) => isLiveStatus(j.status))
    );
  }

  // --- workspace ------------------------------------------------------------

  async loadWorkspace(): Promise<void> {
    this.isLoadingWorkspace = true;
    this.workspaceError = null;
    try {
      const workspace = await this.service.getWorkspace();
      runInAction(() => {
        this.workspace = workspace;
        // The API remembers the last sync across page loads (until it restarts); show it rather
        // than start every visit with no history.
        if (!this.syncResult && workspace.last_sync) this.syncResult = workspace.last_sync;
      });
    } catch (error) {
      runInAction(() => {
        this.workspaceError = toMessage(error, 'Failed to read the test-script checkout');
      });
    } finally {
      runInAction(() => {
        this.isLoadingWorkspace = false;
      });
    }
  }

  /**
   * Pull the latest test scripts, then reload the catalog so new test cases appear in the module
   * and testcase pickers. Returns the outcome, or null when the request itself was refused.
   */
  async syncWorkspace(): Promise<RegressionWorkspaceSyncResponseDto | null> {
    this.isSyncing = true;
    this.actionError = null;
    try {
      const result = await this.service.syncWorkspace({ requested_by: this.actor.trim() });
      runInAction(() => {
        this.syncResult = result;
      });
      // Both re-reads are part of the same user action: the status card must show the new
      // revision and the form must offer the new scenarios. Neither failing should hide the result.
      await Promise.all([this.loadWorkspace(), this.loadOptions()]);
      return result;
    } catch (error) {
      runInAction(() => {
        this.actionError = toMessage(error, 'Failed to sync test scripts');
      });
      return null;
    } finally {
      runInAction(() => {
        this.isSyncing = false;
      });
    }
  }

  clearSyncResult(): void {
    this.syncResult = null;
  }

  // --- loads ----------------------------------------------------------------

  async loadOptions(): Promise<void> {
    this.isLoadingOptions = true;
    this.optionsError = null;
    try {
      const options = await this.service.getOptions();
      runInAction(() => {
        this.options = options;
        this.draft = this.withOfferedEnvironment(this.draft);
      });
    } catch (error) {
      runInAction(() => {
        this.optionsError = toMessage(error, 'Failed to load runner options');
      });
    } finally {
      runInAction(() => {
        this.isLoadingOptions = false;
      });
    }
  }

  async loadJobs(): Promise<void> {
    this.isLoadingJobs = true;
    this.jobsError = null;
    try {
      const result = await this.service.listJobs({
        page: this.currentPage,
        limit: this.pageSize,
      });
      runInAction(() => {
        this.jobs = result.items;
        this.totalJobs = result.total;
      });
    } catch (error) {
      runInAction(() => {
        this.jobsError = toMessage(error, 'Failed to load regression runs');
      });
    } finally {
      runInAction(() => {
        this.isLoadingJobs = false;
      });
    }
  }

  /** Silent refresh for the live poller: must not flash the table's loading state. */
  async refreshJobs(): Promise<void> {
    try {
      const result = await this.service.listJobs({
        page: this.currentPage,
        limit: this.pageSize,
      });
      runInAction(() => {
        this.jobs = result.items;
        this.totalJobs = result.total;
      });
    } catch {
      // A failed background refresh is not worth an error banner; the next tick retries.
    }
  }

  setPage(page: number): void {
    this.currentPage = page;
    void this.loadJobs();
  }

  async loadJob(id: number): Promise<void> {
    this.isLoadingJob = true;
    this.jobError = null;
    try {
      const job = await this.service.getJob(id);
      runInAction(() => {
        this.job = job;
      });
    } catch (error) {
      runInAction(() => {
        this.jobError = toMessage(error, 'Failed to load this run');
      });
    } finally {
      runInAction(() => {
        this.isLoadingJob = false;
      });
    }
  }

  // --- preview and create ---------------------------------------------------

  async openPreview(): Promise<void> {
    this.isLoadingPreview = true;
    this.previewError = null;
    this.isPreviewOpen = true;
    this.conflictJobId = null;
    // Options fetched while the runner was unavailable carry no environments, so the draft still
    // holds the placeholder. The runner may be fixed since (an API restart does not reload the
    // page), so ask again before previewing a run that would be confirmed against the wrong one.
    if (!this.options?.runner_available) await this.loadOptions();
    try {
      const preview = await this.service.preview(draftToPreviewRequest(this.draft));
      runInAction(() => {
        this.preview = preview;
      });
    } catch (error) {
      runInAction(() => {
        this.previewError = toMessage(error, 'Failed to resolve this selection');
      });
    } finally {
      runInAction(() => {
        this.isLoadingPreview = false;
      });
    }
  }

  closePreview(): void {
    this.isPreviewOpen = false;
    this.preview = null;
    this.previewError = null;
    this.conflictJobId = null;
  }

  /** Returns the new job id so the page can navigate to it, or null when the create failed. */
  async createJob(): Promise<number | null> {
    this.isSubmitting = true;
    this.actionError = null;
    this.conflictJobId = null;
    try {
      const job = await this.service.createJob(draftToRequest(this.draft, this.actor.trim()));
      runInAction(() => {
        this.isPreviewOpen = false;
        this.preview = null;
      });
      return job.id;
    } catch (error) {
      runInAction(() => {
        this.actionError = toMessage(error, 'Failed to start this run');
        // A 409 is not a dead end: the dialog offers to watch the job already in flight.
        this.conflictJobId = extractActiveJobId(error);
      });
      return null;
    } finally {
      runInAction(() => {
        this.isSubmitting = false;
      });
    }
  }

  async cancelJob(id: number): Promise<boolean> {
    this.isSubmitting = true;
    this.actionError = null;
    try {
      const job = await this.service.cancelJob(id, { requested_by: this.actor.trim() || 'unknown' });
      runInAction(() => {
        this.job = job;
      });
      return true;
    } catch (error) {
      runInAction(() => {
        this.actionError = toMessage(error, 'Failed to cancel this run');
      });
      return false;
    } finally {
      runInAction(() => {
        this.isSubmitting = false;
      });
    }
  }

  clearActionError(): void {
    this.actionError = null;
    this.conflictJobId = null;
  }

  /**
   * The whole log as text, for the download button.
   *
   * Fetched from seq 0 rather than assembled from `logLines`, which is a capped ring buffer — the
   * point of the download is precisely to get back the lines the buffer dropped. Returns the text
   * and lets the page turn it into a file, keeping the DOM out of the store.
   */
  async getFullLogText(id: number): Promise<string | null> {
    try {
      const tail = await this.service.getLog(id, 0);
      return tail.lines.map((l) => l.text).join('\n');
    } catch (error) {
      runInAction(() => {
        this.actionError = toMessage(error, 'Failed to download the log');
      });
      return null;
    }
  }

  // --- the live console -----------------------------------------------------

  /**
   * Idempotent, which also makes React 18 StrictMode's double mount a no-op rather than a second
   * connection.
   */
  openStream(id: number): void {
    if (this.eventSource) return;

    if (typeof EventSource === 'undefined') {
      // jsdom, and any browser without SSE. The log is still readable through the tail endpoint.
      this.streamError = 'Live output is not available in this browser.';
      this.streamStatus = 'closed';
      return;
    }

    this.streamStatus = 'connecting';
    const source = new EventSource(this.service.streamUrl(id, this.lastSeq));
    this.eventSource = source;

    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    source.addEventListener('open', () => {
      runInAction(() => {
        this.streamStatus = 'open';
        this.streamError = null;
        this.retryCount = 0;
      });
    });

    source.addEventListener('log', (event) => {
      try {
        const line = JSON.parse((event as MessageEvent<string>).data) as RegressionJobLogLineDto;
        this.appendLine(line);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });

    source.addEventListener('end', () => {
      this.closeStream();
      // Pick up the final counts, exit code, summary path and sync result in one fetch.
      void this.loadJob(id);
    });

    source.addEventListener('error', () => {
      this.handleStreamError(id);
    });
  }

  private handleStreamError(id: number): void {
    this.closeStream({ keepStatus: true });
    if (this.retryCount >= MAX_STREAM_RETRIES) {
      runInAction(() => {
        this.streamStatus = 'closed';
        this.streamError =
          'Lost the live connection. Reload to reconnect, or download the full log.';
      });
      return;
    }

    const delay = Math.min(1000 * 2 ** this.retryCount, 10000);
    this.retryCount++;
    runInAction(() => {
      this.streamStatus = 'reconnecting';
    });

    this.retryTimer = setTimeout(() => {
      // Replay the gap first. appendLine drops anything at or below lastSeq, so an overlapping
      // replay is harmless - and a missing line is impossible, which is the direction that matters.
      void this.replayFrom(id).finally(() => this.openStream(id));
    }, delay);
  }

  private async replayFrom(id: number): Promise<void> {
    try {
      const tail = await this.service.getLog(id, this.lastSeq);
      for (const line of tail.lines) this.appendLine(line);
      this.flush();
    } catch {
      // The reconnect itself will try again; a failed replay must not stop it.
    }
  }

  private appendLine(line: RegressionJobLogLineDto): void {
    if (line.seq <= this.lastSeq) return;
    this.lastSeq = line.seq;
    this.pendingLines.push({
      seq: line.seq,
      text: line.text,
      tone: classifyLogLine(line.text, line.stream),
    });
  }

  /** Moves the staging buffer into the observable array; one notification per tick. */
  private flush(): void {
    if (this.pendingLines.length === 0) return;
    const batch = this.pendingLines;
    this.pendingLines = [];
    runInAction(() => {
      this.logLines.push(...batch);
      const overflow = this.logLines.length - MAX_CONSOLE_LINES;
      if (overflow > 0) {
        this.logLines.splice(0, overflow);
        this.droppedLineCount += overflow;
      }
    });
  }

  closeStream(options: { keepStatus?: boolean } = {}): void {
    this.eventSource?.close();
    this.eventSource = null;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    // Do not lose the last partial batch.
    this.flush();
    if (!options.keepStatus) {
      runInAction(() => {
        this.streamStatus = 'closed';
      });
    }
  }

  /**
   * Leaving the detail page. Deliberately NOT reset(): that would discard the form draft, which is
   * the whole reason the draft lives in the store.
   */
  clearJob(): void {
    this.closeStream();
    this.job = null;
    this.jobError = null;
    this.logLines = [];
    this.droppedLineCount = 0;
    this.lastSeq = 0;
    this.streamStatus = 'idle';
    this.streamError = null;
    this.retryCount = 0;
  }

  reset(): void {
    this.clearJob();
    this.draft = createEmptyDraft();
    this.options = null;
    this.isLoadingOptions = false;
    this.optionsError = null;
    this.jobs = [];
    this.totalJobs = 0;
    this.currentPage = 1;
    this.isLoadingJobs = false;
    this.jobsError = null;
    this.preview = null;
    this.isPreviewOpen = false;
    this.isLoadingPreview = false;
    this.previewError = null;
    this.isSubmitting = false;
    this.actionError = null;
    this.conflictJobId = null;
  }
}
