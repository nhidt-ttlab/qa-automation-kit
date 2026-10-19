import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { EvidenceStore } from '@qakit/core';
import { chromium } from 'playwright';
import { createBrowserRuntime } from './runtime.js';
import type { UiWidgets } from './widgets.js';

/** Real headless Chromium against a local page. Skipped when Playwright's browser is not installed. */
const browserInstalled = fs.existsSync(chromium.executablePath());

const PAGE = `<!doctype html><html><body>
  <h1 id="title">Orders</h1>
  <button id="save" onclick="fetch('/api/orders', { method: 'POST', body: '{&quot;qty&quot;:1}' }).catch(() => {})">Save</button>
</body></html>`;

const noopWidgets = new Proxy({} as UiWidgets, {
  get: (_target, name) => (name === 'disabledClassPatterns' ? undefined : async () => undefined),
});

describe('createBrowserRuntime', { skip: browserInstalled ? false : 'playwright chromium is not installed' }, () => {
  let server: Server;
  let baseUrl: string;
  let host: string;
  const posts: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-runtime-'));

  before(async () => {
    server = createServer((req, res) => {
      if (req.method === 'POST') posts.push(req.url ?? '');
      res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/json');
      res.end(req.url === '/' ? PAGE : '{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    host = `127.0.0.1:${port}`;
    baseUrl = `http://${host}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('launches lazily, runs the auth hooks in order, blocks writes, and flushes evidence on close', async () => {
    const order: string[] = [];
    const evidence = new EvidenceStore({ scenario: 'orders-read', runId: 'run-1', webBaseUrl: baseUrl, rootDir: root, runDir: path.join(root, 'evidence', 'run-1') });
    const runtime = createBrowserRuntime({
      browserType: chromium,
      web: { baseUrl, loginPath: '/login', allowedHosts: [host] },
      evidence,
      logger: { warn: (message) => order.push(`warn:${message}`) },
      defaultAuthMode: 'none',
      widgets: noopWidgets,
      videoPolicy: 'off',
      consoleCaptureNote: 'test build',
      auth: {
        beforePage: async (_context, mode) => {
          order.push(`before:${mode}`);
        },
        afterPage: async (driver, _page, mode) => {
          order.push(`after:${mode}`);
          await driver.goto('/', 'open app');
        },
      },
    });

    assert.equal(runtime.networkTrace().length, 0, 'nothing launches before ui()');
    const driver = await runtime.ui({ authMode: 'none' });
    assert.equal(await runtime.ui(), driver, 'later calls reuse the same driver');
    assert.deepEqual(order, ['before:none', 'after:none']);

    assert.equal(await driver.readText({ domId: 'title' }), 'Orders');
    await driver.click({ domId: 'save' }, 'save');
    await driver.page.waitForTimeout(300);
    assert.deepEqual(posts, [], 'the read-only guard aborted the POST');
    assert.equal(driver.diagnostics().blockedRequests[0]?.body, '{"qty":1}');

    await runtime.close(true);
    const manifest = JSON.parse(fs.readFileSync(evidence.manifestPath, 'utf8'));
    assert.equal(manifest.browser.name, 'chromium');
    assert.equal(manifest.consoleCaptureNote, 'test build');
    assert.equal(manifest.diagnosticsSummary.blockedRequests, 1);
    const kinds = evidence.list().map((item) => item.kind).sort();
    assert.deepEqual(kinds, ['console_log', 'network_har'], 'a passing run drops its trace');
    assert.equal(fs.existsSync(path.join(evidence.dir, 'trace.zip')), false);
    await runtime.close(true); // idempotent
  });
});
