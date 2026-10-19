import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { RequestTraceEntry } from '../http/http-client.js';
import { createReportKit } from './report-kit.js';
import type { ReportableResult } from './result.js';
import { checkpointRowStatus, deriveVerdict } from './verdict.js';
import { defaultReportWording, type ReportWording } from './wording.js';

function call(method: RequestTraceEntry['method'], url: string, status: number, extra: Partial<RequestTraceEntry> = {}): RequestTraceEntry {
  return { timestamp: 't', sourceId: 'shop', method, url, status, ...extra };
}

const TRACE: RequestTraceEntry[] = [
  call('GET', 'https://shop.example.test/api/orders?page=1&pageSize=20', 200, { responseBody: { items: [] } }),
  call('GET', 'https://shop.example.test/api/jobs/1234567', 200),
  call('GET', 'https://shop.example.test/api/jobs/1234567', 200),
  call('GET', 'https://shop.example.test/api/jobs/1234567', 200),
  call('POST', 'https://shop.example.test/api/orders', 422, {
    requestBody: { name: 'A', items: [{ qty: 3 }] },
    responseBody: { error: { code: 'Orders:QtyTooHigh', message: 'Too many' } },
  }),
  call('DELETE', 'https://shop.example.test/api/orders/693ec0e4-1111-2222-3333-444455556666', 0, { error: 'socket hang up' }),
];

const FAILING: ReportableResult = {
  scenario: 'orders-create-qty-limit',
  dryRun: false,
  passed: false,
  steps: [
    { title: 'POST /api/orders', ok: false, status: 422, data: { error: { code: 'Orders:QtyTooHigh', message: 'Too many' } } },
    { title: 'Cleanup: delete order', ok: true },
  ],
  checks: [
    { label: 'rejected with code', expected: 'Orders:QtyTooHigh', actual: 'Orders:Other', passed: false, testId: 'TC-ORD-A01 / A1' },
    { label: 'no order left', expected: true, actual: true, passed: true },
  ],
  error: 'create failed | details: {"state":"{\\"a\\":1}"}',
};

const PATHS = { runId: 'run-1', reportPath: '/r/reports/a.md', outputPath: '/r/outputs/a.json' };

describe('verdicts', () => {
  it('ranks FAIL, BLOCKED, PARTIAL and PASS', () => {
    const pass = { expected: 1, actual: 1, passed: true };
    const fail = { expected: 1, actual: 2, passed: false };
    const open = { expected: 'NOT_EVALUATED — no data', actual: 'x', passed: true };
    assert.equal(checkpointRowStatus(open), 'NOT_EVALUATED');
    assert.equal(deriveVerdict({ checks: [pass, fail], passed: true, blocked: false }), 'FAIL');
    assert.equal(deriveVerdict({ checks: [fail], passed: false, blocked: true }), 'BLOCKED');
    assert.equal(deriveVerdict({ checks: [pass], passed: true, blocked: true }), 'PARTIAL');
    assert.equal(deriveVerdict({ checks: [pass, open], passed: true, blocked: false }), 'PARTIAL');
    assert.equal(deriveVerdict({ checks: [pass], passed: true, blocked: false }), 'PASS');
  });
});

