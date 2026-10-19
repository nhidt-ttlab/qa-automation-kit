import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { generateSwaggerDocs } from './docgen.js';
import { DomainFileMappingSchema } from './domain-file-mapping.js';
import { bootstrapDomainsFromOpenApi, generateDomainsFromMetadata, generateFieldDependencies, writeDomainFiles } from './generators.js';
import type { OpenApiDocument } from './openapi.js';
import { loadDomains } from './registry.js';
import { FIXTURE_ROOT, SHOP_SPEC } from './test-support.test-helper.js';

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function treeHash(dir: string): string {
  const hash = createHash('sha1');
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else hash.update(p).update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function docgen(outputRoot: string) {
  return generateSwaggerDocs({
    sources: [
      { id: 'shop', repository: 'shop-service', requiresAuth: true },
      { id: 'billing', repository: 'billing-service', requiresAuth: false },
    ],
    domains: loadDomains(path.join(FIXTURE_ROOT, 'domains')),
    swaggerDir: path.dirname(SHOP_SPEC),
    outputRoot,
    env: {},
  });
}

test('docgen writes per-tag metadata, docs and override stubs, and is idempotent', () => {
  const outputRoot = tmp('qakit-docgen-');
  const result = docgen(outputRoot);
  assert.deepEqual(result.missingSwaggerFiles, ['billing']);
  assert.equal(result.endpointsWritten, 8);

  const orderYaml = fs.readFileSync(path.join(outputRoot, 'metadata', 'generated', 'shop-service', 'order.yaml'), 'utf8');
  assert.match(orderYaml, /gateway_domain: order/);
  assert.match(orderYaml, /dto: CreateOrderDto/);
  assert.match(orderYaml, /evidence:\n\s+- swagger_file:shop.swagger.json/);
  assert.ok(fs.existsSync(path.join(outputRoot, 'docs', 'shop-service', 'order.md')));
  assert.ok(fs.existsSync(path.join(outputRoot, 'metadata', 'manual-overrides', 'shop-service', 'customer.yaml')));

  const before = treeHash(outputRoot);
  docgen(outputRoot);
  assert.equal(treeHash(outputRoot), before);
});

test('domains bootstrap from OpenAPI tags, one capability per operation', () => {
  const spec = JSON.parse(fs.readFileSync(SHOP_SPEC, 'utf8')) as OpenApiDocument;
  const domains = bootstrapDomainsFromOpenApi([{ sourceId: 'shop', document: spec }]);
  assert.deepEqual(domains.map((d) => d.id), ['customer', 'order', 'product']);
  const order = domains.find((d) => d.id === 'order')!;
  assert.deepEqual(order.apiSourceIds, ['shop']);
  assert.deepEqual(order.capabilities.map((c) => c.id), ['list-orders', 'create-order', 'get-order', 'delete-order', 'search-orders']);
  assert.equal(order.confidence, 'inferred');

  const dir = tmp('qakit-domains-');
  fs.writeFileSync(path.join(dir, 'order.yaml'), 'hand: written\n');
  const { written, skipped } = writeDomainFiles(domains, dir);
  assert.equal(written.length, 2);
  assert.deepEqual(skipped.map((f) => path.basename(f)), ['order.yaml']);
  assert.equal(fs.readFileSync(path.join(dir, 'order.yaml'), 'utf8'), 'hand: written\n', 'existing files are kept');
  fs.rmSync(path.join(dir, 'order.yaml'));
  assert.equal(loadDomains(dir).length, 2, 'what it writes loads back as domains');
});

test('domains regenerate from docgen metadata and the mapping', () => {
  const metadataRoot = tmp('qakit-metadata-');
  docgen(metadataRoot);
  const mapping = DomainFileMappingSchema.parse({
    version: 1,
    existingDomainFiles: { order: ['shop-service/order'] },
    newDomains: [
      { id: 'people', displayName: 'People', description: 'Customers.', tier: 'a', apiSourceIds: ['shop'], files: ['shop-service/customer'] },
      { id: 'catalogue', displayName: 'Catalogue', description: 'Products.', tier: 'b', apiSourceIds: ['shop'], files: ['shop-service/product'] },
    ],
  });
  const domainsDir = tmp('qakit-regen-');
  const results = generateDomainsFromMetadata({ metadataRoot, mapping, domainsDir, log: () => {} });
  assert.deepEqual(results.map((r) => [r.id, r.capabilities.map((c) => c.id)]), [
    ['people', ['manage-customer']],
    // The path segment is the plural `products`, so it is a leftover suffix of the `product` file.
    ['catalogue', ['products-product']],
  ]);
  assert.deepEqual(loadDomains(domainsDir).map((d) => d.id).sort(), ['catalogue', 'people']);

  const orphanMapping = DomainFileMappingSchema.parse({ version: 1, newDomains: [mapping.newDomains[0]] });
  assert.throws(() => generateDomainsFromMetadata({ metadataRoot, mapping: orphanMapping, domainsDir, log: () => {} }), /Unmapped/);
});

test('field dependencies resolve same-repository references and skip the rest', () => {
  const metadataRoot = tmp('qakit-fielddeps-');
  const dir = path.join(metadataRoot, 'metadata', 'generated', 'shop-service');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'dto-reference-graph.json'),
    JSON.stringify({
      repo: 'shop-service',
      endpointsById: { e1: { id: 'e1', method: 'GET', path: '/api/customers/{id}', tag: 'Customer' } },
      resourceIndex: {
        Customer: { name: 'Customer', referencedByFields: [{ dto: 'CreateOrderDto', field: 'customerId', ambiguous: false }, { dto: 'X', field: 'customerCode', ambiguous: true }], candidateEndpoints: ['e1'] },
        Supplier: { name: 'Supplier', referencedByFields: [{ dto: 'Y', field: 'supplierId', ambiguous: false }], candidateEndpoints: [] },
      },
    }),
  );
  const mapping = DomainFileMappingSchema.parse({ version: 1, existingDomainFiles: { customer: ['shop-service/customer'] }, newDomains: [] });
  const warnings: string[] = [];
  const entries = generateFieldDependencies(metadataRoot, mapping, [{ id: 'shop', repository: 'shop-service' }], (w) => warnings.push(w));
  assert.deepEqual(entries, [
    { fieldName: 'customerId', resource: 'Customer', repo: 'shop-service', domainId: 'customer', apiSourceId: 'shop', lookupMethod: 'GET', lookupPath: '/api/customers/{id}', confidence: 'inferred' },
  ]);
  assert.deepEqual(generateFieldDependencies(tmp('qakit-empty-'), mapping, []), []);
  assert.deepEqual(parse(stringify({ entries })).entries, entries);
});
