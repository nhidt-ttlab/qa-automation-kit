import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { OpenApiLoader, buildToolCandidates, readFromCache, scoreIntentMatch, tokenize, writeToCache, type OpenApiDocument } from './openapi.js';
import type { ApiSource } from './sources.js';
import { SHOP_SPEC } from './test-support.test-helper.js';

const spec = JSON.parse(fs.readFileSync(SHOP_SPEC, 'utf8')) as OpenApiDocument;
const shop = { id: 'shop', requiresAuth: true };

test('tokenize strips plurals without mangling short or false-plural words', () => {
  assert.deepEqual(tokenize('projects'), ['project']);
  assert.deepEqual(tokenize('categories'), ['category']);
  assert.deepEqual(tokenize('statuses'), ['status']);
  assert.deepEqual(tokenize('status'), ['status']);
  assert.deepEqual(tokenize('this has gas'), ['this', 'has', 'gas']);
  assert.deepEqual(tokenize('address'), ['address']);
  assert.equal(scoreIntentMatch('list projects', ['project']), 1);
});

test('ranks the create operation top for a matching intent and resolves its $refs', () => {
  const { tools, totalCandidates, truncated } = buildToolCandidates(spec, 'order', shop, 'create order');
  assert.equal(totalCandidates, 8);
  assert.equal(truncated, false);
  assert.equal(tools[0]?.operationId, 'createOrder');
  assert.equal(tools[0]?.requiresAuth, true);
  assert.equal(tools[0]?.actionId, 'shop::POST::/api/orders');
  const body = tools[0]?.inputSchema?.requestBody as { content: Record<string, { schema: { required: string[] } }> };
  assert.deepEqual(body.content['application/json']?.schema.required, ['customerId', 'items']);
});

test('truncates to maxTools and mints stable ids', () => {
  const { tools, truncated } = buildToolCandidates(spec, 'order', shop, undefined, { maxTools: 2 });
  assert.equal(tools.length, 2);
  assert.equal(truncated, true);
  assert.equal(buildToolCandidates(spec, 'order', shop, 'get order').tools[0]?.actionId, buildToolCandidates(spec, 'order', shop, 'get order').tools[0]?.actionId);
});

test('ranks the bare collection above a deeper lookup when no metadata is authored', () => {
  const bare: OpenApiDocument = { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: { '/api/app/project/status-list': { get: {} }, '/api/app/project': { get: {} } } } as never;
  const { tools } = buildToolCandidates(bare, 'project', shop, 'get list of projects with paging and filter by name');
  assert.equal(tools[0]?.path, '/api/app/project');
  assert.equal(tools[0]?.operationId, 'GET /api/app/project');

  const authored: OpenApiDocument = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: { '/api/app/project': { get: {} }, '/api/app/project/status-list': { get: { summary: 'List available project statuses', tags: ['ProjectStatus'] } } },
  } as never;
  assert.equal(buildToolCandidates(authored, 'project', shop, 'list project statuses').tools[0]?.path, '/api/app/project/status-list');
});

const source = (overrides: Partial<ApiSource> = {}): ApiSource => ({
  id: 'shop',
  configId: 'shop',
  repository: 'shop-service',
  requiresAuth: true,
  baseUrl: () => 'https://shop.example.test',
  specUrl: () => 'https://shop.example.test/openapi.json',
  specFileEnv: 'SHOP_SPEC_FILE',
  cacheTtlSeconds: 3600,
  credentialEnvNames: ['SHOP_TOKEN'],
  ...overrides,
});

test('the loader prefers the local override, then the cache, then the network', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-openapi-'));
  let fetched = 0;
  const fakeFetch = (async () => {
    fetched += 1;
    return new Response(JSON.stringify(spec), { status: 200 });
  }) as typeof fetch;

  const override = await new OpenApiLoader(cacheDir, { SHOP_SPEC_FILE: SHOP_SPEC }, fakeFetch).get(source());
  assert.equal(override.cacheInfo.source, 'override');
  assert.equal(fetched, 0);

  const loader = new OpenApiLoader(cacheDir, {}, fakeFetch);
  assert.equal((await loader.get(source())).cacheInfo.source, 'network');
  assert.equal((await loader.get(source())).cacheInfo.source, 'cache');
  assert.equal((await loader.get(source(), { forceRefresh: true })).cacheInfo.source, 'network');
  assert.equal(fetched, 2);
});

test('the disk cache expires after its TTL', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-openapi-cache-'));
  writeToCache(cacheDir, 'shop', spec);
  assert.notEqual(readFromCache(cacheDir, 'shop', 3600), null);
  const stale = new Date(Date.now() - 10_000);
  fs.utimesSync(path.join(cacheDir, 'shop.json'), stale, stale);
  assert.equal(readFromCache(cacheDir, 'shop', 5), null);
});
