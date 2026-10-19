-- Ports the parts of tests/starlive-api-regression/docs/db/schema.sql that Prisma's schema
-- language cannot express: the enum-as-CHECK constraints, the artifacts storage-state CHECK,
-- and the three triggers that carry real behaviour.
--
-- Deliberately NOT ported:
--   * the 11 `json_valid(...)` CHECKs   -- jsonb validates natively
--   * the `IN (0,1)` boolean CHECKs     -- boolean is a real type here
--   * trg_test_cases_updated_at / trg_defect_signatures_updated_at
--     -- Prisma's `@updatedAt` owns updated_at now that the regression runner
--        writes only to its own SQLite file, never to this database.

-- ---------------------------------------------------------------------------
-- Enum-as-CHECK constraints (schema.sql lines 18, 57, 153, 170, 171, 200, 288)
-- ---------------------------------------------------------------------------

ALTER TABLE "test_cases"
  ADD CONSTRAINT "test_cases_status_check"
  CHECK ("status" IN ('active', 'deprecated', 'draft'));

ALTER TABLE "test_runs"
  ADD CONSTRAINT "test_runs_result_check"
  CHECK ("result" IN ('PASS', 'PARTIAL', 'FAIL', 'BLOCKED', 'ERROR'));

ALTER TABLE "test_run_related_entities"
  ADD CONSTRAINT "test_run_related_entities_entity_type_check"
  CHECK ("entity_type" IN (
    'project', 'purchase_order', 'supply_contract', 'item', 'tower',
    'location', 'workflow', 'supplier', 'phase', 'work_package'
  ));

ALTER TABLE "artifacts"
  ADD CONSTRAINT "artifacts_kind_check"
  CHECK ("kind" IN (
    'markdown_report', 'json_run_artifact', 'raw_trace',
    'review_record', 'proposal_record', 'other'
  ));

ALTER TABLE "artifacts"
  ADD CONSTRAINT "artifacts_storage_type_check"
  CHECK ("storage_type" IN ('file', 'blob', 'external_url'));

ALTER TABLE "defect_signatures"
  ADD CONSTRAINT "defect_signatures_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'duplicate', 'resolved', 'wontfix'));

ALTER TABLE "bug_links"
  ADD CONSTRAINT "bug_links_link_type_check"
  CHECK ("link_type" IN ('created_from_run', 'manually_linked', 'duplicate_of'));

-- ---------------------------------------------------------------------------
-- Artifact storage-state exclusivity (schema.sql lines 178-182)
--
-- storage_type determines which single one of path/blob/external_url is populated.
-- Load-bearing: reviews.service.ts writes storage_type='blob' rows and runs.service.ts
-- reads them back, while the regression runner only ever writes storage_type='file'.
-- ---------------------------------------------------------------------------

ALTER TABLE "artifacts"
  ADD CONSTRAINT "artifacts_storage_state_check"
  CHECK (
    ("storage_type" = 'file'         AND "path" IS NOT NULL AND "blob" IS NULL AND "external_url" IS NULL) OR
    ("storage_type" = 'blob'         AND "blob" IS NOT NULL AND "path" IS NULL AND "external_url" IS NULL) OR
    ("storage_type" = 'external_url' AND "external_url" IS NOT NULL AND "path" IS NULL AND "blob" IS NULL)
  );

-- ---------------------------------------------------------------------------
-- trg_defect_observations_validate_scenario (schema.sql lines 232-248)
--
-- An observation may only attach a signature to a run from the same scenario.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "fn_defect_observations_validate_scenario"()
RETURNS trigger AS $$
DECLARE
  signature_scenario TEXT;
  run_scenario       TEXT;
BEGIN
  SELECT ds."scenario_key" INTO signature_scenario
    FROM "defect_signatures" ds WHERE ds."id" = NEW."defect_signature_id";
  SELECT tr."scenario_key" INTO run_scenario
    FROM "test_runs" tr WHERE tr."id" = NEW."run_id";

  -- Mirrors SQLite's `!=` semantics: a NULL on either side (row not found) is not a mismatch,
  -- which is what the FK constraints are for.
  IF signature_scenario IS DISTINCT FROM run_scenario
     AND signature_scenario IS NOT NULL
     AND run_scenario IS NOT NULL THEN
    RAISE EXCEPTION 'defect observation scenario mismatch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_defect_observations_validate_scenario"
BEFORE INSERT ON "defect_observations"
FOR EACH ROW
EXECUTE FUNCTION "fn_defect_observations_validate_scenario"();

-- ---------------------------------------------------------------------------
-- trg_defect_observations_touch_signature (schema.sql lines 252-277)
--
-- Keeps defect_signatures.first_observed_run_id / last_observed_run_id current using the
-- run's started_at chronology, not insert order, so a backfilled older run cannot corrupt
-- the history. defects.service.ts#createFromRun never sets these columns itself, and the API
-- surfaces them as first_seen_at / last_seen_at -- without this trigger they stay NULL and
-- silently fall back to created_at.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "fn_defect_observations_touch_signature"()
RETURNS trigger AS $$
BEGIN
  UPDATE "defect_signatures"
  SET "first_observed_run_id" = CASE
        WHEN "first_observed_run_id" IS NULL THEN NEW."run_id"
        WHEN (SELECT "started_at" FROM "test_runs" WHERE "id" = NEW."run_id")
           < (SELECT "started_at" FROM "test_runs" WHERE "id" = "first_observed_run_id")
          THEN NEW."run_id"
        ELSE "first_observed_run_id"
      END,
      "last_observed_run_id" = CASE
        WHEN "last_observed_run_id" IS NULL THEN NEW."run_id"
        WHEN (SELECT "started_at" FROM "test_runs" WHERE "id" = NEW."run_id")
           > (SELECT "started_at" FROM "test_runs" WHERE "id" = "last_observed_run_id")
          THEN NEW."run_id"
        ELSE "last_observed_run_id"
      END,
      "updated_at" = now()
  WHERE "id" = NEW."defect_signature_id";

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_defect_observations_touch_signature"
AFTER INSERT ON "defect_observations"
FOR EACH ROW
EXECUTE FUNCTION "fn_defect_observations_touch_signature"();

-- ---------------------------------------------------------------------------
-- trg_bug_links_validate_scenario (schema.sql lines 297-314)
--
-- Same scenario guard for the run a Redmine link was created from.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "fn_bug_links_validate_scenario"()
RETURNS trigger AS $$
DECLARE
  signature_scenario TEXT;
  run_scenario       TEXT;
BEGIN
  IF NEW."created_from_run_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ds."scenario_key" INTO signature_scenario
    FROM "defect_signatures" ds WHERE ds."id" = NEW."defect_signature_id";
  SELECT tr."scenario_key" INTO run_scenario
    FROM "test_runs" tr WHERE tr."id" = NEW."created_from_run_id";

  IF signature_scenario IS DISTINCT FROM run_scenario
     AND signature_scenario IS NOT NULL
     AND run_scenario IS NOT NULL THEN
    RAISE EXCEPTION 'bug link scenario mismatch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_bug_links_validate_scenario"
BEFORE INSERT ON "bug_links"
FOR EACH ROW
EXECUTE FUNCTION "fn_bug_links_validate_scenario"();
