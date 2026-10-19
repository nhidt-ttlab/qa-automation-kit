import { NotFoundError } from '@qakit/reporting-shared';
import * as path from 'path';
import { reportingDataDir } from '../../common/reporting-data-dir';

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  // UI evidence: Playwright records video as WebM, and a HAR is JSON by another name.
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.har': 'application/json',
};

export function resolveArtifactStorageRoot(): string {
  const value =
    process.env.REGRESSION_RUNNER_PATH || '../runner';
  return path.resolve(reportingDataDir(), value);
}

/**
 * The runner's SQLite reporting database. `REGRESSION_SQLITE_PATH` wins when set; otherwise it
 * sits at `<runner>/db/regression.db`.
 *
 * Lives beside resolveArtifactStorageRoot because the sync script had grown its own private copy
 * of that function under a different name, and the two must never disagree about which runner
 * checkout is in play.
 */
export function resolveRegressionSqlitePath(): string {
  const explicit = process.env.REGRESSION_SQLITE_PATH;
  if (explicit) return path.resolve(reportingDataDir(), explicit);
  return path.join(resolveArtifactStorageRoot(), 'db', 'regression.db');
}

export function resolveSafeArtifactPath(
  root: string,
  relativePath: string,
): string {
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    return resolved;
  }
  throw new NotFoundError('ArtifactFile', relativePath);
}

export function inferContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

export function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n]/g, '');
}
