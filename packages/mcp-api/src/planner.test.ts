import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { OpenApiLoader } from './openapi.js';
import { buildExecutionPlan, type PlannerContext } from './planner.js';
import { BusinessGraph, DomainRegistry, loadDomains, loadEdges } from './registry.js';
import { apiSourcesFromConfig } from './sources.js';
import { FIXTURE_ROOT, SHOP_SPEC, shopProject } from './test-support.test-helper.js';
import type { FieldDependency } from './types.js';

function context(fieldDependencies: FieldDependency[] = []): PlannerContext {
  const env = { SHOP_SPEC_FILE: SHOP_SPEC };
  return {
    domainRegistry: new DomainRegistry(loadDomains(path.join(FIXTURE_ROOT, 'domains'))),
    businessGraph: new BusinessGraph(loadEdges(path.join(FIXTURE_ROOT, 'business-graph.yaml'))),
    apiSources: apiSourcesFromConfig(shopProject().loaded(env)),
    fieldDependencyIndex: new Map(fieldDependencies.map((dep) => [dep.fieldName, dep])),
    openApiLoader: new OpenApiLoader(fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-plan-')), env),
  };
}

test('a planned capability is reported as not implemented instead of fabricating a call', async () => {
  const plan = await buildExecutionPlan('Find customer related documents', context());
  assert.equal(plan.primaryDomain, 'customer');
  const step = plan.steps.find((s) => s.domainId === 'customer');
  assert.equal(step?.status, 'blocked_capability_not_implemented');
  assert.match(step?.warning ?? '', /customer-documents/);
  assert.match(plan.warnings.join(' '), /planned/);
});

test('dependencies come first and missing create inputs are flagged', async () => {
  const issued: string[] = [];
  const plan = await buildExecutionPlan('Create an order', context(), { onToolIssued: (tool) => issued.push(tool.actionId) });
  assert.equal(plan.primaryDomain, 'order');
  assert.deepEqual(new Set(plan.dependentDomains), new Set(['customer', 'product']));

  const sequence = plan.steps.map((s) => s.domainId);
  assert.equal(sequence.indexOf('order'), sequence.length - 1);

  const orderStep = plan.steps.find((s) => s.domainId === 'order');
  assert.equal(orderStep?.operationId, 'createOrder');
  assert.equal(orderStep?.status, 'blocked_missing_input');
  assert.deepEqual(orderStep?.requiredInputs, ['body.customerId', 'body.items']);
  assert.ok(issued.includes('shop::POST::/api/orders'), 'every selected tool is issued so it can be executed');
});

test('a field dependency resolves a required input through its lookup step', async () => {
  const plan = await buildExecutionPlan(
    'Create an order',
    context([
      { fieldName: 'customerId', resource: 'Customer', repo: 'shop-service', domainId: 'customer', apiSourceId: 'shop', lookupMethod: 'GET', lookupPath: '/api/customers/{id}', confidence: 'inferred' },
    ]),
  );
  const customerStep = plan.steps.find((s) => s.domainId === 'customer');
  assert.equal(customerStep?.operationId, 'getCustomer');
  assert.deepEqual(customerStep?.producedOutputs, ['customerId']);
  assert.ok(!plan.missingInputs.includes('body.customerId'));
  assert.ok(plan.missingInputs.includes('body.items'));
});

test('an unmatched task yields an empty plan with a warning', async () => {
  const plan = await buildExecutionPlan('xyzzy plugh nonsense', context());
  assert.equal(plan.primaryDomain, undefined);
  assert.deepEqual(plan.steps, []);
  assert.match(plan.warnings[0] ?? '', /Could not confidently match/);
});
