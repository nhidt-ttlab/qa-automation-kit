import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ApiMcpContext } from './context.js';
import { buildRequestUrl, buildStubResult, checkWriteGate, executeLive, type ExecutionResult } from './executor.js';
import { buildToolCandidates } from './openapi.js';
import { buildExecutionPlan } from './planner.js';

export const DiscoverDomainsInputSchema = z.object({
  keyword: z.string().optional(),
});

export const ResolveDomainDependenciesInputSchema = z.object({
  domainId: z.string(),
  direction: z.enum(['upstream', 'downstream', 'both']).default('both'),
});

export const LoadDomainApiRegistryInputSchema = z.object({
  domainId: z.string(),
  intent: z.string().optional(),
  maxTools: z.number().int().positive().max(50).default(8),
  forceRefresh: z.boolean().default(false),
});

export const PlanTaskInputSchema = z.object({
  task: z.string(),
  knownInputs: z.record(z.string(), z.unknown()).default({}),
  maxDomains: z.number().int().positive().max(10).default(3),
});

// Deliberately no `path` / `httpMethod` fields — a caller can only ever invoke an actionId that
// discovery or planning already surfaced, never an arbitrary backend route.
export const ExecuteApiActionInputSchema = z.object({
  actionId: z.string(),
  pathParams: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
  planStepId: z.string().optional(),
  confirm: z.boolean().optional().describe('Required for destructive operations, once the user has approved this exact call'),
  reason: z.string().optional().describe('Why this call — recorded in the audit log'),
});

export function discoverDomains(ctx: ApiMcpContext, input: z.infer<typeof DiscoverDomainsInputSchema>) {
  const domains = input.keyword ? ctx.domainRegistry.searchByKeyword(input.keyword) : ctx.domainRegistry.list();
  return domains.map((domain) => ({
    id: domain.id,
    displayName: domain.displayName,
    description: domain.description,
    capabilities: domain.capabilities,
    dependsOn: domain.dependsOn,
    apiSources: domain.apiSourceIds,
    status: domain.status,
  }));
}

export function resolveDomainDependencies(ctx: ApiMcpContext, input: z.infer<typeof ResolveDomainDependenciesInputSchema>) {
  if (!ctx.domainRegistry.has(input.domainId)) throw new Error(`Unknown domainId "${input.domainId}". Call discover_domains first.`);
  return {
    domainId: input.domainId,
    edges: ctx.businessGraph.getEdges(input.domainId, input.direction),
    transitiveClosure: ctx.businessGraph.resolveTransitiveClosure(input.domainId),
  };
}

export async function loadDomainApiRegistry(ctx: ApiMcpContext, input: z.infer<typeof LoadDomainApiRegistryInputSchema>) {
  const domain = ctx.domainRegistry.get(input.domainId);
  if (!domain) throw new Error(`Unknown domainId "${input.domainId}". Call discover_domains first.`);

  const tools = [];
  const cacheInfos = [];
  let truncated = false;
  for (const apiSourceId of domain.apiSourceIds) {
    const apiSource = ctx.apiSources.get(apiSourceId);
    if (!apiSource) throw new Error(`Domain "${input.domainId}" references unknown apiSourceId "${apiSourceId}".`);
    const { document, cacheInfo } = await ctx.openApiLoader.get(apiSource, { forceRefresh: input.forceRefresh });
    const result = buildToolCandidates(document, input.domainId, apiSource, input.intent, { maxTools: input.maxTools });
    ctx.actionRegistry.registerAll(result.tools);
    tools.push(...result.tools);
    cacheInfos.push({ apiSourceId, ...cacheInfo });
    truncated = truncated || result.truncated;
  }
  return { domainId: input.domainId, tools, cacheInfo: cacheInfos, truncated };
}

export async function planTask(ctx: ApiMcpContext, input: z.infer<typeof PlanTaskInputSchema>) {
  return buildExecutionPlan(input.task, ctx, {
    knownInputs: input.knownInputs,
    maxDomains: input.maxDomains,
    onToolIssued: (tool) => ctx.actionRegistry.register(tool),
  });
}

