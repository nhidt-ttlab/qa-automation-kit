-- Distinguishes UI runs from API runs, and gives UI runs somewhere to keep their
-- browser evidence index.
--
-- The regression runner knows whether a scenario is UI or API (the `kind` union in
-- src/harness/contract.ts) but never persists it -- its README states outright that
-- "a UI run is indistinguishable from an API run downstream". Rather than migrate the
-- runner's SQLite file (whose artifacts.kind CHECK is baked in at CREATE time and would
-- silently swallow new rows), this database derives run_type during sync and owns it.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE "test_cases"
  ADD COLUMN "run_type" TEXT NOT NULL DEFAULT 'api';

ALTER TABLE "test_runs"
  ADD COLUMN "run_type" TEXT NOT NULL DEFAULT 'api';

-- Normalized UiEvidenceDto (manifest metadata + item list with API-relative URLs).
-- The files themselves live on disk under EVIDENCE_STORAGE_PATH; only the index is here,
-- so a 3 MB Playwright trace never lands in a pg_dump.
ALTER TABLE "test_runs"
  ADD COLUMN "ui_evidence" JSONB;

-- ---------------------------------------------------------------------------
-- Enum-as-CHECK constraints (matching 20260829031200_constraints_and_triggers)
-- ---------------------------------------------------------------------------

ALTER TABLE "test_cases"
  ADD CONSTRAINT "test_cases_run_type_check"
  CHECK ("run_type" IN ('api', 'ui'));

ALTER TABLE "test_runs"
  ADD CONSTRAINT "test_runs_run_type_check"
  CHECK ("run_type" IN ('api', 'ui'));

-- ---------------------------------------------------------------------------
-- Indexes -- the API/UI tabs filter on this column on every list request
-- ---------------------------------------------------------------------------

CREATE INDEX "test_cases_run_type_idx" ON "test_cases"("run_type");
CREATE INDEX "test_runs_run_type_idx" ON "test_runs"("run_type");

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Seeds from the scenario-key convention so the tabs are correct before the next sync.
-- The sync's evidence pass is authoritative and will re-assert this (and additionally
-- populate ui_evidence) on its next run.
--
-- Note this is the ONLY safe prefix signal: test_case_id is NOT reliable, because
-- upsertTestCase falls back to the scenario key when a scenario omits overview.testCaseId
-- (e.g. ui-po-list-columns-vs-source has test_case_id = 'ui-po-list-columns-vs-source'
-- rather than 'TC-DH-U02').

UPDATE "test_runs"  SET "run_type" = 'ui' WHERE "scenario_key" LIKE 'ui-%';
UPDATE "test_cases" SET "run_type" = 'ui' WHERE "scenario_key" LIKE 'ui-%';
