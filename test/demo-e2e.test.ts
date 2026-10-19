import { strict as assert } from 'node:assert';
import { existsSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createLogger, loadProjectAdapter, loadProjectConfig, type LoadedProjectConfig, type ProjectAdapter } from '../packages/core/src/index.js';
import { discoverScenarios, runScenario, type ScenarioRunOutcome } from '../packages/runner/src/index.js';
import { runDoctor } from '../packages/cli/src/doctor.js';

/**
 * The kit end to end on a project that is not the one it was extracted from: the demo shop server, its
 * scaffold-shaped QA project, `qakit doctor`, scenario discovery, and two API and two UI scenarios
 * through the runner to reports and the SQLite store.
 */
const QA = fileURLToPath(new URL('../examples/demo-app/qa/', import.meta.url));
const PORT = 4731;
const browserInstalled = existsSync(chromium.executablePath());

describe('demo shop end to end', () => {
  let server: Server;
  let loaded: LoadedProjectConfig;
  let adapter: ProjectAdapter | undefined;
  const env = { ...process.env, DEMO_SHOP_USERNAME: 'qa', DEMO_SHOP_PASSWORD: 'secret', DEMO_SHOP_URL: `http://127.0.0.1:${PORT}` };
  const cleanOutputs = (): void => {
    for (const dir of ['db', 'reports', 'outputs', 'evidence', '.cache']) rmSync(join(QA, dir), { recursive: true, force: true });
  };

  before(async () => {
    cleanOutputs();
    const { createDemoServer } = (await import(new URL('../examples/demo-app/server.mjs', import.meta.url).href)) as { createDemoServer: (o?: object) => Server };
    server = createDemoServer({ username: 'qa', password: 'secret' });
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
    loaded = loadProjectConfig({ configPath: join(QA, 'qakit.config.yaml'), env });
    adapter = await loadProjectAdapter(loaded);
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanOutputs();
  });

  it('doctor finds no problems', async () => {
    const checks = await runDoctor({ configPath: join(QA, 'qakit.config.yaml'), env: { ...env } });
    assert.deepEqual(checks.filter((c) => c.status === 'fail'), []);
    const byName = new Map(checks.map((c) => [c.name, c.status]));
    assert.equal(byName.get('api source shop spec'), 'ok');
    assert.equal(byName.get('api source shop login'), 'ok');
    assert.equal(byName.get('web reachable'), 'ok');
    assert.equal(byName.get('api domains'), 'ok');
  });

  it('discovers the four scenarios', async () => {
    const found = await discoverScenarios(loaded);
    assert.deepEqual(found.map((f) => `${f.scenario.testCaseId}:${f.scenario.kind}`), ['TC-ORD-A01:api', 'TC-ORD-A02:api', 'TC-ORD-U01:ui', 'TC-ORD-U02:ui']);
    assert.equal((await discoverScenarios(loaded, { kind: 'ui', grep: 'search' })).length, 1);
  });

  it('runs the API scenarios to PASS, with reports and stored runs', async () => {
    const outcomes: ScenarioRunOutcome[] = [];
    for (const { scenario } of await discoverScenarios(loaded, { kind: 'api' })) {
      outcomes.push(await runScenario(scenario, { loaded, adapter, env, logger: createLogger('error') }));
    }
    assert.deepEqual(outcomes.map((o) => [o.testCaseId, o.verdict, o.failedChecks]), [['TC-ORD-A01', 'PASS', 0], ['TC-ORD-A02', 'PASS', 0]]);
    for (const outcome of outcomes) {
      assert.ok(existsSync(outcome.reportPath) && existsSync(outcome.outputPath));
      assert.ok(outcome.stored);
    }
    const db = new DatabaseSync(join(QA, 'db', 'runs.db'));
    try {
      const rows = db.prepare('SELECT scenario_key, result FROM test_runs ORDER BY scenario_key').all() as Array<{ scenario_key: string; result: string }>;
      assert.deepEqual(rows.map((r) => [r.scenario_key, r.result]), [['orders-list', 'PASS'], ['orders-require-sign-in', 'PASS']]);
    } finally {
      db.close();
    }
  });

  it('runs the UI scenarios to PASS through a real browser', { skip: browserInstalled ? false : 'playwright chromium is not installed' }, async () => {
    const outcomes: ScenarioRunOutcome[] = [];
    for (const { scenario } of await discoverScenarios(loaded, { kind: 'ui' })) {
      outcomes.push(await runScenario(scenario, { loaded, adapter, env, logger: createLogger('error') }));
    }
    assert.deepEqual(
      outcomes.map((o) => [o.testCaseId, o.verdict, o.failedChecks, o.error ?? '']),
      [['TC-ORD-U01', 'PASS', 0, ''], ['TC-ORD-U02', 'PASS', 0, '']],
    );
    assert.ok(outcomes.every((o) => o.stored));
  });
});