const TOOL = 'execute_api_action';

/**
 * Runs an issued actionId: a stub when the source has no credentials, a denial when the write gate
 * refuses, otherwise a live call. Every outcome is written to the audit log.
 */
export async function executeApiAction(ctx: ApiMcpContext, input: z.infer<typeof ExecuteApiActionInputSchema>): Promise<ExecutionResult> {
  const tool = ctx.actionRegistry.resolve(input.actionId);
  if (!tool) {
    const message = `Unknown or expired actionId "${input.actionId}". Call load_domain_api_registry or plan_task again to get a fresh one.`;
    ctx.audit.record({ tool: TOOL, input, reason: input.reason, outcome: 'denied', denyReason: message });
    throw new Error(message);
  }
  const apiSource = ctx.apiSources.get(tool.apiSourceId);
  if (!apiSource) throw new Error(`Tool "${tool.actionId}" references unknown apiSourceId "${tool.apiSourceId}".`);

  const params = { pathParams: input.pathParams, query: input.query, body: input.body };
  const provider = ctx.authProviders.get(apiSource.configId);
  const detail = { method: tool.httpMethod, path: tool.path, apiSourceId: apiSource.id };

  if (tool.requiresAuth && !(provider?.isConfigured() ?? false)) {
    const stub = buildStubResult(apiSource, tool, params);
    ctx.audit.record({ tool: TOOL, input, reason: input.reason, outcome: 'ok', detail: { ...detail, mode: 'stub' } });
    return stub;
  }

  const gate = checkWriteGate(tool, input.confirm, ctx.writeGate);
  if (!gate.allowed) {
    ctx.audit.record({ tool: TOOL, input, reason: input.reason, outcome: 'denied', denyReason: gate.reason, detail: { ...detail, mode: 'denied' } });
    return { mode: 'denied', reason: gate.reason, hint: gate.hint, wouldCall: { method: tool.httpMethod, url: buildRequestUrl(apiSource, tool, params), body: params.body } };
  }

  const startedAt = Date.now();
  const result = await executeLive(apiSource, tool, params, async () => (provider ? provider.authorize() : { headers: {}, query: {} }), ctx.fetchImpl);
  ctx.audit.record({
    tool: TOOL,
    input,
    reason: input.reason,
    outcome: result.ok ? 'ok' : 'error',
    denyReason: result.error,
    durationMs: Date.now() - startedAt,
    detail: { ...detail, mode: 'live', status: result.status },
  });
  return result;
}

const asToolResult = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

export function registerApiTools(server: McpServer, ctx: ApiMcpContext): void {
  server.tool(
    'discover_domains',
    'Discover known business domains, optionally filtered by keyword. No network calls.',
    DiscoverDomainsInputSchema.shape,
    async (input) => asToolResult(discoverDomains(ctx, input)),
  );
  server.tool(
    'resolve_domain_dependencies',
    'Resolve the cross-domain dependency edges and transitive closure for a domain.',
    ResolveDomainDependenciesInputSchema.shape,
    async (input) => asToolResult(resolveDomainDependencies(ctx, input)),
  );
  server.tool(
    'load_domain_api_registry',
    "Lazily load and rank a domain's OpenAPI operations against an intent, without loading the full swagger surface.",
    LoadDomainApiRegistryInputSchema.shape,
    async (input) => asToolResult(await loadDomainApiRegistry(ctx, input)),
  );
  server.tool(
    'plan_task',
    'Compose domain discovery, dependency resolution, and API registry loading into an ordered execution plan for a free-text task.',
    PlanTaskInputSchema.shape,
    async (input) => asToolResult(await planTask(ctx, input)),
  );
  server.tool(
    'execute_api_action',
    'Execute a previously issued actionId (from load_domain_api_registry or plan_task). Runs live if credentials are configured, ' +
      'otherwise returns a stub of what would be called. A call that changes data is refused unless writes are enabled for this ' +
      'server, and a destructive one also needs confirm: true. Every call is audited.',
    ExecuteApiActionInputSchema.shape,
    async (input) => asToolResult(await executeApiAction(ctx, input)),
  );
}
