/**
 * Resolution Queue DTOs.
 *
 * The queue is the human-workflow surface over *unresolved* regression evidence: BLOCKED and
 * ERROR runs, and the `NOT_EVALUATED` checks that make a run PARTIAL. It is a sibling of the
 * defect workflow, not a replacement — a PARTIAL run legitimately contributes failed assertions
 * to `defect_signatures` and unresolved ones here, and the two must not be merged.
 *
 * Field ownership is the load-bearing idea and is mirrored in the Prisma schema:
 *
 *   runner/SQLite  — runs, checks, raw reasons, execution timestamps (never written from here)
 *   sync           — import_key, display_key, source_summary, first/last_seen_at, the counts
 *   reporting      — kind, workflow_status, owner, priority, user_summary, decision, resolution,
 *                    verification, comments, events, defect and Redmine links
 *
 * Wire format is snake_case (Prisma is camelCase), matching every other DTO in this package.
 */

import type {
  ResolutionKind,
  ResolutionType,
  ResolutionWorkflowStatus,
  ResolutionDirectStatusTarget,
  ResolutionPriority,
  ResolutionObservedResult,
  ResolutionEventAction,
  TestRunResult,
} from '../constants.js';

// ============================================================================
// Domain shapes
// ============================================================================

/**
 * One occurrence of an unresolved condition, in one run.
 *
 * `observation_key` is what distinguishes two unresolved conditions inside the *same* run:
 * `check:<seq>` for a check-level observation, `run:blocked` / `run:error` for a run-level one.
 * It is the third leg of the `(issue, run, key)` uniqueness constraint that makes re-running the
 * projection a no-op.
 */
export interface ResolutionObservationResponseDto {
  id: string;
  resolution_issue_id: string;
  run_id: string;
  test_case_id: string;
  scenario_key: string;
  /** 1-based check position; null for a run-level blocker (a BLOCKED run may have no checks). */
  check_sequence?: number | null;
  /** Assertion id such as `TC-KSDH-A05 / A3`, when the scenario supplied one. */
  check_test_id?: string | null;
  check_label?: string | null;
  observation_key: string;
  observed_result: ResolutionObservedResult;
  /** Verbatim reason text as the runner wrote it, JSON-decoded but not otherwise altered. */
  raw_reason: string;
  observed_at: string;
  created_at: string;
  // Denormalized run context, for rendering the observation without a second fetch.
  run_result?: TestRunResult;
  run_environment?: string;
  run_started_at?: string;
}

/**
 * Discussion. Never authoritative: adding a comment does not change status and never becomes a
 * decision. Append-only — `edited` exists so a future edit feature has a place to be honest.
 */
export interface ResolutionCommentResponseDto {
  id: string;
  resolution_issue_id: string;
  body: string;
  author: string;
  edited: boolean;
  created_at: string;
  updated_at: string;
}

/** One entry in the append-only audit timeline. */
export interface ResolutionEventResponseDto {
  id: string;
  resolution_issue_id: string;
  action: ResolutionEventAction;
  previous_status?: ResolutionWorkflowStatus | null;
  new_status?: ResolutionWorkflowStatus | null;
  actor: string;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface ResolutionRedmineLinkResponseDto {
  id: string;
  redmine_issue_id: number;
  redmine_url?: string | null;
  redmine_project?: string | null;
  link_type: string;
  created_by?: string | null;
  created_at: string;
}

// ============================================================================
// Response DTOs
// ============================================================================

/** Row shape for the queue table. */
export interface ResolutionIssueSummaryResponseDto {
  id: string;
  /** Stable machine identity: `<domain>:BL-03` or `auto:<domain>:<hash>`. */
  import_key: string;
  /** Human-readable key, e.g. `kiem-soat-dat-hang-thua:BL-03`. Not unique by design. */
  display_key: string;
  title: string;
  kind: ResolutionKind;
  workflow_status: ResolutionWorkflowStatus;
  owner?: string | null;
  priority?: ResolutionPriority | null;
  module?: string | null;
  domain?: string | null;
  affected_test_case_count: number;
  observation_count: number;
  /** How many times new evidence arrived after a verification. 0 for a never-verified issue. */
  recurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  defect_signature_id?: string | null;
  redmine_issue_count: number;
  updated_at: string;
}

export interface ResolutionIssueDetailResponseDto extends ResolutionIssueSummaryResponseDto {
  /** Derived from the evidence by sync. Refreshed as new observations arrive. */
  source_summary?: string | null;
  /** Written by a human. Sync never touches it. */
  user_summary?: string | null;

  decision?: string | null;
  decision_by?: string | null;
  decision_at?: string | null;

  resolution?: string | null;
  resolution_type?: ResolutionType | null;
  resolved_by?: string | null;
  resolved_at?: string | null;

