import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { EvidenceStore } from './evidence-store.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-evidence-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function newStore(runId: string, idPrefix?: string): EvidenceStore {
  return new EvidenceStore({
    scenario: 'orders-list',
    runId,
    webBaseUrl: 'https://shop.example.test',
    rootDir: ROOT,
    runDir: path.join(ROOT, 'evidence', 'orders', 'ui', 'TC-ORD-U01', runId),
    idPrefix,
  });
}

describe('EvidenceStore', () => {
  it('registers items with a root-relative path, sha256 and size', () => {
    const store = newStore('run-hash');
    const item = store.writeAndRegister('screenshot', 'S01.png', Buffer.from('fake-png'), 'Login screen');
    assert.ok(item);
    assert.equal(item.sizeBytes, 8);
    assert.equal(item.contentHash, createHash('sha256').update('fake-png').digest('hex'));
    assert.equal(item.relPath, 'evidence/orders/ui/TC-ORD-U01/run-hash/screenshots/S01.png');
    assert.equal(store.displayDir, 'evidence/orders/ui/TC-ORD-U01/run-hash');
  });

  it('numbers items sequentially with the configured prefix', () => {
    const store = newStore('run-ids', 'E-API');
    store.writeAndRegister('screenshot', 'a.png', 'a', 'A');
    store.writeAndRegister('grid_snapshot', 'b.json', 'b', 'B');
    assert.deepEqual(store.list().map((i) => i.id), ['E-API-01', 'E-API-02']);
    assert.ok(fs.existsSync(path.join(store.dir, 'grid', 'b.json')));
  });

  it('skips missing files and keeps step and assertion links', () => {
    const store = newStore('run-links');
    assert.equal(store.register('video', path.join(store.dir, 'nope.webm'), 'Video'), undefined);
    const item = store.writeAndRegister('screenshot', 'S02.png', 'x', 'Filtered grid', { stepIndex: 3, checkTestId: 'TC-ORD-U01 / A2' });
    assert.equal(item?.stepIndex, 3);
    assert.equal(item?.checkTestId, 'TC-ORD-U01 / A2');
  });

  it('discards a file and its entry', () => {
    const store = newStore('run-discard');
    const keep = store.writeAndRegister('screenshot', 'keep.png', 'k', 'Keep');
    const drop = store.writeAndRegister('video', 'drop.webm', 'd', 'Drop on pass');
    store.discard(drop);
    assert.equal(fs.existsSync(path.join(ROOT, drop!.relPath)), false);
    assert.deepEqual(store.list().map((i) => i.id), [keep!.id]);
  });

  it('writes a schema-versioned manifest into the run directory', () => {
    const store = newStore('run-manifest');
    store.writeAndRegister('screenshot', 'S01.png', 'x', 'Login screen', { stepIndex: 0 });
    const target = store.writeManifest({
      browser: { name: 'chromium', version: '151.0' },
      diagnosticsSummary: { pageErrors: 0, consoleErrors: 0, failedRequests: 0, blockedRequests: 2 },
    });
    assert.equal(target, path.join(store.dir, 'manifest.json'));
    const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.scenario, 'orders-list');
    assert.equal(manifest.webBaseUrl, 'https://shop.example.test');
    assert.equal(manifest.items.length, 1);
    assert.equal(manifest.diagnosticsSummary.blockedRequests, 2);
  });
});
