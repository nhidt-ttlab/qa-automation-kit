import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { ReportableResult } from '../report/result.js';
import { createArtifactLayout, loadReview, pruneEmptyDirs, sanitizeSegment, saveReview, type ArtifactGroup } from './artifact-layout.js';
import { batchSummaryFileName, renderBatchSummary } from './batch-summary.js';
import { cleanArtifactTrees } from './clean.js';
import { runLifecycle, terminalVerdict } from './lifecycle.js';
import { knownModuleTokens, parseBatchArgs, selectScenarios, sortScenarioIndex, type ScenarioIndexEntry } from './select.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-runner-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const GROUPS: Record<string, ArtifactGroup> = {
  'orders-list': { domain: 'orders', kind: 'ui', testCaseId: 'TC-ORD-U01' },
  'orders-create': { domain: 'orders', kind: 'api', testCaseId: 'TC-ORD-A01' },
};
const layout = createArtifactLayout({
  rootDir: ROOT,
  resolveGroup: (scenario) => GROUPS[scenario] ?? { domain: '_unknown', kind: undefined, testCaseId: sanitizeSegment(scenario) },
});

describe('artifact layout', () => {
  it('groups every root by domain, kind and test case', () => {
    assert.equal(layout.dir('reports'), path.join(ROOT, 'reports'));
    assert.equal(layout.dir('outputs', layout.group('orders-create')), path.join(ROOT, 'outputs', 'orders', 'api', 'TC-ORD-A01'));
    assert.equal(layout.runEvidenceDir('orders-list', 'run-1'), path.join(ROOT, 'evidence', 'orders', 'ui', 'TC-ORD-U01', 'run-1'));
    assert.equal(layout.evidenceManifestPath('ad hoc probe!', 'run-2'), path.join(ROOT, 'evidence', '_unknown', 'ad-hoc-probe', 'run-2', 'manifest.json'));
  });

  it('round-trips a redacted review and prunes emptied folders', () => {
    const file = saveReview(layout, {
      schemaVersion: 1,
      scenario: 'orders-create',
      runId: 'run-9',
      generatedAt: 't',
      reviewer: 'qa',
      verdict: 'pass',
      notes: 'ok',
      suggestedFix: '',
      reviewedAt: 't',
      correctedPayload: { password: 'secret' },
    });
    assert.deepEqual(loadReview(layout, 'orders-create', 'run-9')?.correctedPayload, { password: '[REDACTED]' });
    assert.equal(loadReview(layout, 'orders-create', 'run-missing'), null);
    const keep = path.join(ROOT, 'reviews', 'keep.txt');
    fs.writeFileSync(keep, 'x');
    fs.rmSync(file);
    pruneEmptyDirs(file, ROOT);
    assert.equal(fs.existsSync(path.join(ROOT, 'reviews', 'orders')), false);
    assert.equal(fs.existsSync(keep), true, 'stops at the first non-empty directory');
    fs.rmSync(keep);
    pruneEmptyDirs(keep, ROOT);
    assert.equal(fs.existsSync(path.join(ROOT, 'reviews')), false, 'an emptied root folder goes too');
    assert.equal(fs.existsSync(ROOT), true, 'never removes the stop directory itself');
  });
});

describe('selection', () => {
  const entries: ScenarioIndexEntry[] = sortScenarioIndex([
    { scenario: 'orders-list', module: 'purchase-order', domain: 'orders', kind: 'ui', testCaseId: 'TC-ORD-U01' },
    { scenario: 'orders-create', module: 'purchase-order', domain: 'orders', kind: 'api', testCaseId: 'TC-ORD-A01' },
    { scenario: 'orders-create-10', module: 'purchase-order', domain: 'orders', kind: 'api', testCaseId: 'TC-ORD-A10' },
    { scenario: 'stock-report', module: 'warehouse', domain: 'stock-report', kind: 'api', testCaseId: 'TC-STK-A01' },
  ]);
  const aliases = { po: 'purchase-order' };
  const names = (selected: ScenarioIndexEntry[]) => selected.map((e) => e.scenario);

  it('sorts by test case id and filters on every facet', () => {
    assert.deepEqual(names(entries), ['orders-create', 'orders-create-10', 'orders-list', 'stock-report']);
    assert.deepEqual(names(selectScenarios(entries, { kind: 'api', modules: ['PO'] }, aliases)), ['orders-create', 'orders-create-10']);
    assert.deepEqual(names(selectScenarios(entries, { testCaseIds: ['tc-ord-a01'] }, aliases)), ['orders-create']);
    assert.deepEqual(names(selectScenarios(entries, { grep: 'TC-ORD-A1' }, aliases)), ['orders-create-10']);
    assert.deepEqual(names(selectScenarios(entries, { modules: ['stock-report'] }, aliases)), ['stock-report']);
    assert.equal(selectScenarios(entries, {}, aliases).length, 4);
    assert.deepEqual(knownModuleTokens(entries, aliases), ['orders', 'po', 'purchase-order', 'stock-report', 'warehouse']);
  });

  it('parses batch flags and passes the rest through', () => {
    const options = parseBatchArgs(['--kind', 'ui', '--module', 'po, warehouse', '--testcase', 'TC-1', '--bail', '--env', 'qa', '--list']);
    assert.deepEqual(options.selector, { kind: 'ui', modules: ['po', 'warehouse'], testCaseIds: ['TC-1'] });
    assert.deepEqual(options.rest, ['--env', 'qa']);
    assert.equal(options.label, 'ui-po-warehouse-TC-1');
    assert.equal(options.bail && options.list, true);
    assert.equal(parseBatchArgs(['--all']).label, 'all');
    assert.throws(() => parseBatchArgs(['--kind', 'web']), /--kind expects api\|ui/);
  });
});

