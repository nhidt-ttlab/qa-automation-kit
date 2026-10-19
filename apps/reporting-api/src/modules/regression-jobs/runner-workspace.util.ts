/**
 * Plans the API's own "clean everything" wipe of the runner's workspace.
 *
 * Why this exists rather than passing the runner's `--clean-all`:
 *
 *   1. That flag ignores the scenario selection entirely and empties `reports/`, `outputs/` and
 *      `evidence/` wholesale — including `evidence/mcp-sessions/` (MCP agent audit logs, which no
 *      rerun regenerates), `reports/_batches/` (the summaries historical job rows link to) and
 *      loose files like `outputs/vtpq-final.tsv`.
 *   2. It deletes those three trees and only *then* unlinks the database, so on Windows — where
 *      the review server on port 4173 holds `regression.db` open — the unlink throws EBUSY with
 *      the artifacts already gone. The runner's own comment calls this "the recoverable half".
 *
 * Doing it here fixes both: the preserved paths are never deleted at all, and the order is
 * reversed so the database goes first. If it is locked, nothing has been deleted yet and the job
 * aborts cleanly.
 *
 * This module is pure. It takes a directory listing per root and returns a plan; the caller does
 * the I/O, which is what makes the preservation rules testable without a filesystem.
 */

/** The three generated trees, mirroring ROOTS in the runner's clean-artifacts.ts. */
export const RUNNER_WIPE_ROOTS = ['reports', 'outputs', 'evidence'] as const;

/**
 * Directory names never deleted, whatever the runner's own `--clean-all` would do to them.
 *
 *   mcp-sessions  MCP agent audit logs (`<runId>/audit.jsonl`). Not an artifact: no rerun
 *                 reproduces them, so deleting them destroys the only copy.
 *   _batches      batch summaries, which historical regression_jobs rows reference by
 *                 summary_path. Wiping them would break every link in the job history.
 *   _sessions     session teardown records — the same reasoning that makes `.sessions/`
 *                 untouchable applies to the record of what a session reclaimed.
 */
export const RUNNER_WIPE_PRESERVE_DIRS: ReadonlySet<string> = new Set([
  'mcp-sessions',
  '_batches',
  '_sessions',
]);

/** The runner database when REGRESSION_SQLITE_PATH does not name another one. */
export const RUNNER_DB_FILE_DEFAULT = 'db/regression.db';

/** A SQLite file and its journal siblings, deleted first and as a group. */
export function runnerDbFiles(dbFile: string = RUNNER_DB_FILE_DEFAULT): string[] {
  return ['', '-wal', '-shm', '-journal'].map((suffix) => `${dbFile}${suffix}`);
}

/**
 * The default database and its journal siblings. Matches the set the runner's own deleteDbFile()
 * handles.
 */
export const RUNNER_DB_FILES: readonly string[] = runnerDbFiles();

export interface RunnerDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface WipePlan {
  /** Runner-relative directories to remove, e.g. `evidence/don-hang`. */
  deletes: string[];
  /** Runner-relative paths deliberately kept, recorded in the job log so the user can see them. */
  preserved: string[];
  /** Runner-relative database files, deleted BEFORE anything in `deletes`. */
  dbFiles: string[];
}

/**
 * Pure planner. `entriesByRoot` maps each root in RUNNER_WIPE_ROOTS to its direct children;
 * a root that does not exist may be omitted or mapped to an empty array. `dbFile` is the
 * runner-relative database the sync reads (REGRESSION_SQLITE_PATH), so the wipe removes the same
 * file rather than a name it assumes.
 */
export function planRunnerWipe(
  entriesByRoot: Readonly<Record<string, readonly RunnerDirEntry[]>>,
  dbFile: string = RUNNER_DB_FILE_DEFAULT,
): WipePlan {
  const deletes: string[] = [];
  const preserved: string[] = [];

  for (const root of RUNNER_WIPE_ROOTS) {
    for (const entry of entriesByRoot[root] ?? []) {
      const rel = `${root}/${entry.name}`;

      // Loose FILES at the root of a tree are preserved as a RULE, not by name. That covers
      // outputs/vtpq-*.tsv, .gitkeep, and whatever ad hoc file lands there next — expressed as a
      // property so a new one survives without anyone having to remember to add it to a list.
      // Only directories are wipe candidates.
      if (!entry.isDirectory) {
        preserved.push(rel);
        continue;
      }

      if (RUNNER_WIPE_PRESERVE_DIRS.has(entry.name)) {
        preserved.push(rel);
        continue;
      }

      deletes.push(rel);
    }
  }

  return { deletes, preserved, dbFiles: runnerDbFiles(dbFile) };
}

/**
 * Human-readable one-liner for the confirmation dialog and the job log. Deliberately states what
 * survives as well as what goes: "clean everything" that silently keeps three directories would
 * be worse than either alternative if the user never learns which.
 */
export function describeWipePlan(plan: WipePlan): string {
  return (
    `deleting ${plan.dbFiles.length} database file(s) and ${plan.deletes.length} ` +
    `director${plan.deletes.length === 1 ? 'y' : 'ies'}; ` +
    `preserving ${plan.preserved.length} path(s)`
  );
}
