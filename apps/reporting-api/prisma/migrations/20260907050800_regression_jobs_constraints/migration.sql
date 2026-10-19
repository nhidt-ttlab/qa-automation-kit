-- Companion to 20260907050700_regression_jobs: the parts Prisma's schema language cannot express.
--
-- House rule, same as 20260906133100_resolution_queue_constraints: CHECK the *closed*
-- vocabularies (status, kind, clean_scope, data_mode, sync_status — all defined in
-- packages/shared/src/constants.ts and changed only by a code release), and deliberately do NOT
-- CHECK the open one (`environment`), which grows with configs/environments/*.json in a package
-- this migration has no view of.
--
-- The last three constraints are invariants rather than vocabularies. They exist because this is
-- the one table in the schema that a background process mutates while HTTP requests read it, and
-- a half-written transition here does not merely look wrong — it wedges the queue.
--
-- Rollback: drop the constraints below, then DROP TABLE "regression_jobs". Nothing else in the
-- schema references it, and it references nothing: a job describes an action, a test_run
-- describes evidence, and the two are deliberately unlinked.

-- ---------------------------------------------------------------------------
-- Closed vocabularies
-- ---------------------------------------------------------------------------

ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_status_check"
  CHECK ("status" IN (
    'QUEUED', 'PREPARING', 'RUNNING', 'SYNCING',
    'SUCCEEDED', 'FAILED', 'CANCELLED', 'ERRORED', 'ORPHANED'
  ));

-- The runner throws on any other --kind, so a bad value must never reach the spawn.
ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_kind_check"
  CHECK ("kind" IS NULL OR "kind" IN ('api', 'ui'));

ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_clean_scope_check"
  CHECK ("clean_scope" IS NULL OR "clean_scope" IN ('run', 'all'));

ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_data_mode_check"
  CHECK ("data_mode" IN ('existing', 'seeded'));

ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_sync_status_check"
  CHECK ("sync_status" IS NULL OR "sync_status" IN (
    'SKIPPED', 'PENDING', 'RUNNING', 'OK', 'FAILED'
  ));

-- ---------------------------------------------------------------------------
-- Invariants
-- ---------------------------------------------------------------------------

-- The mutex, tied to the status it claims to describe.
--
-- `active_slot` is UNIQUE and nullable, so "at most one row holds TRUE" is already enforced by the
-- index; what this adds is that the row holding it is actually running. Without it a stray UPDATE
-- could leave active_slot = TRUE on a finished job and wedge the queue forever, or clear it on a
-- running one and let a second batch start against the same shared qa tenant.
--
-- Turning this into a FIFO queue means removing 'QUEUED' from both lists below, so a queued row
-- no longer holds the slot.
ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_active_slot_check"
  CHECK (
    ("status" IN ('QUEUED', 'PREPARING', 'RUNNING', 'SYNCING') AND "active_slot" IS TRUE)
    OR
    ("status" NOT IN ('QUEUED', 'PREPARING', 'RUNNING', 'SYNCING') AND "active_slot" IS NULL)
  );

-- A terminal job has stopped; a live one has not. Enforced here rather than only in the service so
-- a crash mid-transition cannot leave a row that renders as "running since three days ago".
ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_terminal_state_check"
  CHECK (
    ("status" IN ('QUEUED', 'PREPARING', 'RUNNING', 'SYNCING') AND "finished_at" IS NULL)
    OR
    ("status" NOT IN ('QUEUED', 'PREPARING', 'RUNNING', 'SYNCING') AND "finished_at" IS NOT NULL)
  );

-- requested_by is the only accountability this feature has: the API has no authentication, so the
-- actor is self-asserted and a blank one would make a destructive job anonymous.
ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_requested_by_not_blank_check"
  CHECK (btrim("requested_by") <> '');

ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_log_line_count_check"
  CHECK ("log_line_count" >= 0);

ALTER TABLE "regression_jobs"
  ADD CONSTRAINT "regression_jobs_ui_slowmo_check"
  CHECK ("ui_slowmo_ms" IS NULL OR ("ui_slowmo_ms" >= 0 AND "ui_slowmo_ms" <= 5000));
