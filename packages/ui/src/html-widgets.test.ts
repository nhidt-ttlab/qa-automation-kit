import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { EvidenceStore } from '@qakit/core';
import { chromium } from 'playwright';
import { createHtmlWidgets } from './html-widgets.js';
import { createBrowserRuntime, type BrowserRuntime } from './runtime.js';

const browserInstalled = fs.existsSync(chromium.executablePath());

const PAGE = `<!doctype html><html><body>
<input id="name" />
<select id="status"><option>Open</option><option>Closed</option></select>
<button id="owner" aria-haspopup="listbox" onclick="document.getElementById('owners').hidden = false">Pick owner</button>
<ul id="owners" role="listbox" hidden>
  <li role="option" onclick="pickOwner('Alice')">Alice</li>
  <li role="option" onclick="pickOwner('Bob')">Bob</li>
</ul>
<button id="archive" disabled>Archive</button>
<div role="tablist">
  <button role="tab" aria-selected="true" onclick="tab(0)">Summary</button>
  <button role="tab" aria-selected="false" onclick="tab(1)">Items</button>
</div>
<div role="tabpanel" id="p0">Summary panel</div>
<div role="tabpanel" id="p1" hidden>Items panel</div>
<nav><button onclick="setPage(1)">1</button><button onclick="setPage(2)">2</button></nav>
<p id="page">page 1</p>
<table id="grid">
  <thead><tr><th data-col-id="sku">SKU</th><th data-col-id="qty">Qty</th></tr></thead>
  <tbody><tr><td>A-1</td><td class="editable">1,500</td></tr><tr><td>B-2</td><td>3</td></tr></tbody>
</table>
<button id="open-picker" onclick="document.getElementById('picker').hidden = false">Choose</button>
<div id="picker" role="dialog" hidden>
  <input type="search" aria-label="Search" />
  <table><tbody>
    <tr><td><input type="checkbox" /></td><td>Tower A</td></tr>
    <tr><td><input type="checkbox" /></td><td>Tower B</td></tr>
  </tbody></table>
  <button onclick="confirmPick()">OK</button>
  <button aria-label="Close" onclick="document.getElementById('picker').hidden = true">×</button>
</div>
<div role="status" id="toast"></div>
<script>
  function pickOwner(name) { document.getElementById('owner').textContent = name; document.getElementById('owners').hidden = true; }
  function tab(i) {
    document.querySelectorAll('[role=tab]').forEach((t, j) => t.setAttribute('aria-selected', String(i === j)));
    document.getElementById('p0').hidden = i !== 0;
    document.getElementById('p1').hidden = i !== 1;
  }
  function setPage(n) { document.getElementById('page').textContent = 'page ' + n; }
  document.querySelector('#grid td.editable').addEventListener('dblclick', (event) => {
    const td = event.currentTarget;
    if (td.querySelector('input')) return;
    const input = document.createElement('input');
    input.value = td.textContent.replace(/,/g, '');
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.addEventListener('keydown', (key) => { if (key.key === 'Enter') td.textContent = Number(input.value).toLocaleString('en-US'); });
  });
  function confirmPick() {
    const picked = [...document.querySelectorAll('#picker tr')].filter((r) => r.querySelector('input:checked')).map((r) => r.cells[1].textContent);
    document.getElementById('toast').textContent = 'Picked ' + picked.join(',');
    document.getElementById('picker').hidden = true;
  }
</script>
</body></html>`;

describe('createHtmlWidgets through UiDriver', { skip: browserInstalled ? false : 'playwright chromium is not installed' }, () => {
  let server: Server;
  let runtime: BrowserRuntime;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-html-widgets-'));

  before(async () => {
    server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    const baseUrl = `http://${host}`;
    runtime = createBrowserRuntime({
      browserType: chromium,
      web: { baseUrl, loginPath: '/login', allowedHosts: [host] },
      evidence: new EvidenceStore({ scenario: 'html-widgets', runId: 'run-1', webBaseUrl: baseUrl, rootDir: root, runDir: path.join(root, 'run-1') }),
      logger: { warn: () => {} },
      defaultAuthMode: 'none',
      widgets: createHtmlWidgets(),
      tracePolicy: 'off',
      videoPolicy: 'off',
      harMode: 'off',
    });
  });

  after(async () => {
    await runtime.close(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('drives inputs, selects, tabs, pagination and control state', async () => {
    const driver = await runtime.ui();
    await driver.goto('/');

    await driver.fill({ domId: 'name' }, 'Widget');
    assert.equal(await driver.page.inputValue('#name'), 'Widget');

    await driver.selectOption({ domId: 'status' }, 'Closed');
    assert.equal(await driver.readSelectValue({ domId: 'status' }), 'Closed');
    await driver.selectOption({ domId: 'owner' }, 'Bob');
    assert.equal(await driver.readSelectValue({ domId: 'owner' }), 'Bob');

    await driver.switchTab('Items');
    assert.equal((await driver.activeTabPanel().innerText()).trim(), 'Items panel');

    await driver.gotoPage(2);
    assert.equal(await driver.readText({ domId: 'page' }), 'page 2');

    assert.equal((await driver.readControlState({ domId: 'archive' })).disabled, true);
    assert.equal((await driver.readControlState({ domId: 'open-picker' })).disabled, false);
  });

  it('reads and edits a table', async () => {
    const driver = await runtime.ui();
    const snapshot = await driver.readGrid({ columns: ['qty', 'sku', 'missing'] });
    assert.deepEqual(snapshot, {
      columns: ['qty', 'sku'],
      rows: [
        { qty: '1,500', sku: 'A-1' },
        { qty: '3', sku: 'B-2' },
      ],
      domRowCount: 2,
    });
    assert.equal(await driver.countGridBodyRows(), 2);

    const edited = await driver.editGridCell({ column: 'qty', rowIndex: 0, value: '2500' });
    assert.deepEqual(edited, { ok: true, before: '1,500', after: '2,500', matched: true });

    const refused = await driver.editGridCell({ column: 'sku', rowIndex: 1, value: 'X' });
    assert.equal(refused.ok, false);
    assert.match(refused.reason ?? '', /did not enter edit mode/);
    assert.equal(driver.recordedSteps().at(-1)?.ok, false);
  });

  it('picks a row in a dialog, reads the feedback, and closes dialogs', async () => {
    const driver = await runtime.ui();
    await driver.click({ domId: 'open-picker' });
    await driver.pickInModal({ mode: 'exactRow', keyword: 'Tower B' });
    assert.equal(await driver.readFeedback(), 'Picked Tower B');

    await driver.click({ domId: 'open-picker' });
    assert.equal(await driver.closeModal(), true);
    assert.equal(await driver.closeModal(), false);
  });
});
