import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { liveEnv, parseSuiteArgs, runSuiteCli } from './cli.js';

/**
 * `qakit-suite` is spawned by the reporting API with the argv its regression-jobs module builds, and the
 * API parses what it prints. These tests pin both halves of that contract.
 */
const DEMO_CONFIG = fileURLToPath(new URL('../../../examples/demo-app/qa/qakit.config.yaml', import.meta.url));

/** The API's own parsers (regression-list.util.ts). */
const LIST_ROW = /^(\S+)\s+(api|ui)\s+(\S+)\s+(\S+)\s*$/;
const LIST_SUMMARY = /^(\d+)\s+scenario\(s\)\s+selected\s+\[(.*)\]\s*$/;

async function captureStdout(run: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => {
    lines.push(...parts.map(String).join(' ').split('\n'));
  };
  try {
    return { code: await run(), lines };
  } finally {
    console.log = original;
  }
}

describe('parseSuiteArgs', () => {
  it('accepts the argv the reporting API builds for a job', () => {
    const args = parseSuiteArgs([
      '--config', 'qakit.config.yaml',
      '--kind', 'ui',
      '--module', 'orders',
      '--testcase', 'TC-ORD-U01',
      '--testcase', 'TC-ORD-U02',
      '--grep', 'search',
      '--env', 'local',
      '--clean',
      '--data-mode', 'existing',
      '--bail',
      '--no-cleanup',
      '--headed',
      '--ui-slowmo', '250',
    ]);
    assert.equal(args.configPath, 'qakit.config.yaml');
    assert.equal(args.environment, 'local');
    assert.equal(args.kind, 'ui');
    assert.deepEqual(args.modules, ['orders']);
    // Repeated flags accumulate: the API emits one --testcase per id.
    assert.deepEqual(args.testCaseIds, ['TC-ORD-U01', 'TC-ORD-U02']);
    assert.equal(args.grep, 'search');
    assert.equal(args.label, 'ui-orders-TC-ORD-U01-TC-ORD-U02-search');
    assert.equal(args.clean, true);
    assert.equal(args.bail, true);
    assert.equal(args.cleanup, false);
    assert.equal(args.headed, true);
    assert.equal(args.uiSlowMoMs, 250);
    assert.deepEqual(args.files, []);
  });

  it('keeps the inline and comma forms', () => {
    const args = parseSuiteArgs(['--config=qakit.config.yaml', '--testcase=TC-ORD-A01,TC-ORD-A02', '--list', 'src/x.scenario.ts']);
    assert.equal(args.configPath, 'qakit.config.yaml');
    assert.deepEqual(args.testCaseIds, ['TC-ORD-A01', 'TC-ORD-A02']);
    assert.equal(args.list, true);
    assert.deepEqual(args.files, ['src/x.scenario.ts']);
    assert.equal(parseSuiteArgs([]).label, 'all');
  });

  it('refuses what it cannot honour', () => {
    assert.throws(() => parseSuiteArgs(['--data-mode', 'seeded']), /not supported/);
    assert.throws(() => parseSuiteArgs(['--kind', 'both']), /api\|ui/);
    assert.throws(() => parseSuiteArgs(['--ui-slowmo', '-5']), /non-negative integer/);
    assert.throws(() => parseSuiteArgs(['--ui-slowmo']), /--ui-slowmo needs a value/);
    assert.throws(() => parseSuiteArgs(['--ui-slowmo', 'fast']), /non-negative integer/);
    assert.throws(() => parseSuiteArgs(['--env', '--list']), /--env needs a value/);
    assert.throws(() => parseSuiteArgs(['--clean-all']), /Unknown argument "--clean-all"/);
  });
});

describe('runSuiteCli --list', () => {
  it('prints rows, a summary and module tokens the reporting API parses', async () => {
    const { code, lines } = await captureStdout(() => runSuiteCli(['--config', DEMO_CONFIG, '--kind', 'api', '--list']));
    assert.equal(code, 0);

    const rows = lines.map((l) => LIST_ROW.exec(l)).filter((m): m is RegExpExecArray => m !== null);
    assert.deepEqual(
      rows.map((m) => [m[1], m[2], m[3], m[4]]),
      [
        ['TC-ORD-A01', 'api', 'orders', 'orders-list'],
        ['TC-ORD-A02', 'api', 'orders', 'orders-require-sign-in'],
      ],
    );
    const summary = lines.map((l) => LIST_SUMMARY.exec(l.trim())).find((m) => m !== null);
    assert.deepEqual([summary?.[1], summary?.[2]], ['2', 'api']);
    assert.ok(lines.includes('module tokens: orders'));
  });

  it('selects by module and repeated test case ids', async () => {
    const { lines } = await captureStdout(() =>
      runSuiteCli(['--config', DEMO_CONFIG, '--module', 'orders', '--testcase', 'TC-ORD-U02', '--testcase', 'TC-ORD-A01', '--list']),
    );
    assert.deepEqual(
      lines.map((l) => LIST_ROW.exec(l)?.[1]).filter(Boolean),
      ['TC-ORD-A01', 'TC-ORD-U02'],
    );
    assert.ok(!lines.some((l) => l.startsWith('module tokens:')), 'module tokens are only listed when no --module was given');
  });
});

describe('liveEnv', () => {
  it('reads the live base, keeps its own layer and writes, and spreads both', () => {
    const base: NodeJS.ProcessEnv = { TOKEN: 'old', SHARED: 'base' };
    const env = liveEnv({ SHARED: 'layer' }, base);
    base.TOKEN = 'new';
    assert.equal(env.TOKEN, 'new');
    assert.equal(env.SHARED, 'layer');
    env.LOCAL = 'x';
    assert.equal(base.LOCAL, undefined);
    assert.deepEqual({ ...env }, { TOKEN: 'new', SHARED: 'layer', LOCAL: 'x' });
    assert.equal('TOKEN' in env, true);
    assert.equal(env.MISSING, undefined);
  });
});
