import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { flattenCsvMeta, rebuildCsvMeta } from '../checklist/flatten.js';
import type { RequestTraceEntry } from '../http/http-client.js';
import { createReportKit } from '../report/report-kit.js';
import type { ReportableResult } from '../report/result.js';
import { toJsonColumnOmitEmpty } from './json.js';
import { loadRunFromStore } from './load-run.js';
import { deriveRunVerdict, writeRunToStore } from './persist-run.js';
import { deleteSqliteFiles, openRunStore, purgeRunsInStore } from './run-store.js';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-store-'));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const kit = createReportKit();
const TRACE: RequestTraceEntry[] = [
  { timestamp: 't', sourceId: 'shop', method: 'POST', url: 'https://shop.example.test/api/orders', status: 422, requestBody: { name: 'A' }, responseBody: { error: { code: 'Orders:Qty:TooHigh' } } },
  { timestamp: 't', sourceId: 'shop', method: 'GET', url: 'https://shop.example.test/api/orders/1234567', status: 200 },
];
const RESULT: ReportableResult = {
  scenario: 'orders-qty-limit',
  dryRun: false,
  passed: false,
  steps: [
    { title: 'POST /api/orders', ok: false, status: 422, data: { error: { code: 'Orders:Qty:TooHigh' } } },
    { title: 'GET /api/orders/{id}', ok: true, status: 200 },
  ],
  checks: [
    {
      label: 'rejected with code',
      expected: 'Orders:Qty:Other',
      actual: 'Orders:Qty:TooHigh',
      passed: false,
      testId: 'TC-ORD-A01 / A1',
      csv: [{ checklistId: 'ORD-01', testcaseId: 'TC_1', expected: 'Rejected', priority: 'High' }],
    },
    { label: 'nothing created', expected: 0, actual: 0, passed: true },
  ],
  overview: { testCaseId: 'TC-ORD-A01', testCaseName: 'Quantity limit', objective: 'Orders above stock are rejected' },
  detailTables: [{ title: 'Rows', columns: ['a'], rows: [['1']] }],
};

