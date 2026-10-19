-- Adds the two grouping vocabularies a scenario already carries, so the reporting app can filter
-- and group by feature/module.
--
-- Unlike `run_type` (derived here, during sync, because the runner's SQLite file could not carry
-- it), these are stamped by the runner itself at persist time and merely copied across:
-- `resolveGrouping` in tests/starlive-api-regression/src/harness/store/persist-run.ts resolves both
-- from the scenario key via SCENARIO_GROUPS/artifactGroup -- the same lookup that decides which
-- folder the run's report and evidence land in, so a row and its artifacts cannot disagree.
--
--   module  suite folder      'purchase-order', 'warehouse', ...     (SuiteModule, 10 today)
--   domain  documentation     'don-hang', 'kho', 'kho-bao-cao-kho'   (finer: warehouse splits)

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
-- Nullable, and deliberately WITHOUT the enum-as-CHECK that `run_type` carries: `run_type` is a
-- closed two-value enum, whereas these grow every time a suite folder or documentation module is
-- added, and a CHECK would turn that routine addition into a migration that must land before the
-- next sync or lose rows. NULL `module` is a real value: the producer was not a registered
-- scenario (a probe, an ad hoc MCP session), and guessing would be worse.

ALTER TABLE "test_cases"
  ADD COLUMN "module" TEXT,
  ADD COLUMN "domain" TEXT;

ALTER TABLE "test_runs"
  ADD COLUMN "module" TEXT,
  ADD COLUMN "domain" TEXT;

-- ---------------------------------------------------------------------------
-- Indexes -- the module/feature filters hit these on every list request, and the
-- dashboard groups runs by module.
-- ---------------------------------------------------------------------------

CREATE INDEX "test_cases_module_idx" ON "test_cases"("module");
CREATE INDEX "test_cases_domain_idx" ON "test_cases"("domain");
CREATE INDEX "test_runs_module_idx"  ON "test_runs"("module");
CREATE INDEX "test_runs_domain_idx"  ON "test_runs"("domain");

-- ---------------------------------------------------------------------------
-- No backfill
-- ---------------------------------------------------------------------------
-- `run_type` could seed itself from the `ui-%` scenario-key convention. There is no equivalent
-- signal for module/domain inside this database: the mapping lives in the runner's generated
-- SCENARIO_GROUPS, and `test_case_id` is not a reliable stand-in (upsertTestCase falls back to the
-- scenario key when a scenario omits overview.testCaseId). Rows imported before this migration
-- therefore keep NULL until the runner re-persists them and `db:sync` copies the values across.