  verification_note?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  verification_run_id?: string | null;

  affected_test_cases: Array<{
    test_case_id: string;
    scenario_key: string;
    title?: string | null;
    observation_count: number;
  }>;
  affected_runs: Array<{
    run_id: string;
    result: TestRunResult;
    environment: string;
    started_at: string;
    observation_count: number;
  }>;
  observations: ResolutionObservationResponseDto[];
  redmine_links: ResolutionRedmineLinkResponseDto[];
  /** The linked defect signature, if a human linked one, plus its own Redmine links (read-only). */
  defect?: {
    id: string;
    title: string;
    status: string;
    scenario_key: string;
    bug_links: Array<{ id: string; redmine_issue_id: number; redmine_url?: string | null }>;
  } | null;

  created_at: string;
}

/** Counts for the queue header and the dashboard tile row. */
export interface ResolutionQueueSummaryResponseDto {
  total: number;
  by_status: Record<ResolutionWorkflowStatus, number>;
  by_kind: Record<ResolutionKind, number>;
  by_domain: Array<{ domain: string; total: number; unresolved: number }>;
  by_owner: Array<{ owner: string; total: number }>;
  /** Longest-open issues that are not VERIFIED / WONT_RESOLVE, oldest first. */
  oldest_unresolved: Array<{
    id: string;
    display_key: string;
    title: string;
    workflow_status: ResolutionWorkflowStatus;
    first_seen_at: string;
  }>;
}

// ============================================================================
// Query DTO
// ============================================================================

export interface ListResolutionIssuesQueryDto {
  /** Free text over display_key, title, source_summary and user_summary. */
  q?: string;
  display_key?: string;
  kind?: ResolutionKind;
  workflow_status?: ResolutionWorkflowStatus;
  owner?: string;
  priority?: ResolutionPriority;
  /** Open vocabularies — plain strings, same reasoning as ListTestRunsQueryDto.module. */
  module?: string;
  domain?: string;
  scenario_key?: string;
  test_case_id?: string;
  observed_result?: ResolutionObservedResult;
  first_seen_from?: string;
  first_seen_to?: string;
  last_seen_from?: string;
  last_seen_to?: string;
  has_defect?: boolean;
  has_redmine?: boolean;
  page: number;
  limit: number;
  sort_by?: 'last_seen_at' | 'first_seen_at' | 'observation_count' | 'priority' | 'display_key';
  sort_order?: 'ASC' | 'DESC';
}

// ============================================================================
// Request DTOs
//
// Every mutating request carries `actor`. This application has no authentication, so the actor
// is self-asserted and stored verbatim for traceability — see docs/resolution-queue.md.
// ============================================================================

export interface ActorRequestDto {
  actor: string;
}

/** Partial update of the user-owned fields. Sync-owned fields are not addressable here. */
export interface UpdateResolutionIssueRequestDto extends ActorRequestDto {
  kind?: ResolutionKind;
  /** `null` clears the assignment. */
  owner?: string | null;
  priority?: ResolutionPriority | null;
  user_summary?: string | null;
  title?: string;
}

/**
 * The transitions that need no extra payload. DECIDED / VERIFIED are deliberately absent —
 * they demand their own evidence and go through /decision, /resolution and /verify.
 */
export interface ChangeResolutionStatusRequestDto extends ActorRequestDto {
  target_status: ResolutionDirectStatusTarget;
  reason?: string;
}

export interface CreateResolutionCommentRequestDto extends ActorRequestDto {
  body: string;
}

export interface RecordResolutionDecisionRequestDto extends ActorRequestDto {
  /** The authoritative answer: what the system is supposed to do. */
  decision: string;
}

export interface RecordResolutionResolutionRequestDto extends ActorRequestDto {
  /** What was actually changed or prepared, based on the decision. */
  resolution: string;
  resolution_type: ResolutionType;
}

export interface VerifyResolutionIssueRequestDto extends ActorRequestDto {
  verification_note: string;
  /**
   * A run that started *after* the resolution was recorded and exercises one of the issue's
   * affected scenarios. Required unless `override` is set.
   */
  verification_run_id?: string;
  /** Manual verification with no rerun. Requires `override_reason`; audited separately. */
  override?: boolean;
  override_reason?: string;
}

export interface ReopenResolutionIssueRequestDto extends ActorRequestDto {
  /** Mandatory. Prior decision, resolution and verification are preserved, not erased. */
  reason: string;
}

export interface LinkResolutionDefectRequestDto extends ActorRequestDto {
  /** `null` unlinks. */
  defect_signature_id: string | null;
  note?: string;
}

export interface LinkResolutionRedmineRequestDto extends ActorRequestDto {
  redmine_issue_id: number;
  redmine_url?: string;
  redmine_project?: string;
  link_type?: string;
  note?: string;
}
