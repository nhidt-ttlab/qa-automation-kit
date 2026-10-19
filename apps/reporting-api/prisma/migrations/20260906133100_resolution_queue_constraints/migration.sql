-- Companion to 20260906133053_resolution_queue: the parts of the Resolution Queue schema that
-- Prisma's schema language cannot express.
--
-- House rule, same as 20260903000000_module_and_domain: CHECK the *closed* vocabularies (kind,
-- workflow_status, resolution_type, priority, observed_result — all defined in
-- packages/shared/src/constants.ts and changed only by a code release), and deliberately do NOT
-- CHECK the open ones (`module`, `domain`, `link_type`), where a new value is a routine addition
-- that must not have to land as a migration before the next sync or lose rows.
--
-- Rollback: drop the constraints below, then DROP TABLE in FK order —
--   resolution_redmine_links, resolution_events, resolution_comments,
--   resolution_observations, resolution_issues.
-- Nothing outside these five tables is touched by either migration, so a rollback cannot affect
-- runs, defects or bug links.

-- ---------------------------------------------------------------------------
-- Closed vocabularies
-- ---------------------------------------------------------------------------

ALTER TABLE "resolution_issues"
  ADD CONSTRAINT "resolution_issues_kind_check"
  CHECK ("kind" IN (
    'SPEC_DECISION', 'TEST_DATA', 'ENVIRONMENT', 'AUTOMATION',
    'MISSING_IMPLEMENTATION', 'PRODUCT_DEFECT', 'UNCLASSIFIED'
  ));

ALTER TABLE "resolution_issues"
  ADD CONSTRAINT "resolution_issues_workflow_status_check"
  CHECK ("workflow_status" IN (
    'OPEN', 'WAITING_FOR_DECISION', 'DECIDED', 'READY_FOR_RERUN',
    'VERIFIED', 'RECURRED', 'WONT_RESOLVE'
  ));

ALTER TABLE "resolution_issues"
  ADD CONSTRAINT "resolution_issues_resolution_type_check"
  CHECK ("resolution_type" IS NULL OR "resolution_type" IN (
    'SPEC_CLARIFIED', 'DATA_PREPARED', 'ENVIRONMENT_FIXED', 'AUTOMATION_FIXED',
    'PRODUCT_FIXED', 'DUPLICATE', 'WONT_RESOLVE'
  ));

ALTER TABLE "resolution_issues"
  ADD CONSTRAINT "resolution_issues_priority_check"
  CHECK ("priority" IS NULL OR "priority" IN ('Critical', 'High', 'Medium', 'Low'));

ALTER TABLE "resolution_observations"
  ADD CONSTRAINT "resolution_observations_observed_result_check"
  CHECK ("observed_result" IN ('NOT_EVALUATED', 'BLOCKED', 'PARTIAL', 'ERROR'));

-- ---------------------------------------------------------------------------
-- Structural invariants
-- ---------------------------------------------------------------------------

-- A resolved issue must say what kind of resolution it was, and by whom/when. Enforced here
-- rather than only in the service so a stray SQL fix cannot leave a half-resolved row behind.
ALTER TABLE "resolution_issues"
  ADD CONSTRAINT "resolution_issues_resolution_state_check"
  CHECK (
    ("resolution" IS NULL AND "resolution_type" IS NULL AND "resolved_by" IS NULL AND "resolved_at" IS NULL)
    OR ("resolution" IS NOT NULL AND "resolution_type" IS NOT NULL AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
  );

-- Same for verification. `verification_run_id` is intentionally NOT required: a manual
-- verification is allowed, but only through the audited override path.
ALTER TABLE "resolution_issues"
  ADD CONSTRAINT "resolution_issues_verification_state_check"
  CHECK (
    ("verified_by" IS NULL AND "verified_at" IS NULL)
    OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL)
  );

-- A check-level observation carries its position; a run-level one carries none. The
-- observation_key prefix and the presence of check_sequence must agree, otherwise the
-- (issue, run, key) uniqueness stops meaning what the projection assumes it means.
ALTER TABLE "resolution_observations"
  ADD CONSTRAINT "resolution_observations_key_shape_check"
  CHECK (
    ("observation_key" LIKE 'check:%' AND "check_sequence" IS NOT NULL)
    OR ("observation_key" IN ('run:blocked', 'run:error') AND "check_sequence" IS NULL)
  );

-- Non-empty free text where the column is NOT NULL: an empty reason or comment is a bug in the
-- writer, not a legitimate state, and it is cheaper to reject than to render.
ALTER TABLE "resolution_observations"
  ADD CONSTRAINT "resolution_observations_raw_reason_not_blank_check"
  CHECK (btrim("raw_reason") <> '');

ALTER TABLE "resolution_comments"
  ADD CONSTRAINT "resolution_comments_body_not_blank_check"
  CHECK (btrim("body") <> '');

ALTER TABLE "resolution_comments"
  ADD CONSTRAINT "resolution_comments_author_not_blank_check"
  CHECK (btrim("author") <> '');

ALTER TABLE "resolution_events"
  ADD CONSTRAINT "resolution_events_actor_not_blank_check"
  CHECK (btrim("actor") <> '');
