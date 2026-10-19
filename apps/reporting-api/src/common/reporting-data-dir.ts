import * as path from 'path';

/**
 * Where this API keeps per-deployment state: its `.env`, and the base for every relative path in
 * it (`REGRESSION_RUNNER_PATH`, `REGRESSION_SQLITE_PATH`, `EVIDENCE_STORAGE_PATH`,
 * `JOB_LOG_STORAGE_PATH`).
 *
 * `REPORTING_DATA_DIR` lets a project run this app from the kit while keeping that state in its own
 * folder. Without it the process cwd is used, which is what a standalone checkout expects.
 */
export function reportingDataDir(): string {
  const dir = process.env.REPORTING_DATA_DIR;
  return dir ? path.resolve(dir) : process.cwd();
}
