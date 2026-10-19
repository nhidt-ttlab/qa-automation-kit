import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { ActionRegistry, BusinessGraph, DomainRegistry, loadDomains, loadEdges, loadFieldDependencies } from './registry.js';
import { FIXTURE_ROOT } from './test-support.test-helper.js';
import type { Tool } from './types.js';

const tool: Tool = {
  actionId: 'shop::GET::/api/orders/{id}',
  operationId: 'getOrder',
  httpMethod: 'GET',
  path: '/api/orders/{id}',
  domainId: 'order',
  apiSourceId: 'shop',
  summary: 'Get an order by id',
  intentKeywords: ['Order'],
  requiresAuth: true,
};

test('loads every domain file and searches across capabilities', () => {
  const registry = new DomainRegistry(loadDomains(path.join(FIXTURE_ROOT, 'domains')));
  assert.deepEqual(registry.list().map((d) => d.id).sort(), ['customer', 'order', 'product']);
  assert.deepEqual(registry.searchByKeyword('new order').map((d) => d.id), ['order']);
  assert.equal(registry.searchByKeyword('   ').length, 3);
  assert.equal(registry.get('nope'), undefined);
  assert.equal(registry.has('nope'), false);
});

test('missing folders and files load as empty rather than failing', () => {
  assert.deepEqual(loadDomains(undefined), []);
  assert.deepEqual(loadEdges(path.join(FIXTURE_ROOT, 'nope.yaml')), []);
  assert.deepEqual(loadFieldDependencies(undefined), []);
});

test('the business graph resolves closures and sorts dependencies first', () => {
  const graph = new BusinessGraph(loadEdges(path.join(FIXTURE_ROOT, 'business-graph.yaml')));
  assert.deepEqual(new Set(graph.resolveTransitiveClosure('order')), new Set(['customer', 'product']));
  const sorted = graph.topoSort(['order']);
  assert.ok(sorted.indexOf('customer') < sorted.indexOf('order'));
  assert.ok(sorted.indexOf('product') < sorted.indexOf('order'));
  assert.equal(graph.getEdges('customer', 'downstream').length, 1);
});

test('the business graph throws on a cycle', () => {
  const graph = new BusinessGraph([
    { from: 'a', to: 'b', relation: 'requires', level: 'domain', description: '', confidence: 'unknown' },
    { from: 'b', to: 'a', relation: 'requires', level: 'domain', description: '', confidence: 'unknown' },
  ]);
  assert.throws(() => graph.topoSort(['a']), /Cycle detected/);
});

test('the action registry resolves issued ids only, until they expire', async () => {
  const registry = new ActionRegistry();
  registry.register(tool);
  assert.deepEqual(registry.resolve(tool.actionId), tool);
  assert.equal(registry.resolve('never-issued'), undefined);

  const short = new ActionRegistry(1);
  short.register(tool);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(short.resolve(tool.actionId), undefined);
});
