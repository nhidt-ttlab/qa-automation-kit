-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL,
    "scenario_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT,
    "impacted_area" TEXT,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version_label" TEXT,
    "tags" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "scenario_key" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "executed_by" TEXT,
    "git_commit" TEXT,
    "git_branch" TEXT,
    "business_scenario" TEXT,
    "severity" TEXT,
    "reproducibility" TEXT,
    "defect_statement" TEXT,
    "blocked_reason" TEXT,
    "error_summary" TEXT,
    "conclusion" TEXT,
    "overview_key_data" JSONB,
    "overview_highlights" JSONB,
    "payloads" JSONB,
    "tags" JSONB,
    "custom_data" JSONB,
    "report_model" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_run_checks" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "test_id" TEXT,
    "label" TEXT NOT NULL,
    "expected" JSONB,
    "actual" JSONB,
    "passed" BOOLEAN NOT NULL,

    CONSTRAINT "test_run_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_run_steps" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "http_status" INTEGER,
    "details" JSONB,

    CONSTRAINT "test_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_run_evidence" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "purpose" TEXT,
    "key_input" TEXT,
    "http_status" INTEGER,
    "result_classification" TEXT,
    "collapsed_count" INTEGER NOT NULL DEFAULT 1,
    "is_key_evidence" BOOLEAN NOT NULL DEFAULT false,
    "artifact_id" INTEGER,

    CONSTRAINT "test_run_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_run_related_entities" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_label" TEXT,

    CONSTRAINT "test_run_related_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storage_type" TEXT NOT NULL DEFAULT 'file',
    "path" TEXT,
    "blob" BYTEA,
    "external_url" TEXT,
    "content_hash" TEXT,
    "size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_signatures" (
    "id" SERIAL NOT NULL,
    "signature_hash" TEXT NOT NULL,
    "scenario_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT,
    "probable_failing_rule" TEXT,
    "suspected_component" TEXT,
    "regression_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "first_observed_run_id" TEXT,
    "last_observed_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "defect_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_observations" (
    "id" SERIAL NOT NULL,
    "defect_signature_id" INTEGER NOT NULL,
    "run_id" TEXT NOT NULL,
    "defect_statement" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "defect_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bug_links" (
    "id" SERIAL NOT NULL,
    "defect_signature_id" INTEGER NOT NULL,
    "created_from_run_id" TEXT,
    "redmine_issue_id" INTEGER NOT NULL,
    "redmine_project" TEXT,
    "redmine_url" TEXT,
    "link_type" TEXT NOT NULL DEFAULT 'created_from_run',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_scenario_key_key" ON "test_cases"("scenario_key");

-- CreateIndex
CREATE INDEX "test_cases_status_idx" ON "test_cases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_id_scenario_key_key" ON "test_cases"("id", "scenario_key");

-- CreateIndex
CREATE INDEX "test_runs_test_case_id_started_at_idx" ON "test_runs"("test_case_id", "started_at");

-- CreateIndex
CREATE INDEX "test_runs_result_idx" ON "test_runs"("result");

-- CreateIndex
CREATE INDEX "test_runs_environment_idx" ON "test_runs"("environment");

-- CreateIndex
CREATE INDEX "test_runs_started_at_idx" ON "test_runs"("started_at");

-- CreateIndex
CREATE INDEX "test_run_checks_run_id_idx" ON "test_run_checks"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_run_checks_run_id_seq_key" ON "test_run_checks"("run_id", "seq");

-- CreateIndex
CREATE INDEX "test_run_steps_run_id_idx" ON "test_run_steps"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_run_steps_run_id_seq_key" ON "test_run_steps"("run_id", "seq");

-- CreateIndex
CREATE INDEX "test_run_evidence_run_id_idx" ON "test_run_evidence"("run_id");

-- CreateIndex
CREATE INDEX "test_run_evidence_run_id_is_key_evidence_idx" ON "test_run_evidence"("run_id", "is_key_evidence");

-- CreateIndex
CREATE UNIQUE INDEX "test_run_evidence_run_id_seq_key" ON "test_run_evidence"("run_id", "seq");

-- CreateIndex
CREATE INDEX "test_run_related_entities_entity_type_entity_id_idx" ON "test_run_related_entities"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_run_related_entities_run_id_entity_type_entity_id_key" ON "test_run_related_entities"("run_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "artifacts_run_id_kind_idx" ON "artifacts"("run_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_run_id_id_key" ON "artifacts"("run_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "defect_signatures_signature_hash_key" ON "defect_signatures"("signature_hash");

-- CreateIndex
CREATE INDEX "defect_signatures_status_idx" ON "defect_signatures"("status");

-- CreateIndex
CREATE UNIQUE INDEX "defect_signatures_id_scenario_key_key" ON "defect_signatures"("id", "scenario_key");

-- CreateIndex
CREATE INDEX "defect_observations_defect_signature_id_idx" ON "defect_observations"("defect_signature_id");

-- CreateIndex
CREATE INDEX "defect_observations_run_id_idx" ON "defect_observations"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "defect_observations_defect_signature_id_run_id_key" ON "defect_observations"("defect_signature_id", "run_id");

-- CreateIndex
CREATE INDEX "bug_links_redmine_issue_id_idx" ON "bug_links"("redmine_issue_id");

-- CreateIndex
CREATE INDEX "bug_links_defect_signature_id_idx" ON "bug_links"("defect_signature_id");

-- CreateIndex
CREATE UNIQUE INDEX "bug_links_defect_signature_id_redmine_issue_id_key" ON "bug_links"("defect_signature_id", "redmine_issue_id");

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_test_case_id_scenario_key_fkey" FOREIGN KEY ("test_case_id", "scenario_key") REFERENCES "test_cases"("id", "scenario_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run_checks" ADD CONSTRAINT "test_run_checks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run_steps" ADD CONSTRAINT "test_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run_evidence" ADD CONSTRAINT "test_run_evidence_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run_evidence" ADD CONSTRAINT "test_run_evidence_run_id_artifact_id_fkey" FOREIGN KEY ("run_id", "artifact_id") REFERENCES "artifacts"("run_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run_related_entities" ADD CONSTRAINT "test_run_related_entities_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_signatures" ADD CONSTRAINT "defect_signatures_scenario_key_fkey" FOREIGN KEY ("scenario_key") REFERENCES "test_cases"("scenario_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_signatures" ADD CONSTRAINT "defect_signatures_first_observed_run_id_fkey" FOREIGN KEY ("first_observed_run_id") REFERENCES "test_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_signatures" ADD CONSTRAINT "defect_signatures_last_observed_run_id_fkey" FOREIGN KEY ("last_observed_run_id") REFERENCES "test_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_observations" ADD CONSTRAINT "defect_observations_defect_signature_id_fkey" FOREIGN KEY ("defect_signature_id") REFERENCES "defect_signatures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_observations" ADD CONSTRAINT "defect_observations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_links" ADD CONSTRAINT "bug_links_defect_signature_id_fkey" FOREIGN KEY ("defect_signature_id") REFERENCES "defect_signatures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_links" ADD CONSTRAINT "bug_links_created_from_run_id_fkey" FOREIGN KEY ("created_from_run_id") REFERENCES "test_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
