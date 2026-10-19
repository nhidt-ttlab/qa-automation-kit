import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RequestTraceEntry } from '@qakit/core';
import { mergeTraces } from './network-recorder.js';

function entry(timestamp: string, url: string, sourceId = 'erp-api'): RequestTraceEntry {
  return { timestamp, sourceId, method: 'GET', url, status: 200 };
}

test('mergeTraces interleaves API and browser traces by timestamp', () => {
  const api = [entry('2026-08-28T10:00:00.000Z', '/api/a'), entry('2026-08-28T10:00:02.000Z', '/api/c')];
  const ui = [entry('2026-08-28T10:00:01.000Z', '/api/b', 'web-ui')];

  assert.deepEqual(
    mergeTraces(api, ui).map((e) => e.url),
    ['/api/a', '/api/b', '/api/c'],
  );
});

test('mergeTraces keeps same-timestamp entries in argument order', () => {
  const t = '2026-08-28T10:00:00.000Z';
  const api = [entry(t, '/api/first')];
  const ui = [entry(t, '/api/second', 'web-ui')];

  assert.deepEqual(
    mergeTraces(api, ui).map((e) => e.url),
    ['/api/first', '/api/second'],
  );
});

test('mergeTraces tolerates an empty browser trace', () => {
  const api = [entry('2026-08-28T10:00:00.000Z', '/api/a')];
  assert.deepEqual(mergeTraces(api, []), api);
  assert.deepEqual(mergeTraces([], []), []);
});
