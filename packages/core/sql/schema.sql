-- Regression Reporting DB — SQLite schema (v2)
-- v2 incorporates schema-review feedback: artifact storage-state CHECK, generalized run payloads
-- (no more per-scenario payload_a/payload_b columns), defect signature/observation split, JSON
-- validity CHECKs, updated_at staleness triggers, and a broader related-entity type enum.
-- See ../regression-reporting-db-design.md for the full design rationale.
-- Apply with: sqlite3 regression.db < schema.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS test_cases (
  id            TEXT PRIMARY KEY,                 -- e.g. 'TC-DH-R02'
  scenario_key  TEXT NOT NULL UNIQUE,              -- scenario registry key
  title         TEXT NOT NULL,
  objective     TEXT,
  impacted_area TEXT,
  -- Suite folder the scenario lives in (`src/suites/<module>/`) and the documentation module
  -- it belongs to (`docs/02-features/erp-feature-extraction/<domain>/`). Both are resolved from
  -- the scenario key alone at persist time, via SCENARIO_GROUPS/artifactGroup(). `domain` is
  -- strictly finer than `module`: `warehouse` splits into `kho` and `kho-bao-cao-kho`.
  -- Deliberately no CHECK — see the note on insertArtifact in ../../src/harness/store/persist-run.ts:
  -- client.ts only ever runs CREATE TABLE IF NOT EXISTS, so a CHECK added here would never reach an
  -- existing regression.db, and a value outside it would make the INSERT throw into a silent warn.
  module        TEXT,
  domain        TEXT,
  -- ERP feature id from the Feature List workbook ('QLDN-VT-04' = Cài đặt sinh mã). Declared per
  -- scenario as `const FEATURE_ID` and resolved through SCENARIO_GROUPS, the same lookup as
  -- `module`. NULL for every scenario that has not declared one -- most of them: the id numbers a
  -- SCREEN in the business spec, so a case whose screen has no workbook entry stays silent rather
  -- than carry a guess. Not a grouping vocabulary; nothing routes artifacts by it.
  feature_id    TEXT,
  owner         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','draft')),
  version_label TEXT,                              -- MVP stand-in for a full test_case_versions table
  tags          JSON CHECK (tags IS NULL OR json_valid(tags)),         -- array of strings
  metadata      JSON CHECK (metadata IS NULL OR json_valid(metadata)), -- scenario-specific extension bag
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_id_scenario
  ON test_cases(id, scenario_key);

CREATE INDEX IF NOT EXISTS idx_test_cases_module ON test_cases(module);
CREATE INDEX IF NOT EXISTS idx_test_cases_domain ON test_cases(domain);
CREATE INDEX IF NOT EXISTS idx_test_cases_feature_id ON test_cases(feature_id);

-- Keeps updated_at honest after the first UPDATE. The WHEN guard stops this from re-firing itself
-- forever: on the trigger's own UPDATE, NEW.updated_at (the fresh timestamp it just set) no longer
-- equals OLD.updated_at, so the condition is false the second time around.
CREATE TRIGGER IF NOT EXISTS trg_test_cases_updated_at
AFTER UPDATE ON test_cases
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE test_cases SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

-- Phase 2 (postponed in MVP, kept here for reference — see design doc §9):
-- CREATE TABLE test_case_versions (
--   id             INTEGER PRIMARY KEY AUTOINCREMENT,
--   test_case_id   TEXT NOT NULL REFERENCES test_cases(id),
--   version_no     INTEGER NOT NULL,
--   doc_snapshot   TEXT,
--   changelog      TEXT,
--   effective_from TEXT NOT NULL,
--   UNIQUE(test_case_id, version_no)
-- );

CREATE TABLE IF NOT EXISTS test_runs (
  id                     TEXT PRIMARY KEY,          -- 'run-<ts36>-<rand>'
  test_case_id           TEXT NOT NULL,
  scenario_key           TEXT NOT NULL,              -- denormalized snapshot at run time
  -- Denormalized from test_cases at run time, for the same reason scenario_key is: the reporting
  -- app filters and groups runs by module/feature without a join, and a run keeps the grouping it
  -- had when it executed even if the scenario later moves suite folders.
  module                 TEXT,
  domain                 TEXT,
  environment            TEXT NOT NULL,
  dry_run                INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0,1)),
  result                 TEXT NOT NULL CHECK (result IN ('PASS','PARTIAL','FAIL','BLOCKED','ERROR')),
  started_at             TEXT NOT NULL,
  finished_at            TEXT,
  duration_ms            INTEGER,
  executed_by            TEXT,
  git_commit             TEXT,
  git_branch             TEXT,
  business_scenario      TEXT,
  severity               TEXT,
  reproducibility        TEXT,
  defect_statement       TEXT,
  blocked_reason         TEXT,
  error_summary          TEXT,
  conclusion             TEXT,
  overview_key_data      JSON CHECK (overview_key_data   IS NULL OR json_valid(overview_key_data)),
  overview_highlights    JSON CHECK (overview_highlights IS NULL OR json_valid(overview_highlights)),
  -- Generalized, scenario-agnostic replacement for the old payload_a/payload_a_context/payload_b/
  -- payload_b_context columns: an array of `{label, payload, context}` objects, one per order/subject
  -- the scenario exercised. A single-order scenario writes a one-element array; a dual-order scenario
  -- (e.g. po-excess-qty-double-use) writes two. New scenarios never need a new column.
  payloads               JSON CHECK (payloads IS NULL OR json_valid(payloads)),
  tags                   JSON CHECK (tags IS NULL OR json_valid(tags)),
  -- Escape valve for report data that doesn't warrant its own column/table: the full
  -- created-order object(s) (`createdOrder`/`createdOrderA`/`createdOrderB`, needed verbatim
  -- to render the Technical Appendix's "Created order" block) and any scenario-supplied
  -- `detailTables` (ad hoc evidence tables). See regression-reporting-db-design.md §2/§11.
  custom_data            JSON CHECK (custom_data IS NULL OR json_valid(custom_data)),
  -- The fully resolved `QaReportModel` (report/qa-model.ts) — the generic base model merged
  -- with the scenario's `QaReportModelOverride`, exactly as handed to `renderQaMarkdown`.
  -- This is the primary reconstruction source for report sections 1-7 and 9 (header, QA
  -- summary, expected-vs-actual, repro steps, passed scope, defect details, evidence summary,
  -- conclusion): those fields can be freely scenario-authored prose, not always mechanically
  -- re-derivable from `test_run_checks`/`test_run_steps` alone. See design doc §11.
  report_model           JSON CHECK (report_model IS NULL OR json_valid(report_model)),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (test_case_id, scenario_key) REFERENCES test_cases(id, scenario_key)
);

