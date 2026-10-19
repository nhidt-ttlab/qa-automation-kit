import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApiMcpServer, parseApiArgs, runApiToolsCli } from './cli.js';
import { apiMcpContextOptionsFromConfig, createApiMcpContext, type ApiMcpContext } from './context.js';
import { SHOP_SPEC, shopProject } from './test-support.test-helper.js';

describe('API MCP server end to end', () => {
  const project = shopProject("  readOnlyPostPatterns: ['/search$']");
  const requests: Array<{ url: string; method: string; auth?: string }> = [];
  let ctx: ApiMcpContext;
  let client: Client;

  const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    return result.isError ? { isError: true, text } : JSON.parse(text);
  };

  before(async () => {
    const env = { SHOP_SPEC_FILE: SHOP_SPEC, SHOP_TOKEN: 'secret-token' };
    const fakeFetch = (async (url: URL, init: RequestInit) => {
      requests.push({ url: String(url), method: String(init.method), auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ id: '42', status: 'open' }), { status: 200 });
    }) as unknown as typeof fetch;
    ctx = createApiMcpContext({ ...apiMcpContextOptionsFromConfig(project.loaded(env), env), fetchImpl: fakeFetch });
    const server = createApiMcpServer(ctx, { name: 'shop-api-mcp' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  after(async () => {
    await client?.close();
    fs.rmSync(project.dir, { recursive: true, force: true });
  });

  it('lists the five tools', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['discover_domains', 'resolve_domain_dependencies', 'load_domain_api_registry', 'plan_task', 'execute_api_action']);
  });

  it('discovers, plans and executes a read live with the source credentials', async () => {
    assert.deepEqual((await call('discover_domains', { keyword: 'crm' })).map((d: { id: string }) => d.id), ['customer']);
    assert.deepEqual((await call('resolve_domain_dependencies', { domainId: 'order' })).transitiveClosure.sort(), ['customer', 'product']);
    assert.match((await call('resolve_domain_dependencies', { domainId: 'nope' })).text, /Unknown domainId/);

    const registry = await call('load_domain_api_registry', { domainId: 'order', intent: 'get order' });
    const getOrder = registry.tools.find((t: { operationId: string }) => t.operationId === 'getOrder');
    const live = await call('execute_api_action', { actionId: getOrder.actionId, pathParams: { id: '42' }, reason: 'read one order' });
    assert.deepEqual(live, { mode: 'live', ok: true, status: 200, data: { id: '42', status: 'open' } });
    assert.deepEqual(requests.at(-1), { url: 'https://shop.example.test/api/orders/42', method: 'GET', auth: 'Bearer secret-token' });

    const plan = await call('plan_task', { task: 'Create an order' });
    assert.equal(plan.primaryDomain, 'order');
  });

  it('refuses writes, lets declared POST lookups through, and audits every execution', async () => {
    const registry = await call('load_domain_api_registry', { domainId: 'order', intent: 'order', maxTools: 10 });
    const byOp = (op: string) => registry.tools.find((t: { operationId: string }) => t.operationId === op).actionId;
    const sent = requests.length;

    const denied = await call('execute_api_action', { actionId: byOp('createOrder'), body: { customerId: 'c1', items: ['p1'], password: 'hunter2' } });
    assert.equal(denied.mode, 'denied');
    assert.equal(denied.wouldCall.url, 'https://shop.example.test/api/orders');
    assert.equal((await call('execute_api_action', { actionId: byOp('deleteOrder'), pathParams: { id: '42' }, confirm: true })).mode, 'denied');
    assert.equal(requests.length, sent, 'nothing was sent');

    assert.equal((await call('execute_api_action', { actionId: byOp('searchOrders'), body: {} })).mode, 'live');
    assert.match((await call('execute_api_action', { actionId: 'shop::GET::/never-issued' })).text, /Unknown or expired actionId/);

    const audit = fs.readFileSync(ctx.audit.path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { outcome: string; detail?: { mode?: string } });
    assert.deepEqual(audit.map((e) => `${e.outcome}:${e.detail?.mode ?? '-'}`), ['ok:live', 'denied:denied', 'denied:denied', 'ok:live', 'denied:-']);
    assert.ok(!fs.readFileSync(ctx.audit.path, 'utf8').includes('hunter2'), 'request bodies are redacted in the audit log');
  });

  it('stubs a call when the source has no credentials', async () => {
    const env = { SHOP_SPEC_FILE: SHOP_SPEC };
    const bare = createApiMcpContext(apiMcpContextOptionsFromConfig(project.loaded(env), env));
    const server = createApiMcpServer(bare, { name: 'shop-api-mcp' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const other = new Client({ name: 'test', version: '0.0.0' });
    await other.connect(a);
    const registry = JSON.parse(((await other.callTool({ name: 'load_domain_api_registry', arguments: { domainId: 'customer', intent: 'list customers' } })).content as Array<{ text: string }>)[0]!.text);
    const stub = JSON.parse(((await other.callTool({ name: 'execute_api_action', arguments: { actionId: registry.tools[0].actionId } })).content as Array<{ text: string }>)[0]!.text);
    assert.equal(stub.mode, 'stub');
    assert.match(stub.explanation, /SHOP_TOKEN/);
    await other.close();
  });
});

describe('qakit-api CLI', () => {
  it('parses options and rejects unknown flags', () => {
    const parsed = parseApiArgs(['--config=a.yaml', '--env', 'uat', '--dry-run'], ['--dry-run']);
    assert.equal(parsed.configPath, 'a.yaml');
    assert.equal(parsed.environment, 'uat');
    assert.ok(parsed.flags.has('--dry-run'));
    assert.throws(() => parseApiArgs(['--nope']), /Unknown argument/);
  });

  it('runs docgen from the config', async () => {
    const project = shopProject();
    const log = console.log;
    console.log = () => {};
    try {
      assert.equal(await runApiToolsCli(['docgen', '--config', path.join(project.dir, 'qakit.config.yaml')]), 0);
    } finally {
      console.log = log;
    }
    assert.ok(fs.existsSync(path.join(project.dir, 'generated', 'metadata', 'generated', 'shop-service', 'order.yaml')));
    const error = console.error;
    console.error = () => {};
    try {
      assert.equal(await runApiToolsCli(['bogus']), 1);
    } finally {
      console.error = error;
    }
  });
});
