import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EvidenceStore, createArtifactLayout } from '@qakit/core';
import { createBrowserRuntime, createHtmlWidgets } from '@qakit/ui';
import { chromium } from 'playwright';
import { createRunWriter } from './run-writer.js';
import { createUiMcpServer, resolveUiMcpSetup, type UiMcpServerHandle } from './server.js';

const browserInstalled = fs.existsSync(chromium.executablePath());

const PAGE = `<!doctype html><html><body>
<label for="q">Search</label><input id="q" />
<button id="delete-order">Delete order</button>
<table id="orders">
  <thead><tr><th data-col-id="sku">SKU</th><th data-col-id="qty">Qty</th></tr></thead>
  <tbody><tr><td>A-1</td><td>2</td></tr><tr><td>B-2</td><td>5</td></tr></tbody>
</table>
</body></html>`;

describe('UI MCP server end to end', { skip: browserInstalled ? false : 'playwright chromium is not installed' }, () => {
  let web: Server;
  let handle: UiMcpServerHandle<'none'>;
  let client: Client;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-mcp-ui-'));
  const sqlitePath = path.join(root, 'db', 'runs.db');

  const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    return result.isError ? { isError: true, text } : JSON.parse(text);
  };

  before(async () => {
    web = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(PAGE);
    });
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
    const host = `127.0.0.1:${(web.address() as AddressInfo).port}`;
    const baseUrl = `http://${host}`;
    const layout = createArtifactLayout({ rootDir: root, resolveGroup: (scenario) => ({ domain: 'adhoc', kind: undefined, testCaseId: scenario }) });
    const target = { baseUrl, loginPath: '/login', allowedHosts: [host] };

    handle = createUiMcpServer(
      resolveUiMcpSetup({
        web: target,
        authModes: ['none'],
        environment: 'local',
        auditRoot: path.join(root, 'evidence'),
        secretValues: ['hunter2'],
        writeRun: createRunWriter({ layout, sqlitePath }),
        openRuntime: async ({ scenario, runId, authMode, allowWrites }) => {
          const evidence = new EvidenceStore({ scenario, runId, webBaseUrl: baseUrl, rootDir: root, runDir: layout.runEvidenceDir(scenario, runId) });
          const runtime = createBrowserRuntime<'none'>({
            browserType: chromium,
            web: target,
            evidence,
            logger: { warn: () => {} },
            defaultAuthMode: authMode,
            widgets: createHtmlWidgets(),
            allowWrites,
            tracePolicy: 'off',
            videoPolicy: 'off',
            harMode: 'off',
          });
          return {
            ui: (options) => runtime.ui(options),
            evidence,
            networkTrace: () => runtime.networkTrace(),
            close: (passed) => runtime.close(passed),
            evidenceDirDisplay: () => runtime.evidenceDirDisplay(),
          };
        },
      }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await handle.server.connect(serverTransport);
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  after(async () => {
    await client?.close();
    await handle?.session.close(true);
    await new Promise<void>((resolve) => web.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the nine tools with the configured auth modes', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['ui_open_session', 'ui_open_screen', 'ui_describe_screen', 'ui_act', 'ui_read_grid', 'ui_assert', 'ui_capture_evidence', 'ui_finish_run', 'ui_close_session'],
    );
    const openSession = tools.find((tool) => tool.name === 'ui_open_session')!;
    assert.deepEqual((openSession.inputSchema.properties as any).authMode.enum, ['none']);
  });

  it('refuses unsafe calls before any browser exists', async () => {
    assert.equal((await call('ui_act', { action: 'click', target: { domId: 'delete-order' }, confirmLabel: 'Delete', reason: 'probe' })).denied, true);
    assert.equal((await call('ui_act', { action: 'fill', target: { domId: 'q' }, value: 'hunter2', reason: 'probe' })).denied, true);
    assert.equal((await call('ui_open_screen', { path: 'https://evil.example/' })).denied, true);
    assert.match((await call('ui_read_grid', { columns: ['sku'] })).error, /ui_open_session/);
    assert.match((await call('ui_assert', { testId: 'bad', label: 'x', expected: 1, actual: 1 })).text, /TC-XX-Y01/);
  });

  it('drives a session through to a stored run', async () => {
    const opened = await call('ui_open_session', {});
    assert.equal(opened.ok, true);
    assert.equal(opened.readOnly, true);

    assert.equal((await call('ui_open_screen', { path: '/' })).ok, true);
    const described = await call('ui_describe_screen', { limit: 10 });
    assert.equal(described.gridCount, 1);
    assert.ok(described.elements.some((element: { domId?: string }) => element.domId === 'q'));

    assert.equal((await call('ui_act', { action: 'fill', target: { domId: 'q' }, value: 'A-1', reason: 'filter' })).ok, true);
    const grid = await call('ui_read_grid', { columns: ['sku', 'qty'] });
    assert.deepEqual(grid.rows, [{ sku: 'A-1', qty: '2' }, { sku: 'B-2', qty: '5' }]);

    assert.equal((await call('ui_assert', { testId: 'TC-ORD-U01 / A1', label: 'row count', expected: 2, actual: grid.rows.length })).passed, true);
    assert.ok((await call('ui_capture_evidence', { label: 'orders grid' })).relPath);

    const finished = await call('ui_finish_run', { scenario: 'ui-orders-list', testCaseId: 'TC-ORD-U01', testCaseName: 'Orders list', objective: 'List orders' });
    assert.equal(finished.passed, true);
    assert.ok(fs.existsSync(finished.reportPath));
    assert.ok(fs.existsSync(finished.outputPath));
    const db = new DatabaseSync(sqlitePath);
    try {
      const row = db.prepare('SELECT scenario_key, environment FROM test_runs WHERE id = ?').get(finished.runId) as Record<string, string>;
      assert.deepEqual({ ...row }, { scenario_key: 'ui-orders-list', environment: 'local' });
    } finally {
      db.close();
    }

    const closed = await call('ui_close_session', { passed: true });
    assert.equal(closed.ok, true);
    assert.ok(closed.evidence, 'the evidence folder is reported even though the runtime is gone after close');

    const audit = fs.readFileSync(closed.auditLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { tool: string; outcome: string });
    assert.deepEqual(
      audit.filter((entry) => entry.outcome === 'denied').map((entry) => entry.tool),
      ['ui_act', 'ui_act', 'ui_open_screen'],
    );
    assert.ok(!fs.readFileSync(closed.auditLog, 'utf8').includes('hunter2'), 'secrets never reach the audit log');
  });
});
