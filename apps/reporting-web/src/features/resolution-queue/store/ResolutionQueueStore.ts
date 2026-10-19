import { makeAutoObservable, runInAction } from 'mobx';
import { DEFAULT_PAGE_SIZE } from '@qakit/reporting-shared';
import type {
  ListResolutionIssuesQueryDto,
  ResolutionCommentResponseDto,
  ResolutionEventResponseDto,
  ResolutionIssueDetailResponseDto,
  ResolutionIssueSummaryResponseDto,
  ResolutionQueueSummaryResponseDto,
} from '@qakit/reporting-shared';
import type { ResolutionQueueService } from '../service/resolutionQueueService';
import { blobToText } from '../../../shared/api/blobToText';
import { ACTOR_STORAGE_KEY } from '../types';

/**
 * List and detail state for the Resolution Queue.
 *
 * Two independent async slices, each with its own loading/error pair, matching
 * TestCaseDetailStore: the queue table and the open issue are fetched separately and one failing
 * must not blank the other.
 *
 * `actor` is the self-asserted identity this application has instead of authentication. It is
 * remembered per browser and sent with every mutation; an empty actor blocks the action rather
 * than silently attributing it to nobody.
 */

type Filters = Partial<ListResolutionIssuesQueryDto>;

function readStoredActor(): string {
  try {
    return localStorage.getItem(ACTOR_STORAGE_KEY) ?? '';
  } catch {
    // Private windows and blocked site data both throw here; an empty name is a fine fallback.
    return '';
  }
}

/**
 * Pulls the server's own explanation out of an error response.
 *
 * Two shapes reach here. Anything the services throw comes back as this project's envelope,
 * `{ error: { code, message, details } }`. But a DTO rejection never reaches that filter —
 * `ApiErrorFilter` is `@Catch(ApiError)` and `ValidationPipe` throws Nest's own
 * `BadRequestException` — so it arrives as `{ message: string[] , error, statusCode }`. Reading
 * only the first shape leaves a mistyped filter showing "Request failed with status code 400",
 * which tells the user nothing about which filter was wrong.
 */
export function extractApiMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const envelope = (body as { error?: { message?: unknown } }).error;
  if (envelope && typeof envelope.message === 'string') return envelope.message;

  const nest = (body as { message?: unknown }).message;
  if (typeof nest === 'string') return nest;
  if (Array.isArray(nest) && nest.length > 0) return nest.join('; ');
  return null;
}

function toMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  return extractApiMessage(data) ?? (error instanceof Error ? error.message : fallback);
}

/**
 * The export is fetched as a blob, so a failure arrives with its JSON error envelope wrapped in a
 * Blob rather than parsed onto response.data. Without this, a rejected export would surface as
 * 'Request failed with status code 400' instead of the message explaining which filter was wrong.
 */
export async function readApiErrorBlob(error: unknown): Promise<string | null> {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (!(data instanceof Blob)) return null;
  try {
    return extractApiMessage(JSON.parse(await blobToText(data)));
  } catch {
    return null;
  }
}

export class ResolutionQueueStore {
  issues: ResolutionIssueSummaryResponseDto[] = [];
  totalIssues = 0;
  currentPage = 1;
  pageSize = DEFAULT_PAGE_SIZE;
  filters: Filters = { page: 1, limit: DEFAULT_PAGE_SIZE };

  summary: ResolutionQueueSummaryResponseDto | null = null;

  issue: ResolutionIssueDetailResponseDto | null = null;
  comments: ResolutionCommentResponseDto[] = [];
  events: ResolutionEventResponseDto[] = [];

  isLoadingList = false;
  listError: string | null = null;
  isLoadingIssue = false;
  issueError: string | null = null;
  isSubmitting = false;
  isExporting = false;
  actionError: string | null = null;

  actor = readStoredActor();

  constructor(private readonly service: ResolutionQueueService) {
    makeAutoObservable(this);
  }

  setActor(actor: string) {
    this.actor = actor;
    try {
      localStorage.setItem(ACTOR_STORAGE_KEY, actor);
    } catch {
      // Not being able to remember the name is not a reason to refuse the edit.
    }
  }

  clearActionError() {
    this.actionError = null;
  }

  // --- list ---------------------------------------------------------------

  async loadIssues() {
    this.isLoadingList = true;
    this.listError = null;
    try {
      const result = await this.service.listIssues(this.filters);
      runInAction(() => {
        this.issues = result.items;
        this.totalIssues = result.total;
        this.currentPage = result.page;
        this.pageSize = result.limit;
      });
    } catch (error) {
      runInAction(() => {
        this.listError = toMessage(error, 'Failed to load the resolution queue');
      });
    } finally {
      runInAction(() => {
        this.isLoadingList = false;
      });
    }
  }

  async loadSummary() {
    try {
      const summary = await this.service.getSummary();
      runInAction(() => {
        this.summary = summary;
      });
    } catch {
      // The counts are a header adornment; failing to load them must not blank the table.
      runInAction(() => {
        this.summary = null;
      });
    }
  }

