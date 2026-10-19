import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStubResult, checkWriteGate, executeLive, type WriteGateOptions } from './executor.js';
import type { ApiSource } from './sources.js';
import type { Tool } from './types.js';

const source: ApiSource = {
  id: 'shop',
  configId: 'shop',
  repository: 'shop-service',
  requiresAuth: true,
  baseUrl: () => 'https://shop.example.test',
  specUrl: () => 'https://shop.example.test/openapi.json',
  cacheTtlSeconds: 3600,
  credentialEnvNames: ['SHOP_USER', 'SHOP_PASSWORD'],
};

const tool = (overrides: Partial<Tool> = {}): Tool => ({
  actionId: 'shop::GET::/api/orders/{id}',
  operationId: 'getOrder',
  httpMethod: 'GET',
  path: '/api/orders/{id}',
  domainId: 'order',
  apiSourceId: 'shop',
  summary: 'Get an order by id',
  intentKeywords: [],
  requiresAuth: true,
  ...overrides,
});

test('a stub explains what would be called and never carries a token', () => {
  const stub = buildStubResult(source, tool(), { pathParams: { id: '42' } });
  assert.equal(stub.mode, 'stub');
  assert.equal(stub.wouldCall.url, 'https://shop.example.test/api/orders/42');
  assert.equal(stub.wouldCall.headers['Authorization'], 'Bearer <redacted, not set>');
  assert.match(stub.explanation, /SHOP_USER \/ SHOP_PASSWORD/);
});

test('a live call substitutes path params, adds credentials, and parses JSON', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (url: URL, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: '42' }), { status: 200 });
  }) as unknown as typeof fetch;

  const result = await executeLive(source, tool(), { pathParams: { id: '4 2' }, query: { expand: true } }, async () => ({ headers: { Authorization: 'Bearer t' }, query: { key: 'k' } }), fakeFetch);
  assert.deepEqual(result, { mode: 'live', ok: true, status: 200, data: { id: '42' } });
  assert.equal(seen[0]?.url, 'https://shop.example.test/api/orders/4%202?expand=true&key=k');
  assert.equal((seen[0]?.init.headers as Record<string, string>).Authorization, 'Bearer t');
  assert.equal(seen[0]?.init.body, undefined);
});

test('a non-2xx response and a thrown error both come back as ok:false', async () => {
  const notFound = (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch;
  assert.deepEqual(await executeLive(source, tool(), {}, async () => ({ headers: {}, query: {} }), notFound), { mode: 'live', ok: false, status: 404, data: 'missing' });

  const failing = await executeLive(source, tool(), {}, async () => {
    throw new Error('login failed');
  });
  assert.deepEqual(failing, { mode: 'live', ok: false, status: 0, error: 'login failed' });
});

const gate = (overrides: Partial<WriteGateOptions> = {}): WriteGateOptions => ({
  allowWrites: false,
  readOnlyPostPatterns: [/\/search$/],
  destructiveOperations: /delete|cancel|approve/i,
  ...overrides,
});

test('reads always pass the write gate', () => {
  assert.deepEqual(checkWriteGate(tool(), undefined, gate()), { allowed: true });
  assert.deepEqual(checkWriteGate(tool({ httpMethod: 'POST', path: '/api/orders/search' }), undefined, gate()), { allowed: true }, 'declared POST lookups read');
});

test('writes are refused while writes are disabled', () => {
  const decision = checkWriteGate(tool({ httpMethod: 'POST', path: '/api/orders', operationId: 'createOrder', summary: 'Create an order' }), true, gate());
  assert.equal(decision.allowed, false);
  assert.match(decision.allowed ? '' : decision.reason, /writes are disabled/);
});

test('a destructive operation needs confirm even with writes enabled', () => {
  const del = tool({ httpMethod: 'DELETE', operationId: 'deleteOrder', summary: 'Delete an order' });
  assert.equal(checkWriteGate(del, undefined, gate({ allowWrites: true })).allowed, false);
  assert.equal(checkWriteGate(del, true, gate({ allowWrites: true })).allowed, true);

  const approve = tool({ httpMethod: 'POST', path: '/api/orders/{id}/approve', operationId: 'approveOrder', summary: 'Approve' });
  assert.equal(checkWriteGate(approve, false, gate({ allowWrites: true })).allowed, false);
  assert.equal(checkWriteGate(tool({ httpMethod: 'POST', path: '/api/orders', operationId: 'createOrder', summary: 'Create' }), undefined, gate({ allowWrites: true })).allowed, true);
});
