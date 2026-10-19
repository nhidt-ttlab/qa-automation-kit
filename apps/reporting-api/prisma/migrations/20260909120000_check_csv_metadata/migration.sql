-- Hardening-checklist snapshot on each assertion row.
--
-- Mirrors the four columns the runner added to its own `test_run_checks` in
-- tests/starlive-api-regression/docs/db/schema.sql, so `pnpm db:sync` can carry them across without
-- transforming anything.
--
-- These are a SNAPSHOT, not a reference to a checklist table: the run stores the sheet text it saw,
-- so a later edit to the CSV cannot rewrite what a historical run reported. Nothing here is ever
-- compared to produce a verdict.
--
-- House rule (see 20260903000000_module_and_domain and the *_constraints migrations): CHECK the
-- closed vocabularies and leave the open ones alone. All four of these are open — a new sheet id or
-- a new priority label is a routine addition that must not have to land as a migration before the
-- next sync, or lose rows — so none gets a CHECK.
--
-- Backfilled for historical runs by `pnpm db:backfill-csv-metadata`, which is deliberately a
-- separate, opt-in step: `db:sync` skips runs it has already imported, so it can never fill these.
ALTER TABLE "test_run_checks"
  ADD COLUMN "csv_checklist_id" TEXT,
  ADD COLUMN "csv_testcase_id"  TEXT,
  ADD COLUMN "csv_expected"     TEXT,
  ADD COLUMN "csv_priority"     TEXT;

-- Supports "which runs answered row X of sheet Y", the query the coverage reporting needs.
CREATE INDEX "test_run_checks_csv_checklist_id_csv_testcase_id_idx"
  ON "test_run_checks"("csv_checklist_id", "csv_testcase_id");