function persistFixture(db: DatabaseSync, runId: string, startedAt: string) {
  const reportPath = path.join(DIR, 'reports', `${runId}.md`);
  const outputPath = path.join(DIR, 'outputs', `${runId}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const artifact = kit.buildRunArtifact(RESULT, TRACE, runId);
  const model = kit.buildReportModel(RESULT, TRACE, { runId, reportPath, outputPath });
  fs.writeFileSync(reportPath, kit.renderQaMarkdown(model, RESULT, TRACE, reportPath, outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(artifact));
  return writeRunToStore(db, {
    result: RESULT,
    artifact,
    trace: TRACE,
    model,
    paths: { reportPath, outputPath },
    meta: { environment: 'test', startedAt },
    rootDir: DIR,
    grouping: { module: 'orders', domain: 'orders', featureId: 'ORD-01' },
    buildEvidenceRows: kit.buildEvidenceRows,
    hooks: {
      payloads: () => [{ label: 'default', payload: { sku: 'A' } }],
      customData: () => ({ createdOrder: { id: 'o-1' }, skipped: undefined }),
      relatedEntities: () => [
        { entityType: 'project', entityId: 'p-1', entityLabel: 'Shop' },
        { entityType: 'project', entityId: 'p-1' },
      ],
    },
  });
}

describe('run store', () => {
  const dbPath = path.join(DIR, 'db', 'runs.db');
  const db = openRunStore(dbPath);

  it('persists a run with its checks, steps, evidence, artifacts and defect', () => {
    assert.deepEqual(persistFixture(db, 'run-1', '2026-01-01T00:00:00.000Z'), { runId: 'run-1', testCaseId: 'TC-ORD-A01' });

    const run = db.prepare('SELECT result, module, domain, payloads, custom_data FROM test_runs WHERE id = ?').get('run-1') as Record<string, string>;
    assert.equal(run.result, 'FAIL');
    assert.equal(run.module, 'orders');
    assert.deepEqual(JSON.parse(run.payloads!), [{ label: 'default', payload: { sku: 'A' } }]);
    assert.deepEqual(JSON.parse(run.custom_data!), { createdOrder: { id: 'o-1' }, detailTables: RESULT.detailTables });

    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    assert.equal(count('test_run_checks'), 2);
    assert.equal(count('test_run_steps'), 2);
    assert.equal(count('test_run_evidence'), 2);
    assert.equal(count('test_run_related_entities'), 1);
    assert.equal(count('defect_signatures'), 1);
    assert.equal(count('defect_observations'), 1);

    const paths = (db.prepare('SELECT kind, path FROM artifacts ORDER BY id').all() as Array<{ kind: string; path: string }>).map((a) => `${a.kind}:${a.path}`);
    assert.deepEqual(paths, ['markdown_report:reports/run-1.md', 'json_run_artifact:outputs/run-1.json']);
    const check = db.prepare('SELECT csv_testcase_id, csv_priority FROM test_run_checks WHERE seq = 1').get() as Record<string, string>;
    assert.deepEqual({ ...check }, { csv_testcase_id: 'TC_1', csv_priority: 'High' });
  });

  it('reuses the defect signature for a repeat failure', () => {
    persistFixture(db, 'run-2', '2026-01-02T00:00:00.000Z');
    const signature = db.prepare('SELECT first_observed_run_id AS first, last_observed_run_id AS last FROM defect_signatures').get() as Record<string, string>;
    assert.deepEqual({ ...signature }, { first: 'run-1', last: 'run-2' });
  });

  it('reloads a stored run for re-rendering', () => {
    const stored = loadRunFromStore(db, 'run-1', { rootDir: DIR, fallbackReportPath: () => 'unused' });
    assert.equal(stored.model.header.testCaseId, 'TC-ORD-A01');
    assert.equal(stored.trace.length, 2);
    assert.equal(stored.result.checks?.[0]?.csv?.[0]?.testcaseId, 'TC_1');
    assert.deepEqual(stored.result.detailTables, RESULT.detailTables);
    assert.deepEqual(stored.customData.createdOrder, { id: 'o-1' });
    assert.equal(stored.payloads[0]?.label, 'default');
    assert.match(kit.renderQaMarkdown(stored.model, stored.result, stored.trace, stored.reportPath, stored.outputPath), /## 8\. Technical Appendix/);
    assert.throws(() => loadRunFromStore(db, 'run-missing', { rootDir: DIR, fallbackReportPath: () => '' }), /no test_runs row found for run id "run-missing"/);
  });

  it('purges runs and the signatures left without observations', () => {
    assert.deepEqual(purgeRunsInStore(db, ['orders-qty-limit', 'unknown']), { runsDeleted: 2, signaturesDeleted: 1 });
    assert.equal((db.prepare('SELECT COUNT(*) AS c FROM test_runs').get() as { c: number }).c, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS c FROM test_cases').get() as { c: number }).c, 1, 'the catalog survives');
    assert.deepEqual(purgeRunsInStore(db, []), { runsDeleted: 0, signaturesDeleted: 0 });
    db.close();
    assert.ok(deleteSqliteFiles(dbPath).includes(dbPath));
    assert.equal(fs.existsSync(dbPath), false);
  });

  it('backfills columns added after a database was created', () => {
    const legacyPath = path.join(DIR, 'legacy.db');
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`CREATE TABLE test_cases (
      id TEXT PRIMARY KEY, scenario_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, objective TEXT, impacted_area TEXT,
      owner TEXT, status TEXT NOT NULL DEFAULT 'active', version_label TEXT, tags JSON, metadata JSON,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`);
    legacy.close();
    const upgraded = openRunStore(legacyPath);
    const columns = (upgraded.prepare('PRAGMA table_info(test_cases)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(['module', 'domain', 'feature_id'].every((c) => columns.includes(c)));
    upgraded.close();
  });
});

describe('store helpers', () => {
  it('derives ERROR for a run that produced nothing', () => {
    assert.equal(deriveRunVerdict({ scenario: 's', dryRun: false, passed: false, steps: [] }), 'ERROR');
    assert.equal(deriveRunVerdict({ scenario: 's', dryRun: false, passed: true, steps: [] }), 'PASS');
  });

  it('keeps empty JSON columns NULL', () => {
    assert.equal(toJsonColumnOmitEmpty([]), null);
    assert.equal(toJsonColumnOmitEmpty({}), null);
    assert.equal(toJsonColumnOmitEmpty({ a: 1 }), '{"a":1}');
  });

  it('round-trips multi-row checklist metadata, keeping a piped cell whole', () => {
    const csv = [
      { checklistId: 'S', testcaseId: 'TC_1', expected: 'a | b', priority: 'High' },
      { checklistId: 'S', testcaseId: 'TC_2', expected: 'c', businessRule: 'r' },
    ];
    const flat = flattenCsvMeta(csv);
    assert.deepEqual(flat, { csvChecklistId: 'S', csvTestcaseId: 'TC_1 | TC_2', csvExpected: 'a | b | c', csvBusinessRule: '— | r', csvPriority: 'High | —' });
    const rebuilt = rebuildCsvMeta({
      csv_checklist_id: flat.csvChecklistId!,
      csv_testcase_id: flat.csvTestcaseId!,
      csv_expected: flat.csvExpected!,
      csv_business_rule: flat.csvBusinessRule!,
      csv_priority: flat.csvPriority!,
    });
    assert.deepEqual(rebuilt, [
      { checklistId: 'S', testcaseId: 'TC_1', expected: 'a | b | c', businessRule: undefined, priority: 'High' },
      { checklistId: 'S', testcaseId: 'TC_2', expected: 'a | b | c', businessRule: 'r', priority: undefined },
    ]);
  });
});
