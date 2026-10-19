import * as path from 'path';
import { reportingDataDir } from '../../common/reporting-data-dir';

/**
 * Root of the API-owned copy of the regression runner's UI evidence tree.
 *
 * The runner writes screenshots, video, trace, HAR and console dumps under its own
 * `evidence/<scenario>/<runId>/`, but that folder only exists on a machine with the runner
 * checked out. `pnpm db:sync` copies the tree here so the API can serve it standalone, and
 * so pruning the runner's workspace does not blank out historical reports.
 *
 * Mirrors resolveArtifactStorageRoot in artifact-storage.util.ts, which still points at the
 * runner for the Markdown/JSON run artifacts.
 */
export function resolveEvidenceStorageRoot(): string {
  const value = process.env.EVIDENCE_STORAGE_PATH || './storage/evidence';
  return path.resolve(reportingDataDir(), value);
}

/**
 * Where a run's evidence lands, mirroring the runner's own `<scenario>/<runId>/` layout so a
 * manifest relPath and a stored path stay trivially comparable by eye.
 */
export function runEvidenceDir(
  root: string,
  scenario: string,
  runId: string,
): string {
  return path.join(root, scenario, runId);
}
