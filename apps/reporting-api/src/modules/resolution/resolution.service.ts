import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_RESOLUTION_ACTOR_LENGTH,
  MAX_RESOLUTION_COMMENT_LENGTH,
  RESOLUTION_EVENT_ACTION,
  RESOLUTION_KIND,
  RESOLUTION_WORKFLOW_STATUS,
  NotFoundError,
  ValidationError,
} from '@qakit/reporting-shared';
import type {
  ListResolutionIssuesQueryDto,
  PaginatedResponse,
  ResolutionCommentResponseDto,
  ResolutionEventResponseDto,
  ResolutionIssueDetailResponseDto,
  ResolutionIssueSummaryResponseDto,
  ResolutionKind,
  ResolutionObservationResponseDto,
  ResolutionPriority,
  ResolutionQueueSummaryResponseDto,
  ResolutionType,
  ResolutionWorkflowStatus,
  TestRunResult,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import { buildExportFilename, buildResolutionCsv } from './resolution-csv.util';
import { requireText } from './resolution-input.util';
import {
  ResolutionWorkflowService,
  UNRESOLVED_STATUSES,
} from './resolution-workflow.service';

/**
 * Read model and orchestration for the Resolution Queue.
 *
 * Every state change is delegated to `ResolutionWorkflowService` — this service never sets
 * `workflowStatus` itself. Keeping that rule means the transition table and the audit trail have
 * one owner, and a new endpoint cannot accidentally invent a shortcut through the workflow.
 */

/**
 * Ceiling on one export. Not a performance guess: the whole result is materialised in memory and
 * returned as a single response body, so an unbounded filter would be a way to knock the API over.
 * Well above the current issue count, and the error names the number so it is actionable.
 */
const MAX_EXPORT_ISSUES = 5000;

/** Ordering for the `priority` sort: a text sort would put Critical after High. */
const PRIORITY_RANK: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const detailInclude = {
  observations: { orderBy: { observedAt: 'desc' } },
  comments: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
  redmineLinks: { orderBy: { createdAt: 'asc' } },
  defectSignature: { include: { bugLinks: true } },
} as const;

@Injectable()
export class ResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ResolutionWorkflowService,
  ) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listIssues(
    query: ListResolutionIssuesQueryDto,
  ): Promise<PaginatedResponse<ResolutionIssueSummaryResponseDto>> {
    const page = query.page || 1;
    const limit = Math.min(query.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);

    // `priority` has no useful column order, so it is sorted in memory over the page's rows only
    // after the database has applied every filter. Any other sort stays in the database.
    const sortInDb = query.sort_by !== 'priority';
    const orderBy = this.buildOrderBy(query);

    const [items, total] = await Promise.all([
      this.prisma.resolutionIssue.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { _count: { select: { redmineLinks: true } } },
      }),
      this.prisma.resolutionIssue.count({ where }),
    ]);

    const rows = items.map((i) => this.toSummary(i, i._count.redmineLinks));
    if (!sortInDb) {
      const dir = (query.sort_order || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
      rows.sort(
        (a, b) =>
          dir *
          ((PRIORITY_RANK[a.priority ?? ''] ?? 99) -
            (PRIORITY_RANK[b.priority ?? ''] ?? 99)),
      );
    }

    return { items: rows, total, page, limit, has_more: skip + limit < total };
  }

  async getIssue(id: string): Promise<ResolutionIssueDetailResponseDto> {
    const issue = await this.prisma.resolutionIssue.findUnique({
      where: { id: this.toNumericId(id) },
      include: { ...detailInclude, _count: { select: { redmineLinks: true } } },
    });
    if (!issue) throw new NotFoundError('ResolutionIssue', id);

    // Affected runs need their own lookup: the observations carry run ids, not run rows, and
    // fetching the runs through the relation would pull every column of every run.
    const runIds = [...new Set(issue.observations.map((o) => o.runId))];
    const runs = await this.prisma.testRun.findMany({
      where: { id: { in: runIds } },
      select: { id: true, result: true, environment: true, startedAt: true },
    });
    const runById = new Map(runs.map((r) => [r.id, r]));

    const testCaseIds = [
      ...new Set(issue.observations.map((o) => o.testCaseId)),
    ];
    const testCases = await this.prisma.testCase.findMany({
      where: { id: { in: testCaseIds } },
      select: { id: true, title: true },
    });
    const titleByCase = new Map(testCases.map((t) => [t.id, t.title]));

    const perCase = new Map<string, { scenarioKey: string; count: number }>();
    const perRun = new Map<string, number>();
    for (const o of issue.observations) {
      const c = perCase.get(o.testCaseId) ?? {
        scenarioKey: o.scenarioKey,
        count: 0,
      };
      c.count += 1;
      perCase.set(o.testCaseId, c);
      perRun.set(o.runId, (perRun.get(o.runId) ?? 0) + 1);
    }

    return {
      ...this.toSummary(issue, issue._count.redmineLinks),
      source_summary: issue.sourceSummary,
      user_summary: issue.userSummary,
      decision: issue.decision,
      decision_by: issue.decisionBy,
      decision_at: issue.decisionAt?.toISOString() ?? null,
      resolution: issue.resolution,
      resolution_type: (issue.resolutionType as ResolutionType) ?? null,
      resolved_by: issue.resolvedBy,
      resolved_at: issue.resolvedAt?.toISOString() ?? null,
      verification_note: issue.verificationNote,
      verified_by: issue.verifiedBy,
      verified_at: issue.verifiedAt?.toISOString() ?? null,
      verification_run_id: issue.verificationRunId,
      affected_test_cases: [...perCase.entries()].map(([testCaseId, v]) => ({
        test_case_id: testCaseId,
        scenario_key: v.scenarioKey,
        title: titleByCase.get(testCaseId) ?? null,
        observation_count: v.count,
      })),
      affected_runs: [...perRun.entries()]
        .map(([runId, count]) => {
          const run = runById.get(runId);
          return {
            run_id: runId,
            result: (run?.result as TestRunResult) ?? 'ERROR',
            environment: run?.environment ?? '',
            started_at: run?.startedAt?.toISOString() ?? '',
            observation_count: count,
          };
        })
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
      observations: issue.observations.map((o) =>
        this.toObservation(o, runById.get(o.runId)),
      ),
      redmine_links: issue.redmineLinks.map((l) => ({
        id: String(l.id),
        redmine_issue_id: l.redmineIssueId,
        redmine_url: l.redmineUrl,
        redmine_project: l.redmineProject,
        link_type: l.linkType,
        created_by: l.createdBy,
        created_at: l.createdAt.toISOString(),
      })),
      defect: issue.defectSignature
        ? {
            id: String(issue.defectSignature.id),
            title: issue.defectSignature.title,
            status: issue.defectSignature.status,
            scenario_key: issue.defectSignature.scenarioKey,
            bug_links: issue.defectSignature.bugLinks.map((b) => ({
              id: String(b.id),
              redmine_issue_id: b.redmineIssueId,
              redmine_url: b.redmineUrl,
            })),
          }
        : null,
      created_at: issue.createdAt.toISOString(),
    };
  }

  /**
   * CSV of everything the current filters select, for carrying answers back into the spec
   * documents and testcases they came from.
   *
   * Takes the same query as `listIssues` minus pagination, so what you filtered to on screen is
   * what you get in the file — including UNCLASSIFIED rows if that is what you asked for. The
   * alternative, a fixed "resolved" definition baked into the endpoint, would have needed a
   * second opinion every time someone wanted a slightly different slice.
   */
  async exportIssuesCsv(
    query: ListResolutionIssuesQueryDto,
    now: Date = new Date(),
  ): Promise<{ filename: string; csv: string }> {
    const where = this.buildWhere(query);

    const total = await this.prisma.resolutionIssue.count({ where });
    if (total > MAX_EXPORT_ISSUES) {
      throw new ValidationError(
        `The export is limited to ${MAX_EXPORT_ISSUES} issues; these filters match ${total}. Narrow the filters and export again.`,
        { matched: total, limit: MAX_EXPORT_ISSUES },
      );
    }

    const issues = await this.prisma.resolutionIssue.findMany({
      where,
      // Grouped by key rather than by recency: the file is read alongside the documents, and
      // rows for one blocker belong together.
      orderBy: [{ domain: 'asc' }, { displayKey: 'asc' }],
      include: {
        observations: { orderBy: { observedAt: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
        redmineLinks: { select: { redmineIssueId: true } },
      },
    });

    return {
      filename: buildExportFilename(now),
      csv: buildResolutionCsv(issues),
    };
  }

  async listComments(id: string): Promise<ResolutionCommentResponseDto[]> {
    const issueId = await this.assertIssueExists(id);
    const comments = await this.prisma.resolutionComment.findMany({
      where: { resolutionIssueId: issueId },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map((c) => this.toComment(c));
  }

  async listEvents(id: string): Promise<ResolutionEventResponseDto[]> {
    const issueId = await this.assertIssueExists(id);
    const events = await this.prisma.resolutionEvent.findMany({
      where: { resolutionIssueId: issueId },
      orderBy: { createdAt: 'asc' },
    });
    return events.map((e) => ({
      id: String(e.id),
      resolution_issue_id: String(e.resolutionIssueId),
      action: e.action as ResolutionEventResponseDto['action'],
      previous_status: (e.previousStatus as ResolutionWorkflowStatus) ?? null,
      new_status: (e.newStatus as ResolutionWorkflowStatus) ?? null,
      actor: e.actor,
      note: e.note,
      metadata: (e.metadata as Record<string, unknown>) ?? null,
      created_at: e.createdAt.toISOString(),
    }));
  }

  /** Counts for the queue header and the dashboard tiles. */
  async getSummary(): Promise<ResolutionQueueSummaryResponseDto> {
    const [byStatus, byKind, byDomain, byOwner, oldest, total] =
      await Promise.all([
        this.prisma.resolutionIssue.groupBy({
          by: ['workflowStatus'],
          _count: { _all: true },
        }),
        this.prisma.resolutionIssue.groupBy({
          by: ['kind'],
          _count: { _all: true },
        }),
        this.prisma.resolutionIssue.groupBy({
          by: ['domain', 'workflowStatus'],
          _count: { _all: true },
        }),
        this.prisma.resolutionIssue.groupBy({
          by: ['owner'],
          where: { owner: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.resolutionIssue.findMany({
          where: { workflowStatus: { in: [...UNRESOLVED_STATUSES] } },
          orderBy: { firstSeenAt: 'asc' },
          take: 10,
          select: {
            id: true,
            displayKey: true,
            title: true,
            workflowStatus: true,
            firstSeenAt: true,
          },
        }),
        this.prisma.resolutionIssue.count(),
      ]);

    const statusCounts = Object.fromEntries(
      Object.values(RESOLUTION_WORKFLOW_STATUS).map((s) => [s, 0]),
    ) as Record<ResolutionWorkflowStatus, number>;
    for (const row of byStatus) {
      statusCounts[row.workflowStatus as ResolutionWorkflowStatus] =
        row._count._all;
    }

    const kindCounts = Object.fromEntries(
      Object.values(RESOLUTION_KIND).map((k) => [k, 0]),
    ) as Record<ResolutionKind, number>;
    for (const row of byKind) {
      kindCounts[row.kind as ResolutionKind] = row._count._all;
    }

    const domainMap = new Map<string, { total: number; unresolved: number }>();
    for (const row of byDomain) {
      const key = row.domain ?? '_unknown';
      const entry = domainMap.get(key) ?? { total: 0, unresolved: 0 };
      entry.total += row._count._all;
      if (
        UNRESOLVED_STATUSES.includes(
          row.workflowStatus as ResolutionWorkflowStatus,
        )
      ) {
        entry.unresolved += row._count._all;
      }
      domainMap.set(key, entry);
    }

    return {
      total,
      by_status: statusCounts,
      by_kind: kindCounts,
      by_domain: [...domainMap.entries()]
        .map(([domain, v]) => ({ domain, ...v }))
        .sort((a, b) => b.unresolved - a.unresolved),
      by_owner: byOwner
        .map((r) => ({ owner: r.owner as string, total: r._count._all }))
        .sort((a, b) => b.total - a.total),
      oldest_unresolved: oldest.map((i) => ({
        id: String(i.id),
        display_key: i.displayKey,
        title: i.title,
        workflow_status: i.workflowStatus as ResolutionWorkflowStatus,
        first_seen_at: i.firstSeenAt.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Write — all delegated to the workflow service
  // -------------------------------------------------------------------------

  async updateIssue(
    id: string,
    body: unknown,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const issueId = await this.assertIssueExists(id);
    await this.workflow.updateUserFields(issueId, body as never);
    return this.getIssue(id);
  }

  async changeStatus(
    id: string,
    body: unknown,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const issueId = await this.assertIssueExists(id);
    await this.workflow.changeStatus(issueId, body as never);
    return this.getIssue(id);
  }

  async recordDecision(
    id: string,
    body: unknown,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const issueId = await this.assertIssueExists(id);
    await this.workflow.recordDecision(issueId, body as never);
    return this.getIssue(id);
  }

  async recordResolution(
    id: string,
    body: unknown,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const issueId = await this.assertIssueExists(id);
    await this.workflow.recordResolution(issueId, body as never);
    return this.getIssue(id);
  }

  async verify(
    id: string,
    body: unknown,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const issueId = await this.assertIssueExists(id);
    await this.workflow.verify(issueId, body as never, {
      findRun: (runId) =>
        this.prisma.testRun.findUnique({
          where: { id: runId },
          select: { id: true, startedAt: true, scenarioKey: true },
        }),
      affectedScenarioKeys: async (target) => {
        const rows = await this.prisma.resolutionObservation.groupBy({
          by: ['scenarioKey'],
          where: { resolutionIssueId: target },
        });
        return rows.map((r) => r.scenarioKey);
      },
    });
    return this.getIssue(id);
  }

  async reopen(
    id: string,
    body: unknown,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const issueId = await this.assertIssueExists(id);
    await this.workflow.reopen(issueId, body as never);
    return this.getIssue(id);
  }

  async linkDefect(
    id: string,
    body: unknown,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const issueId = await this.assertIssueExists(id);
    await this.workflow.linkDefect(issueId, body as never, {
      defectExists: async (defectId) =>
        (await this.prisma.defectSignature.count({ where: { id: defectId } })) >
        0,
    });
    return this.getIssue(id);
  }

  /**
   * Links an existing Redmine issue. Deliberately a *link*, never a create: nothing in this
   * feature files a Redmine issue on its own, because an unresolved blocker is not a confirmed
   * product defect. Filing one stays a human action, through the run/defect Redmine endpoints.
   */
  async linkRedmine(
    id: string,
    body: unknown,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const issueId = await this.assertIssueExists(id);
    const input = body as {
      actor?: unknown;
      redmine_issue_id?: unknown;
      redmine_url?: unknown;
      redmine_project?: unknown;
      link_type?: unknown;
      note?: unknown;
    };
    const actor = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const redmineIssueId = Number(input.redmine_issue_id);
    if (!Number.isInteger(redmineIssueId) || redmineIssueId <= 0) {
      throw new ValidationError('redmine_issue_id must be a positive integer', {
        field: 'redmine_issue_id',
      });
    }

    const issue = await this.prisma.resolutionIssue.findUnique({
      where: { id: issueId },
      select: { kind: true },
    });
    if (issue?.kind !== RESOLUTION_KIND.PRODUCT_DEFECT) {
      throw new ValidationError(
        'Only an issue classified as PRODUCT_DEFECT may be linked to a Redmine issue. ' +
          'Classify it first, or record the blocker as a spec, data, environment or automation problem.',
        { field: 'kind', kind: issue?.kind },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.resolutionRedmineLink.upsert({
        where: {
          resolutionIssueId_redmineIssueId: {
            resolutionIssueId: issueId,
            redmineIssueId,
          },
        },
        create: {
          resolutionIssueId: issueId,
          redmineIssueId,
          redmineUrl: (input.redmine_url as string) ?? null,
          redmineProject: (input.redmine_project as string) ?? null,
          linkType: (input.link_type as string) ?? 'manually_linked',
          createdBy: actor,
        },
        update: {
          redmineUrl: (input.redmine_url as string) ?? null,
          redmineProject: (input.redmine_project as string) ?? null,
        },
      });
      await tx.resolutionEvent.create({
        data: {
          resolutionIssueId: issueId,
          action: RESOLUTION_EVENT_ACTION.REDMINE_LINKED,
          actor,
          note: (input.note as string) ?? null,
          metadata: { redmine_issue_id: redmineIssueId },
        },
      });
    });

    return this.getIssue(id);
  }

  /**
   * Comments are discussion, never authority. Adding one records a COMMENT_ADDED event so the
   * timeline is complete, and changes no status whatsoever — that separation is the reason a
   * decision has its own endpoint.
   */
  async addComment(
    id: string,
    body: unknown,
  ): Promise<ResolutionCommentResponseDto> {
    const issueId = await this.assertIssueExists(id);
    const input = body as { actor?: unknown; body?: unknown };
    const author = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const text = requireText('body', input.body, MAX_RESOLUTION_COMMENT_LENGTH);

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.resolutionComment.create({
        data: { resolutionIssueId: issueId, body: text, author },
      });
      await tx.resolutionEvent.create({
        data: {
          resolutionIssueId: issueId,
          action: RESOLUTION_EVENT_ACTION.COMMENT_ADDED,
          actor: author,
          note: null,
          metadata: { comment_id: created.id },
        },
      });
      return created;
    });

    return this.toComment(comment);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private toNumericId(id: string): number {
    const parsed = Number(id);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new NotFoundError('ResolutionIssue', id);
    }
    return parsed;
  }

  private async assertIssueExists(id: string): Promise<number> {
    const numericId = this.toNumericId(id);
    const count = await this.prisma.resolutionIssue.count({
      where: { id: numericId },
    });
    if (count === 0) throw new NotFoundError('ResolutionIssue', id);
    return numericId;
  }

  private buildWhere(
    query: ListResolutionIssuesQueryDto,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' as const };
      where.OR = [
        { displayKey: contains },
        { title: contains },
        { sourceSummary: contains },
        { userSummary: contains },
      ];
    }
    if (query.display_key)
      where.displayKey = { contains: query.display_key, mode: 'insensitive' };
    if (query.kind) where.kind = query.kind;
    if (query.workflow_status) where.workflowStatus = query.workflow_status;
    if (query.owner) where.owner = query.owner;
    if (query.priority) where.priority = query.priority;
    if (query.module) where.module = query.module;
    if (query.domain) where.domain = query.domain;
    if (query.has_defect !== undefined) {
      where.defectSignatureId = query.has_defect ? { not: null } : null;
    }
    if (query.has_redmine !== undefined) {
      where.redmineLinks = query.has_redmine ? { some: {} } : { none: {} };
    }

    const firstSeen = this.dateRange(
      query.first_seen_from,
      query.first_seen_to,
    );
    if (firstSeen) where.firstSeenAt = firstSeen;
    const lastSeen = this.dateRange(query.last_seen_from, query.last_seen_to);
    if (lastSeen) where.lastSeenAt = lastSeen;

    // Observation-shaped filters collapse into one `some`. Assigning `where.observations` twice
    // would silently drop the earlier one — the same trap the defects service documents.
    const observation: Record<string, unknown> = {};
    if (query.scenario_key) observation.scenarioKey = query.scenario_key;
    if (query.test_case_id) observation.testCaseId = query.test_case_id;
    if (query.observed_result)
      observation.observedResult = query.observed_result;
    if (Object.keys(observation).length > 0)
      where.observations = { some: observation };

    return where;
  }

  private dateRange(
    from?: string,
    to?: string,
  ): Record<string, Date> | undefined {
    const range: Record<string, Date> = {};
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime()))
        throw new ValidationError(`Invalid date: ${from}`);
      range.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime()))
        throw new ValidationError(`Invalid date: ${to}`);
      range.lte = d;
    }
    return Object.keys(range).length > 0 ? range : undefined;
  }

  private buildOrderBy(
    query: ListResolutionIssuesQueryDto,
  ): Record<string, 'asc' | 'desc'> {
    const direction =
      (query.sort_order || 'DESC').toUpperCase() === 'ASC' ? 'asc' : 'desc';
    switch (query.sort_by) {
      case 'first_seen_at':
        return { firstSeenAt: direction };
      case 'observation_count':
        return { observationCount: direction };
      case 'display_key':
        return { displayKey: direction };
      case 'priority':
        // Re-sorted in memory; keep a stable database order underneath it.
        return { lastSeenAt: 'desc' };
      default:
        return { lastSeenAt: direction };
    }
  }

  private toSummary(
    issue: {
      id: number;
      importKey: string;
      displayKey: string;
      title: string;
      kind: string;
      workflowStatus: string;
      owner: string | null;
      priority: string | null;
      module: string | null;
      domain: string | null;
      affectedTestCaseCount: number;
      observationCount: number;
      recurrenceCount: number;
      firstSeenAt: Date;
      lastSeenAt: Date;
      defectSignatureId: number | null;
      updatedAt: Date;
    },
    redmineIssueCount: number,
  ): ResolutionIssueSummaryResponseDto {
    return {
      id: String(issue.id),
      import_key: issue.importKey,
      display_key: issue.displayKey,
      title: issue.title,
      kind: issue.kind as ResolutionKind,
      workflow_status: issue.workflowStatus as ResolutionWorkflowStatus,
      owner: issue.owner,
      priority: (issue.priority as ResolutionPriority) ?? null,
      module: issue.module,
      domain: issue.domain,
      affected_test_case_count: issue.affectedTestCaseCount,
      observation_count: issue.observationCount,
      recurrence_count: issue.recurrenceCount,
      first_seen_at: issue.firstSeenAt.toISOString(),
      last_seen_at: issue.lastSeenAt.toISOString(),
      defect_signature_id: issue.defectSignatureId
        ? String(issue.defectSignatureId)
        : null,
      redmine_issue_count: redmineIssueCount,
      updated_at: issue.updatedAt.toISOString(),
    };
  }

  private toObservation(
    o: {
      id: number;
      resolutionIssueId: number;
      runId: string;
      testCaseId: string;
      scenarioKey: string;
      checkSequence: number | null;
      checkTestId: string | null;
      checkLabel: string | null;
      observationKey: string;
      observedResult: string;
      rawReason: string;
      observedAt: Date;
      createdAt: Date;
    },
    run?: { result: string; environment: string; startedAt: Date },
  ): ResolutionObservationResponseDto {
    return {
      id: String(o.id),
      resolution_issue_id: String(o.resolutionIssueId),
      run_id: o.runId,
      test_case_id: o.testCaseId,
      scenario_key: o.scenarioKey,
      check_sequence: o.checkSequence,
      check_test_id: o.checkTestId,
      check_label: o.checkLabel,
      observation_key: o.observationKey,
      observed_result:
        o.observedResult as ResolutionObservationResponseDto['observed_result'],
      raw_reason: o.rawReason,
      observed_at: o.observedAt.toISOString(),
      created_at: o.createdAt.toISOString(),
      run_result: run ? (run.result as TestRunResult) : undefined,
      run_environment: run?.environment,
      run_started_at: run?.startedAt.toISOString(),
    };
  }

  private toComment(c: {
    id: number;
    resolutionIssueId: number;
    body: string;
    author: string;
    edited: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ResolutionCommentResponseDto {
    return {
      id: String(c.id),
      resolution_issue_id: String(c.resolutionIssueId),
      body: c.body,
      author: c.author,
      edited: c.edited,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    };
  }
}