CREATE INDEX IF NOT EXISTS idx_test_runs_case_started ON test_runs(test_case_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_result       ON test_runs(result);
CREATE INDEX IF NOT EXISTS idx_test_runs_environment  ON test_runs(environment);
CREATE INDEX IF NOT EXISTS idx_test_runs_started_at   ON test_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_test_runs_module       ON test_runs(module);
CREATE INDEX IF NOT EXISTS idx_test_runs_domain       ON test_runs(domain);

CREATE TABLE IF NOT EXISTS test_run_checks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  test_id  TEXT,
  label    TEXT NOT NULL,        -- technical label, e.g. "A4: rejection code is ERP:..."
  expected JSON CHECK (expected IS NULL OR json_valid(expected)),
  actual   JSON CHECK (actual   IS NULL OR json_valid(actual)),
  passed   INTEGER NOT NULL CHECK (passed IN (0,1)),
  -- Hardening-checklist snapshot: the sheet row this assertion answers, copied in at run time.
  -- All of them are NULL for an assertion that maps to no row, which is most of them.
  --
  -- This is a SNAPSHOT, not a reference: the run stores the text it saw, so editing the CSV later
  -- cannot rewrite what a historical run reported. Nothing here is ever compared to produce a
  -- verdict -- `expected`/`actual` above remain the only oracle.
  --
  -- An assertion answering several rows joins them all with ' | ', keeping the segments aligned.
  csv_checklist_id TEXT,        -- sheet id, e.g. 'QLDN-VT-04'; scopes csv_testcase_id
  csv_testcase_id  TEXT,        -- the sheet's row id, e.g. 'TC_16'; repeats across sheets
  csv_expected     TEXT,        -- the `Expected Result` cell, verbatim
  csv_business_rule TEXT,       -- the `Business Rule / Checklist` cell; NULL where the sheet has no such column
  csv_priority     TEXT,        -- the `Priority` cell; NULL where the sheet has no such column
  UNIQUE(run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_checks_run ON test_run_checks(run_id);
CREATE INDEX IF NOT EXISTS idx_checks_csv ON test_run_checks(csv_checklist_id, csv_testcase_id);

CREATE TABLE IF NOT EXISTS test_run_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  title       TEXT NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0,1)),
  http_status INTEGER,
  -- Optional free-form diagnostic payload for a step that carries its own evidence beyond a linked
  -- check (e.g. {"waitedMs": 4200, "pollAttempts": 3}). Deliberately not `expected`/`actual` columns —
  -- that pairing already has a home in test_run_checks; a step's notes aren't always a comparison.
  details     JSON CHECK (details IS NULL OR json_valid(details)),
  UNIQUE(run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_steps_run ON test_run_steps(run_id);

CREATE TABLE IF NOT EXISTS test_run_evidence (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  seq                   INTEGER NOT NULL,          -- display id = 'E' || seq
  method                TEXT NOT NULL,
  endpoint              TEXT NOT NULL,             -- shortened path, ids collapsed to {id}
  purpose               TEXT,
  key_input             TEXT,
  http_status           INTEGER,
  result_classification TEXT,
  collapsed_count       INTEGER NOT NULL DEFAULT 1,
  is_key_evidence       INTEGER NOT NULL DEFAULT 0 CHECK (is_key_evidence IN (0,1)),
  artifact_id           INTEGER,
  UNIQUE(run_id, seq),
  FOREIGN KEY (run_id, artifact_id) REFERENCES artifacts(run_id, id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_run ON test_run_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_key ON test_run_evidence(run_id, is_key_evidence);

CREATE TABLE IF NOT EXISTS test_run_related_entities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL CHECK (entity_type IN (
    'project','purchase_order','supply_contract','item','tower',
    'location','workflow','supplier','phase','work_package'
  )),
  entity_id    TEXT NOT NULL,
  entity_label TEXT,
  UNIQUE(run_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_related_entity ON test_run_related_entities(entity_type, entity_id);

-- storage_type determines which single one of path/blob/external_url is populated — the CHECK below
-- makes the other impossible states (e.g. storage_type='file' with path NULL, or two of the three
-- populated at once) unrepresentable rather than just discouraged by convention.
CREATE TABLE IF NOT EXISTS artifacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('markdown_report','json_run_artifact','raw_trace','review_record','proposal_record','other')),
  storage_type  TEXT NOT NULL DEFAULT 'file' CHECK (storage_type IN ('file','blob','external_url')),
  path          TEXT,
  blob          BLOB,
  external_url  TEXT,
  content_hash  TEXT,
  size_bytes    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (storage_type = 'file'         AND path IS NOT NULL AND blob IS NULL AND external_url IS NULL) OR
    (storage_type = 'blob'         AND blob IS NOT NULL AND path IS NULL AND external_url IS NULL) OR
    (storage_type = 'external_url' AND external_url IS NOT NULL AND path IS NULL AND blob IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_run_id_id ON artifacts(run_id, id);

-- Master defect identity: one row per distinct underlying bug, keyed by signature_hash. Title,
-- severity, and diagnosis fields live here — once, not copied into every run that reproduces it —
-- so 20 runs hitting the same bug can never disagree on what it is or how severe it is.
CREATE TABLE IF NOT EXISTS defect_signatures (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  signature_hash         TEXT NOT NULL UNIQUE,
  scenario_key           TEXT NOT NULL REFERENCES test_cases(scenario_key),
  title                  TEXT NOT NULL,
  severity               TEXT,
  probable_failing_rule  TEXT,
  suspected_component    TEXT,
  regression_note        TEXT,
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','duplicate','resolved','wontfix')),
  first_observed_run_id  TEXT REFERENCES test_runs(id),
  last_observed_run_id   TEXT REFERENCES test_runs(id),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_defect_signatures_status ON defect_signatures(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_defect_signatures_id_scenario
  ON defect_signatures(id, scenario_key);

CREATE TRIGGER IF NOT EXISTS trg_defect_signatures_updated_at
AFTER UPDATE ON defect_signatures
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE defect_signatures SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

-- One row per run that reproduced a given defect_signature — the per-run evidence, not the identity.
CREATE TABLE IF NOT EXISTS defect_observations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  defect_signature_id INTEGER NOT NULL REFERENCES defect_signatures(id),
  run_id              TEXT NOT NULL REFERENCES test_runs(id),
  defect_statement    TEXT,
  observed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(defect_signature_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_defect_observations_signature ON defect_observations(defect_signature_id);
CREATE INDEX IF NOT EXISTS idx_defect_observations_run       ON defect_observations(run_id);

CREATE TRIGGER IF NOT EXISTS trg_defect_observations_validate_scenario
BEFORE INSERT ON defect_observations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (
      SELECT ds.scenario_key
      FROM defect_signatures ds
      WHERE ds.id = NEW.defect_signature_id
    ) != (
      SELECT tr.scenario_key
      FROM test_runs tr
      WHERE tr.id = NEW.run_id
    )
    THEN RAISE(ABORT, 'defect observation scenario mismatch')
  END;
END;

-- Keeps defect_signatures.first_observed_run_id / last_observed_run_id current using the run's
-- started_at chronology, not insert order, so backfilled older runs cannot corrupt the history.
CREATE TRIGGER IF NOT EXISTS trg_defect_observations_touch_signature
AFTER INSERT ON defect_observations
FOR EACH ROW
BEGIN
  UPDATE defect_signatures
  SET first_observed_run_id = CASE
        WHEN first_observed_run_id IS NULL THEN NEW.run_id
        WHEN (
          SELECT started_at FROM test_runs WHERE id = NEW.run_id
        ) < (
          SELECT started_at FROM test_runs WHERE id = first_observed_run_id
        ) THEN NEW.run_id
        ELSE first_observed_run_id
      END,
      last_observed_run_id = CASE
        WHEN last_observed_run_id IS NULL THEN NEW.run_id
        WHEN (
          SELECT started_at FROM test_runs WHERE id = NEW.run_id
        ) > (
          SELECT started_at FROM test_runs WHERE id = last_observed_run_id
        ) THEN NEW.run_id
        ELSE last_observed_run_id
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.defect_signature_id;
END;

-- External Redmine references attach to the defect *signature* (the master bug), not to one run —
-- a run is provenance for how the link was created, not the thing the link is about.
CREATE TABLE IF NOT EXISTS bug_links (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  defect_signature_id  INTEGER NOT NULL REFERENCES defect_signatures(id),
  created_from_run_id  TEXT REFERENCES test_runs(id),
  redmine_issue_id     INTEGER NOT NULL,
  redmine_project      TEXT,
  redmine_url          TEXT,
  link_type            TEXT NOT NULL DEFAULT 'created_from_run' CHECK (link_type IN ('created_from_run','manually_linked','duplicate_of')),
  created_by           TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(defect_signature_id, redmine_issue_id)
);

CREATE INDEX IF NOT EXISTS idx_bug_links_redmine   ON bug_links(redmine_issue_id);
CREATE INDEX IF NOT EXISTS idx_bug_links_signature ON bug_links(defect_signature_id);

CREATE TRIGGER IF NOT EXISTS trg_bug_links_validate_scenario
BEFORE INSERT ON bug_links
FOR EACH ROW
WHEN NEW.created_from_run_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (
      SELECT ds.scenario_key
      FROM defect_signatures ds
      WHERE ds.id = NEW.defect_signature_id
    ) != (
      SELECT tr.scenario_key
      FROM test_runs tr
      WHERE tr.id = NEW.created_from_run_id
    )
    THEN RAISE(ABORT, 'bug link scenario mismatch')
  END;
END;

-- Phase 2 (postponed in MVP — keep review/proposal records as files + an `artifacts` row until
-- something needs to query across them; see design doc §2 and §9):
-- CREATE TABLE review_records ( ... );
-- CREATE TABLE proposal_records ( ... );
