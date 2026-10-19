-- CreateTable
CREATE TABLE "resolution_issues" (
    "id" SERIAL NOT NULL,
    "import_key" TEXT NOT NULL,
    "display_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "workflow_status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "source_summary" TEXT,
    "user_summary" TEXT,
    "owner" TEXT,
    "priority" TEXT,
    "decision" TEXT,
    "decision_by" TEXT,
    "decision_at" TIMESTAMP(3),
    "resolution" TEXT,
    "resolution_type" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "verification_note" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "verification_run_id" TEXT,
    "defect_signature_id" INTEGER,
    "module" TEXT,
    "domain" TEXT,
    "observation_count" INTEGER NOT NULL DEFAULT 0,
    "affected_test_case_count" INTEGER NOT NULL DEFAULT 0,
    "recurrence_count" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resolution_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_observations" (
    "id" SERIAL NOT NULL,
    "resolution_issue_id" INTEGER NOT NULL,
    "run_id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "scenario_key" TEXT NOT NULL,
    "check_sequence" INTEGER,
    "check_test_id" TEXT,
    "check_label" TEXT,
    "observation_key" TEXT NOT NULL,
    "observed_result" TEXT NOT NULL,
    "raw_reason" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_comments" (
    "id" SERIAL NOT NULL,
    "resolution_issue_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resolution_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_events" (
    "id" SERIAL NOT NULL,
    "resolution_issue_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "previous_status" TEXT,
    "new_status" TEXT,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_redmine_links" (
    "id" SERIAL NOT NULL,
    "resolution_issue_id" INTEGER NOT NULL,
    "redmine_issue_id" INTEGER NOT NULL,
    "redmine_project" TEXT,
    "redmine_url" TEXT,
    "link_type" TEXT NOT NULL DEFAULT 'manually_linked',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_redmine_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resolution_issues_import_key_key" ON "resolution_issues"("import_key");

-- CreateIndex
CREATE INDEX "resolution_issues_workflow_status_idx" ON "resolution_issues"("workflow_status");

-- CreateIndex
CREATE INDEX "resolution_issues_kind_idx" ON "resolution_issues"("kind");

-- CreateIndex
CREATE INDEX "resolution_issues_owner_idx" ON "resolution_issues"("owner");

-- CreateIndex
CREATE INDEX "resolution_issues_priority_idx" ON "resolution_issues"("priority");

-- CreateIndex
CREATE INDEX "resolution_issues_last_seen_at_idx" ON "resolution_issues"("last_seen_at");

-- CreateIndex
CREATE INDEX "resolution_issues_first_seen_at_idx" ON "resolution_issues"("first_seen_at");

-- CreateIndex
CREATE INDEX "resolution_issues_display_key_idx" ON "resolution_issues"("display_key");

-- CreateIndex
CREATE INDEX "resolution_issues_domain_idx" ON "resolution_issues"("domain");

-- CreateIndex
CREATE INDEX "resolution_issues_module_idx" ON "resolution_issues"("module");

-- CreateIndex
CREATE INDEX "resolution_issues_defect_signature_id_idx" ON "resolution_issues"("defect_signature_id");

-- CreateIndex
CREATE INDEX "resolution_observations_resolution_issue_id_idx" ON "resolution_observations"("resolution_issue_id");

-- CreateIndex
CREATE INDEX "resolution_observations_run_id_idx" ON "resolution_observations"("run_id");

-- CreateIndex
CREATE INDEX "resolution_observations_test_case_id_idx" ON "resolution_observations"("test_case_id");

-- CreateIndex
CREATE INDEX "resolution_observations_scenario_key_idx" ON "resolution_observations"("scenario_key");

-- CreateIndex
CREATE INDEX "resolution_observations_observed_result_idx" ON "resolution_observations"("observed_result");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_observations_resolution_issue_id_run_id_observat_key" ON "resolution_observations"("resolution_issue_id", "run_id", "observation_key");

-- CreateIndex
CREATE INDEX "resolution_comments_resolution_issue_id_created_at_idx" ON "resolution_comments"("resolution_issue_id", "created_at");

-- CreateIndex
CREATE INDEX "resolution_events_resolution_issue_id_created_at_idx" ON "resolution_events"("resolution_issue_id", "created_at");

-- CreateIndex
CREATE INDEX "resolution_events_action_idx" ON "resolution_events"("action");

-- CreateIndex
CREATE INDEX "resolution_redmine_links_redmine_issue_id_idx" ON "resolution_redmine_links"("redmine_issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_redmine_links_resolution_issue_id_redmine_issue__key" ON "resolution_redmine_links"("resolution_issue_id", "redmine_issue_id");

-- AddForeignKey
ALTER TABLE "resolution_issues" ADD CONSTRAINT "resolution_issues_defect_signature_id_fkey" FOREIGN KEY ("defect_signature_id") REFERENCES "defect_signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_issues" ADD CONSTRAINT "resolution_issues_verification_run_id_fkey" FOREIGN KEY ("verification_run_id") REFERENCES "test_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_observations" ADD CONSTRAINT "resolution_observations_resolution_issue_id_fkey" FOREIGN KEY ("resolution_issue_id") REFERENCES "resolution_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_observations" ADD CONSTRAINT "resolution_observations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_observations" ADD CONSTRAINT "resolution_observations_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "test_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_comments" ADD CONSTRAINT "resolution_comments_resolution_issue_id_fkey" FOREIGN KEY ("resolution_issue_id") REFERENCES "resolution_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_events" ADD CONSTRAINT "resolution_events_resolution_issue_id_fkey" FOREIGN KEY ("resolution_issue_id") REFERENCES "resolution_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_redmine_links" ADD CONSTRAINT "resolution_redmine_links_resolution_issue_id_fkey" FOREIGN KEY ("resolution_issue_id") REFERENCES "resolution_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
