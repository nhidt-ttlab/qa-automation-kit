import * as fs from 'fs';
import * as path from 'path';

/**
 * The architecture boundary, asserted rather than trusted.
 *
 *   runner -> SQLite -> one-way db:sync -> reporting Postgres -> Resolution Queue UI
 *
 * Comments, decisions, assignments and resolutions live only in Postgres. Nothing in the
 * Resolution Queue may acquire a way to write back into the runner's database — not because it
 * would fail, but because it would succeed quietly and make the runner's evidence no longer
 * immutable. A code review can miss a new import; this cannot.
 */

const MODULE_DIR = __dirname;
const SYNC_SCRIPT = path.resolve(
  __dirname,
  '../sync/sqlite-sync.ts',
);
const BACKFILL_SCRIPT = path.resolve(
  __dirname,
  '../../../scripts/backfill-resolution-issues.ts',
);

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => path.join(dir, f));
}

describe('Resolution Queue never reaches the runner database', () => {
  const files = sourceFiles(MODULE_DIR);

  it('has source files to check', () => {
    // Guards against the glob silently matching nothing and the suite passing vacuously.
    expect(files.length).toBeGreaterThan(3);
  });

  it.each([
    [
      'better-sqlite3',
      /from\s+['"]better-sqlite3['"]|require\(\s*['"]better-sqlite3['"]/,
    ],
    [
      'node:sqlite',
      /from\s+['"]node:sqlite['"]|require\(\s*['"]node:sqlite['"]/,
    ],
  ])('imports no %s driver anywhere in the module', (_name, pattern) => {
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(pattern);
    }
  });

  it('reads no file from the regression runner package', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/REGRESSION_RUNNER_PATH/);
      expect(source).not.toMatch(/regression\.db/);
    }
  });

  it('opens the runner database read-only in the one script that touches it', () => {
    const sync = fs.readFileSync(SYNC_SCRIPT, 'utf8');
    expect(sync).toMatch(/new Database\(sqlitePath,\s*\{\s*readonly:\s*true/);
    // A write would need one of these; better-sqlite3 offers no other write path.
    expect(sync).not.toMatch(/sqlite\.(exec|run)\(/);
    expect(sync).not.toMatch(
      /\bINSERT INTO\b|\bUPDATE\b\s+\w+\s+SET|\bDELETE FROM\b/i,
    );
  });

  it('keeps the backfill on Postgres only', () => {
    const backfill = fs.readFileSync(BACKFILL_SCRIPT, 'utf8');
    expect(backfill).not.toMatch(/better-sqlite3|node:sqlite|regression\.db/);
    // It must also not read the checklist Markdown as a source of truth.
    expect(backfill).not.toMatch(/CHECKLIST\.md|\.md['"]/);
  });
});

describe('imported evidence stays immutable', () => {
  const files = sourceFiles(MODULE_DIR);

  it.each([
    'testRun.update',
    'testRun.delete',
    'testRunCheck.update',
    'testRunCheck.delete',
    'testRunStep.update',
    'testRunEvidence.update',
  ])('never calls %s', (call) => {
    const [model, method] = call.split('.');
    const pattern = new RegExp(`\\.${model}\\.${method}\\b`);
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(pattern);
    }
  });
});