describe('createReportKit with the default English wording', () => {
  const kit = createReportKit();

  it('collapses repeated calls into one evidence row', () => {
    const rows = kit.buildEvidenceRows(TRACE);
    assert.equal(rows.length, 4);
    assert.equal(rows[1]!.count, 3);
    assert.equal(rows[1]!.purpose, 'GET /api/jobs/{id}');
    assert.equal(rows[0]!.keyInput, 'page=1, pageSize=20');
    assert.equal(rows[2]!.keyInput, 'name=A');
    assert.equal(rows[2]!.result, '422 Validation error (Orders:QtyTooHigh)');
    assert.equal(rows[3]!.result, 'Network error — socket hang up');
  });

  it('renders every section of the QA report', () => {
    const model = kit.buildReportModel(FAILING, TRACE, PATHS);
    const markdown = kit.renderQaMarkdown(model, FAILING, TRACE, PATHS.reportPath, PATHS.outputPath);
    for (const heading of [
      '## 1. Report Header',
      '## 3. Expected vs Actual',
      '## 8. Technical Appendix',
      '### Error',
      '### Steps',
      '### Checklist',
      '### Evidence — API calls (input / output)',
      '#### Failure focus',
      '## 9. Final Conclusion',
    ]) {
      assert.ok(markdown.includes(heading), heading);
    }
    assert.match(markdown, /Overall result: \*\*FAIL\*\*/);
    assert.match(markdown, /was called 3 times consecutively/);
    assert.match(markdown, /details: \(see JSON below\)/);
    assert.match(markdown, /Scenario orders-create-qty-limit FAILED: create failed/);
    assert.match(markdown, /\[a\.json\]\(\.\.\/outputs\/a\.json\)/);
    assert.deepEqual(model.appendixMeta.cleanupActions, ['Cleanup: delete order — OK']);
    assert.equal(model.defectDetails.observedMismatch, 'rejected with code: expected "Orders:QtyTooHigh", actual "Orders:Other"');
  });

  it('concludes PARTIAL and BLOCKED runs without calling them failures', () => {
    const partial = kit.buildConclusion({ ...FAILING, passed: true, checks: [{ label: 'x', expected: 'NOT_EVALUATED', actual: 'NOT_EVALUATED', passed: true }] });
    assert.match(partial, /partially passed: .*1 checkpoint\(s\) could not be evaluated/);
    const blocked = kit.buildConclusion({ ...FAILING, blocked: 'no fixture data', checks: [] });
    assert.equal(blocked, 'Scenario orders-create-qty-limit could not be fully verified: no fixture data');
  });

  it("merges a scenario's override and keeps the header verdict in sync", () => {
    const model = kit.buildReportModel(
      { ...FAILING, reportModel: { header: { relatedBugs: ['#42'] }, qaSummary: { businessScenario: 'custom', verdict: 'BLOCKED' }, conclusion: 'custom end' } },
      TRACE,
      PATHS,
    );
    assert.equal(model.header.overallResult, 'BLOCKED');
    assert.deepEqual(model.header.relatedBugs, ['#42']);
    assert.equal(model.conclusion, 'custom end');
  });
});

describe('project wording hooks', () => {
  type OrderResult = ReportableResult & { order?: { id: string } };
  const wording: ReportWording<OrderResult> = {
    ...(defaultReportWording as unknown as ReportWording<OrderResult>),
    describeStep: (title) => `step: ${title}`,
    describeApiCall: (_method, url) => (url.includes('/jobs/') ? 'Poll job' : undefined),
    keyInput: { itemFields: ['qty'], bodyFields: [], ignoredQueryParams: ['PAGESIZE'] },
    appendixBeforeSteps: (result, depth) => (result.order ? [`${'#'.repeat(depth)} Order`, `- id: ${result.order.id}`, ''] : []),
    artifactFields: (result) => ({ order: result.order }),
  };
  const kit = createReportKit(wording);
  const result: OrderResult = { ...FAILING, order: { id: 'o-1' } };

  it('uses the purpose, key-input and step hooks', () => {
    const rows = kit.buildEvidenceRows(TRACE);
    assert.equal(rows[0]!.keyInput, 'page=1');
    assert.equal(rows[1]!.purpose, 'Poll job');
    assert.equal(rows[2]!.keyInput, 'items[0].qty=3');
    assert.deepEqual(kit.buildReproStepsFromSteps(result), ['step: POST /api/orders']);
  });

  it('places project sections before the steps table and project fields before `error` in the artifact', () => {
    const appendix = kit.renderTechnicalAppendix(result, TRACE, PATHS.reportPath, PATHS.outputPath).join('\n');
    assert.ok(appendix.indexOf('## Order') < appendix.indexOf('## Steps'));
    const artifact = kit.buildRunArtifact(result, TRACE, 'run-1');
    assert.deepEqual(Object.keys(artifact).slice(-5), ['checks', 'order', 'error', 'overview', 'trace']);
    assert.equal(artifact.visualSteps.length, TRACE.length);
    assert.equal(artifact.blocked, false);
  });
});
