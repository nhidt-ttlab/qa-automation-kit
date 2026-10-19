import { Injectable } from '@nestjs/common';
import {
  MAX_RESOLUTION_ACTOR_LENGTH,
  MAX_RESOLUTION_DECISION_LENGTH,
  MAX_RESOLUTION_NOTE_LENGTH,
  MAX_RESOLUTION_RESOLUTION_LENGTH,
  MAX_RESOLUTION_SUMMARY_LENGTH,
  MAX_RESOLUTION_TITLE_LENGTH,
  MIN_RESOLUTION_REASON_LENGTH,
  RESOLUTION_DIRECT_STATUS_TARGETS,
  RESOLUTION_EVENT_ACTION,
  RESOLUTION_KIND,
  RESOLUTION_PRIORITY,
  RESOLUTION_TRANSITIONS,
  RESOLUTION_TYPE,
  RESOLUTION_WORKFLOW_STATUS,
  NotFoundError,
  ValidationError,
} from '@qakit/reporting-shared';
import type {
  ResolutionEventAction,
  ResolutionKind,
  ResolutionPriority,
  ResolutionType,
  ResolutionWorkflowStatus,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import {
  optionalOneOf,
  optionalText,
  requireOneOf,
  requireText,
} from './resolution-input.util';

/**
 * The one place a Resolution Queue issue changes state.
 *
 * Controllers do not transition issues, and neither does the projection: both call in here, so
 * the transition table, the audit event and the "which fields may this action touch" question
 * each have exactly one answer. That matters most for the sync path — `VERIFIED -> RECURRED` is
 * the only transition automation may perform, and routing it through this service is what makes
 * it audited rather than silent.
 *
 * Every mutation writes exactly one `ResolutionEvent`. There is no code path that changes an
 * issue without one.
 */

/**
 * Anything with the Prisma delegates this service needs — the client itself, or a transaction
 * client, so the projection can record a recurrence inside its own batch transaction.
 */
export type ResolutionDbClient = Pick<
  PrismaService,
  'resolutionIssue' | 'resolutionEvent'
>;

/** The issue fields the workflow reasons about. Keeps the service testable with plain objects. */
export interface WorkflowIssueSnapshot {
  id: number;
  workflowStatus: string;
  kind: string;
  owner: string | null;
  priority: string | null;
  resolvedAt: Date | null;
  verifiedAt: Date | null;
  recurrenceCount: number;
}

export interface AuditContext {
  actor: string;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
}

const KINDS = Object.values(RESOLUTION_KIND);
const PRIORITIES = Object.values(RESOLUTION_PRIORITY);
const RESOLUTION_TYPES = Object.values(RESOLUTION_TYPE);
const STATUSES = Object.values(RESOLUTION_WORKFLOW_STATUS);

/** States from which an issue is still "unresolved" for reporting purposes. */
export const UNRESOLVED_STATUSES: readonly ResolutionWorkflowStatus[] = [
  RESOLUTION_WORKFLOW_STATUS.OPEN,
  RESOLUTION_WORKFLOW_STATUS.WAITING_FOR_DECISION,
  RESOLUTION_WORKFLOW_STATUS.DECIDED,
  RESOLUTION_WORKFLOW_STATUS.READY_FOR_RERUN,
  RESOLUTION_WORKFLOW_STATUS.RECURRED,
];

/**
 * Pure transition check, exported so callers can pre-validate without touching the database.
 * A self-transition is rejected on purpose: it is nearly always a double-submit, and letting it
 * through would put a meaningless STATUS_CHANGED event in the audit trail.
 */
export function assertTransitionAllowed(
  from: string,
  to: ResolutionWorkflowStatus,
): void {
  const allowed = RESOLUTION_TRANSITIONS[from as ResolutionWorkflowStatus];
  if (!allowed) {
    throw new ValidationError(`Unknown workflow status "${from}"`, { from });
  }
  if (!allowed.includes(to)) {
    throw new ValidationError(
      `Cannot move a resolution issue from ${from} to ${to}`,
      { from, to, allowed },
    );
  }
}

@Injectable()
export class ResolutionWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  private db(client?: ResolutionDbClient): ResolutionDbClient {
    return client ?? this.prisma;
  }

  private async loadIssue(
    id: number,
    client?: ResolutionDbClient,
  ): Promise<WorkflowIssueSnapshot> {
    const issue = await this.db(client).resolutionIssue.findUnique({
      where: { id },
      select: {
        id: true,
        workflowStatus: true,
        kind: true,
        owner: true,
        priority: true,
        resolvedAt: true,
        verifiedAt: true,
        recurrenceCount: true,
      },
    });
    if (!issue) throw new NotFoundError('ResolutionIssue', String(id));
    return issue;
  }

  /**
   * Applies a field update and its audit event as one unit.
   *
   * `newStatus` is optional: classification, assignment and comments change no status but are
   * still audited, because "who decided this was a TEST_DATA problem" is exactly the kind of
   * thing that gets argued about three weeks later.
   */
  private async commit(params: {
    client?: ResolutionDbClient;
    issue: WorkflowIssueSnapshot;
    action: ResolutionEventAction;
    audit: AuditContext;
    data: Record<string, unknown>;
    newStatus?: ResolutionWorkflowStatus;
  }): Promise<void> {
    const db = this.db(params.client);
    const data = { ...params.data };
    if (params.newStatus) data.workflowStatus = params.newStatus;

    if (Object.keys(data).length > 0) {
      await db.resolutionIssue.update({ where: { id: params.issue.id }, data });
    }
    await db.resolutionEvent.create({
      data: {
        resolutionIssueId: params.issue.id,
        action: params.action,
        previousStatus: params.newStatus ? params.issue.workflowStatus : null,
        newStatus: params.newStatus ?? null,
        actor: params.audit.actor,
        note: params.audit.note ?? null,
        metadata: (params.audit.metadata ?? undefined) as never,
      },
    });
  }

  /** Records the CREATED event for a freshly projected issue. */
  async recordCreation(
    issueId: number,
    actor: string,
    metadata: Record<string, unknown>,
    client?: ResolutionDbClient,
  ): Promise<void> {
    await this.db(client).resolutionEvent.create({
      data: {
        resolutionIssueId: issueId,
        action: RESOLUTION_EVENT_ACTION.CREATED,
        previousStatus: null,
        newStatus: RESOLUTION_WORKFLOW_STATUS.OPEN,
        actor,
        note: null,
        metadata: metadata as never,
      },
    });
  }

  // -------------------------------------------------------------------------
  // User-owned field updates
  // -------------------------------------------------------------------------

  /**
   * Partial update of the user-owned fields. Each changed field emits its own event, so the
   * timeline reads as a list of decisions rather than one opaque "updated".
   */
  async updateUserFields(
    id: number,
    input: {
      actor: unknown;
      kind?: unknown;
      owner?: unknown;
      priority?: unknown;
      user_summary?: unknown;
      title?: unknown;
    },
    client?: ResolutionDbClient,
  ): Promise<void> {
    const actor = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const issue = await this.loadIssue(id, client);

    const kind =
      input.kind === undefined
        ? undefined
        : requireOneOf<ResolutionKind>('kind', input.kind, KINDS);
    const owner = optionalText(
      'owner',
      input.owner,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const priority = optionalOneOf<ResolutionPriority>(
      'priority',
      input.priority,
      PRIORITIES,
    );
    const userSummary = optionalText(
      'user_summary',
      input.user_summary,
      MAX_RESOLUTION_SUMMARY_LENGTH,
    );
    const title =
      input.title === undefined
        ? undefined
        : requireText('title', input.title, MAX_RESOLUTION_TITLE_LENGTH);

    if (
      kind === undefined &&
      owner === undefined &&
      priority === undefined &&
      userSummary === undefined &&
      title === undefined
    ) {
      throw new ValidationError('No updatable field supplied', {
        updatable: ['kind', 'owner', 'priority', 'user_summary', 'title'],
      });
    }

    if (kind !== undefined && kind !== issue.kind) {
      await this.commit({
        client,
        issue,
        action: RESOLUTION_EVENT_ACTION.CLASSIFIED,
        audit: { actor, metadata: { from: issue.kind, to: kind } },
        data: { kind },
      });
    }
    if (owner !== undefined && owner !== issue.owner) {
      await this.commit({
        client,
        issue,
        action: RESOLUTION_EVENT_ACTION.ASSIGNED,
        audit: { actor, metadata: { from: issue.owner, to: owner } },
        data: { owner },
      });
    }
    if (priority !== undefined && priority !== issue.priority) {
      await this.commit({
        client,
        issue,
        action: RESOLUTION_EVENT_ACTION.PRIORITY_CHANGED,
        audit: { actor, metadata: { from: issue.priority, to: priority } },
        data: { priority },
      });
    }
    if (userSummary !== undefined || title !== undefined) {
      const data: Record<string, unknown> = {};
      if (userSummary !== undefined) data.userSummary = userSummary;
      if (title !== undefined) data.title = title;
      await this.commit({
        client,
        issue,
        action: RESOLUTION_EVENT_ACTION.SUMMARY_UPDATED,
        audit: { actor, metadata: { fields: Object.keys(data) } },
        data,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Status transitions
  // -------------------------------------------------------------------------

  /** The transitions that carry no extra evidence: request a decision, mark ready, give up, reopen. */
  async changeStatus(
    id: number,
    input: { actor: unknown; target_status: unknown; reason?: unknown },
    client?: ResolutionDbClient,
  ): Promise<void> {
    const actor = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const target = requireOneOf(
      'target_status',
      input.target_status,
      RESOLUTION_DIRECT_STATUS_TARGETS,
    );
    const issue = await this.loadIssue(id, client);

    // Leaving a final state is a reopen, and a reopen always needs a reason on the record.
    const isReopen =
      target === RESOLUTION_WORKFLOW_STATUS.OPEN &&
      (issue.workflowStatus === RESOLUTION_WORKFLOW_STATUS.VERIFIED ||
        issue.workflowStatus === RESOLUTION_WORKFLOW_STATUS.WONT_RESOLVE);
    if (isReopen) {
      throw new ValidationError(
        'Reopening a VERIFIED or WONT_RESOLVE issue requires POST /reopen with a reason',
        { from: issue.workflowStatus },
      );
    }

    assertTransitionAllowed(issue.workflowStatus, target);
    const reason = optionalText(
      'reason',
      input.reason,
      MAX_RESOLUTION_NOTE_LENGTH,
    );

    await this.commit({
      client,
      issue,
      action: RESOLUTION_EVENT_ACTION.STATUS_CHANGED,
      audit: { actor, note: reason ?? null },
      data: {},
      newStatus: target,
    });
  }

  /**
   * The authoritative answer to "what is the system supposed to do here".
   *
   * Distinct from a comment on purpose: comments are discussion and never change state, a
   * decision is the thing the resolution is then measured against.
   */
  async recordDecision(
    id: number,
    input: { actor: unknown; decision: unknown },
    client?: ResolutionDbClient,
  ): Promise<void> {
    const actor = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const decision = requireText(
      'decision',
      input.decision,
      MAX_RESOLUTION_DECISION_LENGTH,
    );
    const issue = await this.loadIssue(id, client);

    assertTransitionAllowed(
      issue.workflowStatus,
      RESOLUTION_WORKFLOW_STATUS.DECIDED,
    );

    await this.commit({
      client,
      issue,
      action: RESOLUTION_EVENT_ACTION.DECISION_RECORDED,
      audit: { actor, note: decision },
      data: { decision, decisionBy: actor, decisionAt: new Date() },
      newStatus: RESOLUTION_WORKFLOW_STATUS.DECIDED,
    });
  }

  /**
   * What was actually changed or prepared. Lands on READY_FOR_RERUN and never on VERIFIED:
   * "we fixed it" is a claim, and the queue only accepts evidence from a later execution.
   */
  async recordResolution(
    id: number,
    input: { actor: unknown; resolution: unknown; resolution_type: unknown },
    client?: ResolutionDbClient,
  ): Promise<void> {
    const actor = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const resolution = requireText(
      'resolution',
      input.resolution,
      MAX_RESOLUTION_RESOLUTION_LENGTH,
    );
    const resolutionType = requireOneOf<ResolutionType>(
      'resolution_type',
      input.resolution_type,
      RESOLUTION_TYPES,
    );
    const issue = await this.loadIssue(id, client);

    assertTransitionAllowed(
      issue.workflowStatus,
      RESOLUTION_WORKFLOW_STATUS.READY_FOR_RERUN,
    );

    await this.commit({
      client,
      issue,
      action: RESOLUTION_EVENT_ACTION.RESOLUTION_RECORDED,
      audit: {
        actor,
        note: resolution,
        metadata: { resolution_type: resolutionType },
      },
      data: {
        resolution,
        resolutionType,
        resolvedBy: actor,
        resolvedAt: new Date(),
      },
      newStatus: RESOLUTION_WORKFLOW_STATUS.READY_FOR_RERUN,
    });
  }

  /**
   * Verification rests on a later execution, not on an assertion of confidence.
   *
   * The run must exist, must have started *after* the resolution was recorded, and must exercise
   * one of the scenarios this issue was actually observed in — otherwise "verified" would mean
   * "some unrelated test passed". A manual verification is possible, but only through the
   * override path, which demands a reason and is audited under its own action so it is visible
   * in the timeline rather than indistinguishable from an evidence-backed one.
   */
  async verify(
    id: number,
    input: {
      actor: unknown;
      verification_note: unknown;
      verification_run_id?: unknown;
      override?: unknown;
      override_reason?: unknown;
    },
    deps: {
      findRun: (
        runId: string,
      ) => Promise<{ id: string; startedAt: Date; scenarioKey: string } | null>;
      affectedScenarioKeys: (issueId: number) => Promise<string[]>;
    },
    client?: ResolutionDbClient,
  ): Promise<void> {
    const actor = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const note = requireText(
      'verification_note',
      input.verification_note,
      MAX_RESOLUTION_NOTE_LENGTH,
    );
    const issue = await this.loadIssue(id, client);

    assertTransitionAllowed(
      issue.workflowStatus,
      RESOLUTION_WORKFLOW_STATUS.VERIFIED,
    );

    const override = input.override === true;
    const runId = optionalText(
      'verification_run_id',
      input.verification_run_id,
      200,
    );

    let action: ResolutionEventAction = RESOLUTION_EVENT_ACTION.VERIFIED;
    let verificationRunId: string | null = null;
    let overrideReason: string | null = null;

    if (runId) {
      const run = await deps.findRun(runId);
      if (!run) throw new NotFoundError('TestRun', runId);

      if (issue.resolvedAt && run.startedAt <= issue.resolvedAt) {
        throw new ValidationError(
          'The verification run started before the resolution was recorded, so it cannot show the resolution worked',
          {
            field: 'verification_run_id',
            run_started_at: run.startedAt.toISOString(),
            resolved_at: issue.resolvedAt.toISOString(),
          },
        );
      }

      const scenarioKeys = await deps.affectedScenarioKeys(id);
      if (scenarioKeys.length > 0 && !scenarioKeys.includes(run.scenarioKey)) {
        throw new ValidationError(
          'The verification run does not exercise any scenario this issue was observed in',
          {
            field: 'verification_run_id',
            run_scenario_key: run.scenarioKey,
            affected_scenario_keys: scenarioKeys,
          },
        );
      }
      verificationRunId = run.id;
    } else if (override) {
      overrideReason = requireText(
        'override_reason',
        input.override_reason,
        MAX_RESOLUTION_NOTE_LENGTH,
        MIN_RESOLUTION_REASON_LENGTH,
      );
      action = RESOLUTION_EVENT_ACTION.VERIFIED_WITHOUT_RUN;
    } else {
      throw new ValidationError(
        'Verification requires verification_run_id, or override:true with an override_reason',
        { field: 'verification_run_id' },
      );
    }

    await this.commit({
      client,
      issue,
      action,
      audit: {
        actor,
        note,
        metadata: overrideReason
          ? { override_reason: overrideReason }
          : { run_id: verificationRunId },
      },
      data: {
        verificationNote: note,
        verifiedBy: actor,
        verifiedAt: new Date(),
        verificationRunId,
      },
      newStatus: RESOLUTION_WORKFLOW_STATUS.VERIFIED,
    });
  }

  /**
   * Manual reopen. The prior decision, resolution and verification are deliberately left on the
   * record — an issue that came back is more useful with its history than without it, and the
   * audit event plus the new status already say it is open again.
   */
  async reopen(
    id: number,
    input: { actor: unknown; reason: unknown },
    client?: ResolutionDbClient,
  ): Promise<void> {
    const actor = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const reason = requireText(
      'reason',
      input.reason,
      MAX_RESOLUTION_NOTE_LENGTH,
      MIN_RESOLUTION_REASON_LENGTH,
    );
    const issue = await this.loadIssue(id, client);

    assertTransitionAllowed(
      issue.workflowStatus,
      RESOLUTION_WORKFLOW_STATUS.OPEN,
    );

    await this.commit({
      client,
      issue,
      action: RESOLUTION_EVENT_ACTION.REOPENED,
      audit: { actor, note: reason, metadata: { from: issue.workflowStatus } },
      data: {},
      newStatus: RESOLUTION_WORKFLOW_STATUS.OPEN,
    });
  }

  /**
   * New evidence arrived for an already-VERIFIED issue.
   *
   * The only transition the sync performs by itself. Comments, decision, resolution and the
   * previous verification are all preserved — the recurrence is additional history, not a reset.
   */
  async recordRecurrence(
    id: number,
    params: {
      actor: string;
      runId: string;
      observedAt: Date;
      observationKey: string;
    },
    client?: ResolutionDbClient,
  ): Promise<boolean> {
    const issue = await this.loadIssue(id, client);
    if (issue.workflowStatus !== RESOLUTION_WORKFLOW_STATUS.VERIFIED)
      return false;

    assertTransitionAllowed(
      issue.workflowStatus,
      RESOLUTION_WORKFLOW_STATUS.RECURRED,
    );

    await this.commit({
      client,
      issue,
      action: RESOLUTION_EVENT_ACTION.RECURRED,
      audit: {
        actor: params.actor,
        note: `New unresolved evidence in run ${params.runId} after verification`,
        metadata: {
          run_id: params.runId,
          observation_key: params.observationKey,
          observed_at: params.observedAt.toISOString(),
          verified_at: issue.verifiedAt?.toISOString() ?? null,
        },
      },
      data: { recurrenceCount: issue.recurrenceCount + 1 },
      newStatus: RESOLUTION_WORKFLOW_STATUS.RECURRED,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Links
  // -------------------------------------------------------------------------

  async linkDefect(
    id: number,
    input: { actor: unknown; defect_signature_id: unknown; note?: unknown },
    deps: { defectExists: (defectId: number) => Promise<boolean> },
    client?: ResolutionDbClient,
  ): Promise<void> {
    const actor = requireText(
      'actor',
      input.actor,
      MAX_RESOLUTION_ACTOR_LENGTH,
    );
    const note = optionalText('note', input.note, MAX_RESOLUTION_NOTE_LENGTH);
    const issue = await this.loadIssue(id, client);

    let defectSignatureId: number | null = null;
    if (
      input.defect_signature_id !== null &&
      input.defect_signature_id !== undefined
    ) {
      const parsed = Number(input.defect_signature_id);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError(
          'defect_signature_id must be a positive integer or null',
          {
            field: 'defect_signature_id',
          },
        );
      }
      if (!(await deps.defectExists(parsed))) {
        throw new NotFoundError('DefectSignature', String(parsed));
      }
      defectSignatureId = parsed;
    }

    await this.commit({
      client,
      issue,
      action: RESOLUTION_EVENT_ACTION.DEFECT_LINKED,
      audit: {
        actor,
        note,
        metadata: { defect_signature_id: defectSignatureId },
      },
      data: { defectSignatureId },
    });
  }
}
