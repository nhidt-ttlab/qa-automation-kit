-- ERP Feature List id ("QLDN-VT-04" = Cài đặt sinh mã), copied verbatim from the runner's
-- test_cases.feature_id. It numbers a SCREEN in the business spec rather than a testcase, so it is
-- what reconciles a run against the Feature List workbook. Nullable: only scenarios that declare
-- `const FEATURE_ID` carry one, which is a small minority today.
ALTER TABLE "test_cases" ADD COLUMN "feature_id" TEXT;

CREATE INDEX "test_cases_feature_id_idx" ON "test_cases"("feature_id");