  /**
   * CSV of exactly what the current filters select — the same rows on screen, not a fixed
   * "resolved" set, so the file matches what the user was looking at when they clicked.
   *
   * Returns the blob instead of saving it: writing a file is a DOM side effect, and keeping it in
   * the page leaves this store testable without stubbing `URL.createObjectURL`. `null` means the
   * export failed and `actionError` explains why.
   */
  async exportCsv(): Promise<{ blob: Blob; filename: string } | null> {
    this.isExporting = true;
    this.actionError = null;
    try {
      // Pagination would only truncate the file.
      const { page: _page, limit: _limit, ...filters } = this.filters;
      return await this.service.exportCsv(filters);
    } catch (error) {
      const message = await readApiErrorBlob(error);
      runInAction(() => {
        this.actionError = message ?? toMessage(error, 'The export could not be generated');
      });
      return null;
    } finally {
      runInAction(() => {
        this.isExporting = false;
      });
    }
  }

  /** Single funnel for filter changes: apply, reset to page 1, reload exactly once. */
  applyFilters(filters: Filters) {
    this.filters = { ...filters, page: 1, limit: this.filters.limit || DEFAULT_PAGE_SIZE };
    void this.loadIssues();
  }

  setPage(page: number) {
    this.filters = { ...this.filters, page };
    void this.loadIssues();
  }

  setSort(sortBy: ListResolutionIssuesQueryDto['sort_by'], sortOrder: 'ASC' | 'DESC') {
    this.filters = { ...this.filters, sort_by: sortBy, sort_order: sortOrder, page: 1 };
    void this.loadIssues();
  }

  // --- detail -------------------------------------------------------------

  async loadIssue(id: string) {
    this.isLoadingIssue = true;
    this.issueError = null;
    try {
      const [issue, events] = await Promise.all([
        this.service.getIssue(id),
        this.service.listEvents(id),
      ]);
      runInAction(() => {
        this.issue = issue;
        this.comments = [];
        this.events = events;
      });
      const comments = await this.service.listComments(id);
      runInAction(() => {
        this.comments = comments;
      });
    } catch (error) {
      runInAction(() => {
        this.issueError = toMessage(error, 'Failed to load the issue');
      });
    } finally {
      runInAction(() => {
        this.isLoadingIssue = false;
      });
    }
  }

  /**
   * Every mutation goes through here so the actor check, the submitting flag, the error surface
   * and the refresh are identical for all of them — and so no action can quietly skip the audit
   * timeline reload and leave the page showing stale history.
   */
  private async mutate(
    id: string,
    run: (actor: string) => Promise<unknown>,
  ): Promise<boolean> {
    const actor = this.actor.trim();
    if (!actor) {
      this.actionError = 'Enter your name first — every change is recorded against it.';
      return false;
    }
    this.isSubmitting = true;
    this.actionError = null;
    try {
      await run(actor);
      await this.loadIssue(id);
      return true;
    } catch (error) {
      runInAction(() => {
        this.actionError = toMessage(error, 'The change could not be saved');
      });
      return false;
    } finally {
      runInAction(() => {
        this.isSubmitting = false;
      });
    }
  }

  addComment(id: string, body: string) {
    return this.mutate(id, (actor) => this.service.addComment(id, { actor, body }));
  }

  updateIssue(id: string, fields: Record<string, unknown>) {
    return this.mutate(id, (actor) => this.service.updateIssue(id, { actor, ...fields }));
  }

  changeStatus(id: string, targetStatus: string, reason?: string) {
    return this.mutate(id, (actor) =>
      this.service.changeStatus(id, { actor, target_status: targetStatus, reason }),
    );
  }

  recordDecision(id: string, decision: string) {
    return this.mutate(id, (actor) => this.service.recordDecision(id, { actor, decision }));
  }

  recordResolution(id: string, resolution: string, resolutionType: string) {
    return this.mutate(id, (actor) =>
      this.service.recordResolution(id, {
        actor,
        resolution,
        resolution_type: resolutionType,
      }),
    );
  }

  verify(
    id: string,
    input: { note: string; runId?: string; override?: boolean; overrideReason?: string },
  ) {
    return this.mutate(id, (actor) =>
      this.service.verify(id, {
        actor,
        verification_note: input.note,
        verification_run_id: input.runId || undefined,
        override: input.override || undefined,
        override_reason: input.overrideReason || undefined,
      }),
    );
  }

  reopen(id: string, reason: string) {
    return this.mutate(id, (actor) => this.service.reopen(id, { actor, reason }));
  }

  linkDefect(id: string, defectSignatureId: string | null) {
    return this.mutate(id, (actor) =>
      this.service.linkDefect(id, { actor, defect_signature_id: defectSignatureId }),
    );
  }

  linkRedmine(id: string, redmineIssueId: number, redmineUrl?: string) {
    return this.mutate(id, (actor) =>
      this.service.linkRedmine(id, {
        actor,
        redmine_issue_id: redmineIssueId,
        redmine_url: redmineUrl || undefined,
      }),
    );
  }

  reset() {
    this.issues = [];
    this.totalIssues = 0;
    this.currentPage = 1;
    this.pageSize = DEFAULT_PAGE_SIZE;
    this.filters = { page: 1, limit: DEFAULT_PAGE_SIZE };
    this.summary = null;
    this.issue = null;
    this.comments = [];
    this.events = [];
    this.isLoadingList = false;
    this.listError = null;
    this.isLoadingIssue = false;
    this.issueError = null;
    this.isSubmitting = false;
    this.isExporting = false;
    this.actionError = null;
  }
}
