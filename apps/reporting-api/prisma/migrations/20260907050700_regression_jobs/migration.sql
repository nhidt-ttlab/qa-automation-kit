-- CreateTable
CREATE TABLE "regression_jobs" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "active_slot" BOOLEAN,
    "requested_by" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'qa',
    "clean_scope" TEXT,
    "data_mode" TEXT NOT NULL DEFAULT 'existing',
    "write_mode" BOOLEAN NOT NULL DEFAULT false,
    "bail" BOOLEAN NOT NULL DEFAULT false,
    "cleanup" BOOLEAN,
    "headed" BOOLEAN NOT NULL DEFAULT false,
    "ui_slowmo_ms" INTEGER,
    "grep" TEXT,
    "modules" JSONB,
    "test_case_ids" JSONB,
    "argv" JSONB NOT NULL,
    "env_patch" JSONB NOT NULL,
    "runner_root" TEXT NOT NULL,
    "pid" INTEGER,
    "exit_code" INTEGER,
    "signal" TEXT,
    "cancel_requested_at" TIMESTAMP(3),
    "cancel_requested_by" TEXT,
    "log_path" TEXT NOT NULL,
    "log_line_count" INTEGER NOT NULL DEFAULT 0,
    "selected_count" INTEGER,
    "pass_count" INTEGER,
    "blocked_count" INTEGER,
    "fail_count" INTEGER,
    "summary_path" TEXT,
    "error_summary" TEXT,
    "sync_status" TEXT,
    "synced_run_count" INTEGER,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regression_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regression_jobs_active_slot_key" ON "regression_jobs"("active_slot");

-- CreateIndex
CREATE INDEX "regression_jobs_status_idx" ON "regression_jobs"("status");

-- CreateIndex
CREATE INDEX "regression_jobs_queued_at_idx" ON "regression_jobs"("queued_at");

-- CreateIndex
CREATE INDEX "regression_jobs_requested_by_idx" ON "regression_jobs"("requested_by");
