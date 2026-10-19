import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/**
 * SQLite persistence for run reports, on the built-in `node:sqlite` (Node >= 22.5, no native build).
 *
 * `packages/core/sql/schema.sql` is the source of truth this module applies. The path resolves the
 * same from `src/store/` (tests) and `dist/store/` (published build).
 */
export const RUN_STORE_SCHEMA_PATH = fileURLToPath(new URL('../../sql/schema.sql', import.meta.url));

export function readRunStoreSchema(): string {
  return fs.readFileSync(RUN_STORE_SCHEMA_PATH, 'utf8');
}

/**
 * `CREATE TABLE IF NOT EXISTS` never rewrites an existing table's column constraints, so a
 * `test_runs` table created before `'PARTIAL'` joined the `result` CHECK would reject it forever.
 * Detects that stale constraint and rebuilds the table in place ("rename → recreate → copy → drop").
 * If a second constraint change comes along, promote this to a versioned migration runner.
 */
function migratePartialVerdictSupport(db: DatabaseSync, schemaSql: string): void {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'test_runs'").get() as
    | { sql: string }
    | undefined;
  if (!existing || existing.sql.includes("'PARTIAL'")) return; // no table yet, or already migrated

  const oldIndexNames = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'test_runs' AND sql IS NOT NULL").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);

  db.exec('PRAGMA foreign_keys = OFF;');
  // Without this, SQLite rewrites other tables' FKs that target `test_runs` to point at the renamed
  // table, leaving them dangling once it is dropped.
  db.exec('PRAGMA legacy_alter_table = ON;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec('ALTER TABLE test_runs RENAME TO test_runs_pre_partial_migration;');
    // Drop the renamed table's indexes explicitly, or `CREATE INDEX IF NOT EXISTS` would skip them.
    for (const name of oldIndexNames) db.exec(`DROP INDEX IF EXISTS "${name}";`);
    db.exec(schemaSql);
    db.exec('INSERT INTO test_runs SELECT * FROM test_runs_pre_partial_migration;');
    db.exec('DROP TABLE test_runs_pre_partial_migration;');
    const fkErrors = db.prepare('PRAGMA foreign_key_check;').all();
    if (fkErrors.length) {
      throw new Error(`test_runs PARTIAL-verdict migration failed foreign_key_check: ${JSON.stringify(fkErrors)}`);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF;');
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Columns added to `schema.sql` after databases already existed. `CREATE TABLE IF NOT EXISTS`
 * skips the table wholesale, so a new column never reaches an existing file and every INSERT naming
 * it would throw. Adding a NULLable column is the one change SQLite supports in place.
 * Keep an entry for the lifetime of the column.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: 'test_cases', column: 'module', definition: 'TEXT' },
  { table: 'test_cases', column: 'domain', definition: 'TEXT' },
  { table: 'test_cases', column: 'feature_id', definition: 'TEXT' },
  { table: 'test_runs', column: 'module', definition: 'TEXT' },
  { table: 'test_runs', column: 'domain', definition: 'TEXT' },
  { table: 'test_run_checks', column: 'csv_checklist_id', definition: 'TEXT' },
  { table: 'test_run_checks', column: 'csv_testcase_id', definition: 'TEXT' },
  { table: 'test_run_checks', column: 'csv_expected', definition: 'TEXT' },
  { table: 'test_run_checks', column: 'csv_business_rule', definition: 'TEXT' },
  { table: 'test_run_checks', column: 'csv_priority', definition: 'TEXT' },
];

function backfillAddedColumns(db: DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!tableExists) continue; // fresh file: the schema creates it with the column already
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

/** Upgrades an existing database in place, then applies the (idempotent) schema. */
export function applyRunStoreSchema(db: DatabaseSync, schemaSql: string = readRunStoreSchema()): void {
  migratePartialVerdictSupport(db, schemaSql);
  backfillAddedColumns(db);
  // Every statement is `CREATE ... IF NOT EXISTS` or a PRAGMA, so re-applying on every open is safe.
  db.exec(schemaSql);
}

/** Opens (creating the file and schema if needed) a run-store database. */
export function openRunStore(filePath: string, schemaSql?: string): DatabaseSync {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  applyRunStoreSchema(db, schemaSql);
  return db;
}

const gitInfoCache = new Map<string, { commit?: string; branch?: string }>();

/** Best-effort git commit/branch for run traceability. Never throws; fields are undefined without git. */
export function resolveGitInfo(cwd: string): { commit?: string; branch?: string } {
  const cached = gitInfoCache.get(cwd);
  if (cached) return cached;
  const run = (args: string[]): string | undefined => {
    try {
      const out = execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString('utf8').trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  };
  const info = { commit: run(['rev-parse', 'HEAD']), branch: run(['rev-parse', '--abbrev-ref', 'HEAD']) };
  gitInfoCache.set(cwd, info);
  return info;
}

export interface PurgeSummary {
  /** Rows removed from `test_runs` — their children went with them, by cascade. */
  runsDeleted: number;
  /** Defect signatures dropped because the purge left them with no observation and no bug link. */
  signaturesDeleted: number;
}

/** SQLite caps host parameters per statement; 400 keeps every `IN (...)` list well inside it. */
const CHUNK = 400;

function chunked<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/**
 * Deletes every persisted run of `scenarios`, and the defect rows left dangling by that, in one
 * transaction. Run children cascade; the defect tables are plain references, so they are detached
 * first in FK order. `test_cases` rows survive on purpose — they are the catalog.
 */
export function purgeRunsInStore(db: DatabaseSync, scenarios: readonly string[]): PurgeSummary {
  if (scenarios.length === 0) return { runsDeleted: 0, signaturesDeleted: 0 };
  db.exec('BEGIN IMMEDIATE;');
  try {
    const runIds: string[] = [];
    for (const batch of chunked(scenarios)) {
      const rows = db.prepare(`SELECT id FROM test_runs WHERE scenario_key IN (${placeholders(batch.length)})`).all(...batch) as Array<{
        id: string;
      }>;
      for (const row of rows) runIds.push(row.id);
    }

    let runsDeleted = 0;
    let signaturesDeleted = 0;
    if (runIds.length > 0) {
      for (const batch of chunked(runIds)) {
        const list = placeholders(batch.length);
        db.prepare(`DELETE FROM defect_observations WHERE run_id IN (${list})`).run(...batch);
        db.prepare(`UPDATE defect_signatures SET first_observed_run_id = NULL WHERE first_observed_run_id IN (${list})`).run(...batch);
        db.prepare(`UPDATE defect_signatures SET last_observed_run_id = NULL WHERE last_observed_run_id IN (${list})`).run(...batch);
        db.prepare(`UPDATE bug_links SET created_from_run_id = NULL WHERE created_from_run_id IN (${list})`).run(...batch);
        runsDeleted += Number(db.prepare(`DELETE FROM test_runs WHERE id IN (${list})`).run(...batch).changes);
      }

      // A signature is the master bug: it only goes when nothing points at it any more.
      for (const batch of chunked(scenarios)) {
        const info = db
          .prepare(
            `DELETE FROM defect_signatures
              WHERE scenario_key IN (${placeholders(batch.length)})
                AND id NOT IN (SELECT defect_signature_id FROM defect_observations)
                AND id NOT IN (SELECT defect_signature_id FROM bug_links)`,
          )
          .run(...batch);
        signaturesDeleted += Number(info.changes);
      }
    }

    db.exec('COMMIT;');
    return { runsDeleted, signaturesDeleted };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Removes a database file and its WAL/SHM/journal sidecars. Close any connection to it first.
 * Returns the paths that actually existed.
 */
export function deleteSqliteFiles(basePath: string): string[] {
  const removed: string[] = [];
  for (const file of [basePath, `${basePath}-wal`, `${basePath}-shm`, `${basePath}-journal`]) {
    if (!fs.existsSync(file)) continue;
    try {
      fs.rmSync(file, { force: true });
    } catch (err) {
      // Windows refuses to unlink a file another process still has open.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM') {
        throw new Error(`Cannot delete ${file} — another process has it open (a running review server?). Stop it and retry.`);
      }
      throw err;
    }
    removed.push(file);
  }
  return removed;
}
