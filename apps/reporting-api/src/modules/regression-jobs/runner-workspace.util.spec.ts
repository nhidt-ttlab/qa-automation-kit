/**
 * The wipe planner is what makes "clean everything" survivable. These tests pin the three
 * properties the runner's own --clean-all does not have:
 *
 *   - non-regenerable directories are never deleted,
 *   - loose files at a tree root are preserved as a rule rather than by name,
 *   - the database files are planned first, so a lock aborts before anything is gone.
 */
import {
  describeWipePlan,
  planRunnerWipe,
  RUNNER_DB_FILES,
  RUNNER_WIPE_PRESERVE_DIRS,
  type RunnerDirEntry,
} from './runner-workspace.util';

const dir = (name: string): RunnerDirEntry => ({ name, isDirectory: true });
const file = (name: string): RunnerDirEntry => ({ name, isDirectory: false });

describe('planRunnerWipe', () => {
  it('deletes domain directories under each tree', () => {
    const plan = planRunnerWipe({
      reports: [dir('don-hang'), dir('kho')],
      outputs: [dir('don-hang')],
      evidence: [dir('kho')],
    });
    expect(plan.deletes).toEqual([
      'reports/don-hang',
      'reports/kho',
      'outputs/don-hang',
      'evidence/kho',
    ]);
  });

  it('never deletes the non-regenerable directories', () => {
    // mcp-sessions holds MCP agent audit logs that no rerun reproduces; _batches holds the
    // summaries historical job rows link to by summary_path.
    const plan = planRunnerWipe({
      reports: [dir('_batches'), dir('_sessions'), dir('don-hang')],
      evidence: [dir('mcp-sessions'), dir('kho')],
    });
    expect(plan.deletes).toEqual(['reports/don-hang', 'evidence/kho']);
    expect(plan.preserved).toEqual(
      expect.arrayContaining([
        'reports/_batches',
        'reports/_sessions',
        'evidence/mcp-sessions',
      ]),
    );
  });

  it('preserves every loose file at a tree root, by rule and not by name', () => {
    // vtpq-final.tsv and its siblings live at outputs/ root today, but the point is that a file
    // nobody has heard of yet also survives without a code change.
    const plan = planRunnerWipe({
      outputs: [
        file('vtpq-final.tsv'),
        file('.gitkeep'),
        file('something-new-nobody-listed.csv'),
        dir('don-hang'),
      ],
    });
    expect(plan.deletes).toEqual(['outputs/don-hang']);
    expect(plan.preserved).toEqual([
      'outputs/vtpq-final.tsv',
      'outputs/.gitkeep',
      'outputs/something-new-nobody-listed.csv',
    ]);
  });

  it('plans all four database files, which the caller deletes before any directory', () => {
    const plan = planRunnerWipe({});
    expect(plan.dbFiles).toEqual([...RUNNER_DB_FILES]);
    expect(plan.dbFiles).toContain('db/regression.db');
    expect(plan.dbFiles).toContain('db/regression.db-wal');
  });

  it('plans the configured database, not an assumed name', () => {
    // A qakit project stores runs in db/runs.db. Wiping regression.db instead left runs.db behind,
    // pointing at evidence the same wipe had just deleted.
    expect(planRunnerWipe({}, 'db/runs.db').dbFiles).toEqual([
      'db/runs.db',
      'db/runs.db-wal',
      'db/runs.db-shm',
      'db/runs.db-journal',
    ]);
  });

  it('never plans .sessions, whose ledgers point at live rows on a shared tenant', () => {
    const plan = planRunnerWipe({
      reports: [dir('x')],
      outputs: [dir('x')],
      evidence: [dir('x')],
    });
    expect([...plan.deletes, ...plan.preserved].some((p) => p.startsWith('.sessions'))).toBe(
      false,
    );
  });

  it('treats a missing tree as empty rather than failing', () => {
    expect(planRunnerWipe({}).deletes).toEqual([]);
  });
});

describe('describeWipePlan', () => {
  it('states what survives as well as what goes', () => {
    const plan = planRunnerWipe({
      reports: [dir('don-hang'), dir('_batches')],
    });
    expect(describeWipePlan(plan)).toContain('preserving 1 path(s)');
    expect(describeWipePlan(plan)).toContain('1 director');
  });
});

describe('RUNNER_WIPE_PRESERVE_DIRS', () => {
  it('is the documented set, so widening it is a deliberate edit', () => {
    expect([...RUNNER_WIPE_PRESERVE_DIRS].sort()).toEqual([
      '_batches',
      '_sessions',
      'mcp-sessions',
    ]);
  });
});