describe('cleaning', () => {
  const touch = (...segments: string[]) => {
    const file = path.join(ROOT, ...segments);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    return file;
  };
  const segments = (scenario: string) => [GROUPS[scenario]!.domain, GROUPS[scenario]!.kind!, GROUPS[scenario]!.testCaseId];

  it('run scope removes only the selected test-case folders, once each', () => {
    const selected = touch('reports', 'orders', 'api', 'TC-ORD-A01', 'a.md');
    const other = touch('reports', 'orders', 'ui', 'TC-ORD-U01', 'b.md');
    const removed = cleanArtifactTrees({
      rootDir: ROOT,
      roots: [path.join(ROOT, 'reports'), path.join(ROOT, 'outputs')],
      scope: 'run',
      scenarios: ['orders-create', 'orders-create'],
      scenarioSegments: segments,
    });
    assert.deepEqual(removed, [path.join(ROOT, 'reports', 'orders', 'api', 'TC-ORD-A01')]);
    assert.equal(fs.existsSync(selected), false);
    assert.equal(fs.existsSync(other), true);
  });

  it('all scope empties the roots but keeps the whitelisted entries', () => {
    touch('outputs', '.gitkeep');
    touch('outputs', 'orders', 'x.json');
    cleanArtifactTrees({ rootDir: ROOT, roots: [path.join(ROOT, 'outputs')], scope: 'all', scenarios: [], scenarioSegments: segments, keepAtRoot: new Set(['.gitkeep']) });
    assert.deepEqual(fs.readdirSync(path.join(ROOT, 'outputs')), ['.gitkeep']);
  });

  it('refuses to remove anything outside the root', () => {
    assert.throws(
      () => cleanArtifactTrees({ rootDir: path.join(ROOT, 'reports'), roots: [ROOT], scope: 'run', scenarios: ['x'], scenarioSegments: () => ['..', '..'] }),
      /Refusing to clean outside the package root/,
    );
  });
});

describe('run lifecycle', () => {
  const logger = { error: (_message: string) => {} };

  it('passes the minted run id to execute and tears down with the result', async () => {
    let tornDownWith: ReportableResult | undefined;
    const outcome = await runLifecycle({
      scenario: 'orders-create',
      dryRun: false,
      environment: 'test',
      logger,
      execute: async (runId) => ({ scenario: 'orders-create', dryRun: false, passed: true, steps: [{ title: runId, ok: true }] }),
      teardown: async (result) => {
        tornDownWith = result;
      },
    });
    assert.match(outcome.runId, /^run-[a-z0-9]+-[a-z0-9]+$/);
    assert.equal(outcome.result.steps[0]?.title, outcome.runId);
    assert.equal(tornDownWith, outcome.result);
    assert.equal(outcome.meta.environment, 'test');
    assert.equal(terminalVerdict(outcome.result), 'PASS');
  });

  it('turns a thrown error into a failed result and still tears down', async () => {
    const errors: string[] = [];
    let tornDown = false;
    const outcome = await runLifecycle({
      scenario: 'orders-create',
      dryRun: true,
      environment: 'test',
      runId: 'run-fixed',
      logger: { error: (message) => errors.push(message) },
      execute: async () => {
        throw new Error('no browser');
      },
      teardown: async () => {
        tornDown = true;
      },
    });
    assert.deepEqual(outcome.result, { scenario: 'orders-create', dryRun: true, passed: false, steps: [], error: 'no browser' });
    assert.equal(outcome.runId, 'run-fixed');
    assert.deepEqual(errors, ['Scenario failed before completing: no browser']);
    assert.equal(tornDown, true);
    assert.equal(terminalVerdict({ passed: false, blocked: 'no data' }), 'BLOCKED');
  });
});

describe('batch summary', () => {
  it('renders counts, a row per scenario and extra sections', () => {
    const markdown = renderBatchSummary({
      label: 'api-orders',
      environment: 'qa',
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 12_345,
      rows: [
        { verdict: 'PASS', testCaseId: 'TC-ORD-A01', scenario: 'orders-create', domain: 'orders', kind: 'api', durationMs: 1500 },
        { verdict: 'FAIL', testCaseId: 'TC-ORD-A02', scenario: 'orders-delete', domain: 'orders', kind: 'api', durationMs: 0, error: 'a | b' },
      ],
      sections: ['## Session', '', '- none', ''],
    });
    assert.match(markdown, /- Scenarios: 2 — \*\*1 PASS\*\*, 0 BLOCKED, \*\*1 FAIL\*\*/);
    assert.match(markdown, /\| FAIL \| TC-ORD-A02 \| `orders-delete` \| orders \| api \| 0\.0s \| a \\\| b \|/);
    assert.ok(markdown.endsWith('## Session\n\n- none\n'));
    assert.equal(batchSummaryFileName('2026-01-01T00:00:00.000Z', 'api'), '2026-01-01T00-00-00-000Z-api.md');
  });
});
