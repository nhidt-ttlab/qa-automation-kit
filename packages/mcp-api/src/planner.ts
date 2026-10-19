import { buildToolCandidates, scoreIntentMatch, type OpenApiLoader } from './openapi.js';
import type { BusinessGraph, DomainRegistry } from './registry.js';
import type { ApiSource } from './sources.js';
import { ExecutionPlanSchema, type Domain, type ExecutionPlan, type FieldDependency, type PlanStep, type PlanStepStatus, type Tool } from './types.js';

export interface DomainRanking {
  domainId: string;
  score: number;
}

/** Ranks known domains by free-text overlap with a task description. No network, no I/O. */
export function rankDomainsForTask(task: string, domains: Domain[]): DomainRanking[] {
  return domains
    .map((domain) => ({
      domainId: domain.id,
      score: scoreIntentMatch(task, [
        domain.id,
        domain.displayName,
        domain.description,
        ...domain.tags,
        ...domain.capabilities.map((c) => `${c.id} ${c.summary}`),
      ]),
    }))
    .sort((a, b) => b.score - a.score);
}

export interface PlannerContext {
  domainRegistry: DomainRegistry;
  businessGraph: BusinessGraph;
  apiSources: Map<string, ApiSource>;
  /** fieldName (bare, no "body." prefix) -> where/how to look up the resource it references. */
  fieldDependencyIndex: Map<string, FieldDependency>;
  openApiLoader: OpenApiLoader;
}

export interface BuildExecutionPlanOptions {
  knownInputs?: Record<string, unknown>;
  maxDomains?: number;
  /** Called for every Tool candidate selected into the plan, so callers can register its actionId. */
  onToolIssued?: (tool: Tool) => void;
}

const bareFieldName = (field: string): string => (field.startsWith('body.') ? field.slice('body.'.length) : field);

function deriveRequiredInputs(inputSchema: Record<string, unknown> | undefined): string[] {
  if (!inputSchema) return [];
  const required: string[] = [];

  const parameters = Array.isArray(inputSchema.parameters) ? inputSchema.parameters : [];
  for (const param of parameters) {
    if (param && typeof param === 'object') {
      const p = param as Record<string, unknown>;
      if (p.required === true && typeof p.name === 'string') required.push(p.name);
    }
  }

  const requestBody = inputSchema.requestBody as Record<string, unknown> | undefined;
  const jsonContent = (requestBody?.content as Record<string, unknown> | undefined)?.['application/json'] as Record<string, unknown> | undefined;
  const schema = jsonContent?.schema as Record<string, unknown> | undefined;
  if (schema && Array.isArray(schema.required)) {
    for (const field of schema.required) if (typeof field === 'string') required.push(`body.${field}`);
  }
  return required;
}

/**
 * Best-effort peek at the primary domain's chosen tool, purely to discover which of its required
 * fields are known foreign-key references (via fieldDependencyIndex) and which domain resolves each
 * — so those domains can be inserted ahead of the primary step. Failures are swallowed; the main
 * loop re-attempts the same fetch for the primary domain and surfaces any real error there.
 */
async function peekPrimaryTool(primaryDomain: string, task: string, ctx: PlannerContext): Promise<Tool | undefined> {
  const domain = ctx.domainRegistry.get(primaryDomain);
  const apiSourceId = domain?.apiSourceIds[0];
  const apiSource = apiSourceId ? ctx.apiSources.get(apiSourceId) : undefined;
  if (!domain || !apiSource) return undefined;
  try {
    const { document } = await ctx.openApiLoader.get(apiSource);
    return buildToolCandidates(document, primaryDomain, apiSource, task, { maxTools: 8 }).tools[0];
  } catch {
    return undefined;
  }
}

/** Turns a free-text task into ordered, actionable steps across the domains it touches. */
export async function buildExecutionPlan(task: string, ctx: PlannerContext, opts: BuildExecutionPlanOptions = {}): Promise<ExecutionPlan> {
  const maxDomains = opts.maxDomains ?? 3;
  const knownInputs = opts.knownInputs ?? {};
  const warnings: string[] = [];
  const missingInputs: string[] = [];
  const steps: PlanStep[] = [];
  let order = 0;
  const producedFields = new Set<string>();

  const rankings = rankDomainsForTask(task, ctx.domainRegistry.list()).filter((r) => r.score > 0);
  const primaryDomain = rankings[0]?.domainId;
  const alternateDomains = rankings.slice(1, 4).map((r) => r.domainId);

  if (!primaryDomain) {
    return ExecutionPlanSchema.parse({
      taskDescription: task,
      dependentDomains: [],
      steps: [],
      missingInputs: [],
      warnings: [`Could not confidently match "${task}" to any known domain.`],
      alternateDomains: [],
      generatedAt: new Date().toISOString(),
    });
  }

  const dependentDomains = ctx.businessGraph.resolveTransitiveClosure(primaryDomain);

  // Discover FK-reference domains for the primary tool's required fields up front, so they can be
  // merged into domainOrder before maxDomains truncation, and so each dependent step below knows
  // exactly which field(s) it is expected to resolve.
  const primaryTool = await peekPrimaryTool(primaryDomain, task, ctx);
  const fieldDependenciesByDomain = new Map<string, FieldDependency[]>();
  if (primaryTool) {
    for (const field of deriveRequiredInputs(primaryTool.inputSchema)) {
      const dep = ctx.fieldDependencyIndex.get(bareFieldName(field));
      if (dep && dep.domainId !== primaryDomain) {
        const list = fieldDependenciesByDomain.get(dep.domainId) ?? [];
        list.push(dep);
        fieldDependenciesByDomain.set(dep.domainId, list);
      }
    }
  }

  let domainOrder = ctx.businessGraph.topoSort([primaryDomain]);
  const extraDomainIds = [...fieldDependenciesByDomain.keys()].filter((id) => !domainOrder.includes(id));
  if (extraDomainIds.length > 0) domainOrder = [...domainOrder.slice(0, -1), ...extraDomainIds, primaryDomain];

  if (domainOrder.length > maxDomains) {
    const dropped = domainOrder.slice(0, domainOrder.length - maxDomains);
    warnings.push(`Plan truncated to ${maxDomains} domains; dropped upstream dependencies: ${dropped.join(', ')}`);
    domainOrder = domainOrder.slice(domainOrder.length - maxDomains);
  }

  for (const domainId of domainOrder) {
    const domain = ctx.domainRegistry.get(domainId);
    if (!domain) {
      warnings.push(`Domain "${domainId}" referenced in the business graph has no registered config; skipping.`);
      continue;
    }

    // A field-dependency match takes priority over keyword-based capability matching below — it is
    // evidence-grounded (derived from the live DTO's own schema), not a text-overlap guess.
    const fieldDep = fieldDependenciesByDomain.get(domainId)?.[0];

    const capMatches = domain.capabilities
      .map((cap) => ({ cap, score: scoreIntentMatch(task, [cap.id, cap.summary]) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);
    const bestCap = capMatches[0]?.cap;

    if (!fieldDep && bestCap && bestCap.status !== 'active') {
      const warning = `Capability "${bestCap.id}" (${bestCap.summary}) for domain "${domainId}" is status=${bestCap.status}${bestCap.notes ? ` — ${bestCap.notes}` : ''}`;
      warnings.push(warning);
      steps.push({ order: order++, domainId, purpose: bestCap.summary, requiredInputs: [], producedOutputs: [], status: 'blocked_capability_not_implemented', warning });
      continue;
    }

    const apiSourceId = domain.apiSourceIds[0];
    const apiSource = apiSourceId ? ctx.apiSources.get(apiSourceId) : undefined;
    if (!apiSource) {
      const warning = `Domain "${domainId}" has no resolvable apiSourceIds; cannot plan a concrete step.`;
      warnings.push(warning);
      steps.push({ order: order++, domainId, purpose: `Address domain "${domainId}"`, requiredInputs: [], producedOutputs: [], status: 'blocked_capability_not_implemented', warning });
      continue;
    }

    // A dependent domain's step should look up *within that domain*, not re-rank the whole task
    // against its source's spec — which, when a domain shares a source with the primary domain, can
    // surface the primary domain's own operation again. Bias ranking toward the domain's own
    // active-capability vocabulary; a resolved field dependency is a stronger signal still.
    const intent =
      domainId === primaryDomain
        ? task
        : fieldDep?.resource ||
          domain.capabilities
            .filter((cap) => cap.status === 'active')
            .map((cap) => cap.summary)
            .join('. ') ||
          task;

    let topTool: Tool | undefined;
    if (domainId === primaryDomain && primaryTool) {
      topTool = primaryTool;
    } else {
      let tools: Tool[];
      try {
        const { document } = await ctx.openApiLoader.get(apiSource);
        tools = buildToolCandidates(document, domainId, apiSource, intent, { maxTools: 8 }).tools;
      } catch (err) {
        const warning = `Failed to load OpenAPI spec for "${apiSourceId}": ${err instanceof Error ? err.message : String(err)}`;
        warnings.push(warning);
        steps.push({ order: order++, domainId, apiSourceId, purpose: `Address domain "${domainId}"`, requiredInputs: [], producedOutputs: [], status: 'blocked_capability_not_implemented', warning });
        continue;
      }
      // Prefer the exact operation the field dependency points at over the keyword-ranked top candidate.
      const exactMatch = fieldDep ? tools.find((t) => t.httpMethod === fieldDep.lookupMethod && t.path === fieldDep.lookupPath) : undefined;
      topTool = exactMatch ?? tools[0];
    }

    if (!topTool) {
      const warning = `No matching operation found for domain "${domainId}" in the live ${apiSourceId} swagger.`;
      warnings.push(warning);
      steps.push({ order: order++, domainId, apiSourceId, purpose: `Address domain "${domainId}"`, requiredInputs: [], producedOutputs: [], status: 'blocked_capability_not_implemented', warning });
      continue;
    }

    opts.onToolIssued?.(topTool);

    // Only credit this step with producing a field if it actually landed on that field's specific
    // lookup endpoint — a domain can own more than one FK resource, and a step calls one operation.
    const producedOutputs = (fieldDependenciesByDomain.get(domainId) ?? [])
      .filter((dep) => dep.lookupMethod === topTool.httpMethod && dep.lookupPath === topTool.path)
      .map((dep) => dep.fieldName);
    for (const field of producedOutputs) producedFields.add(field);

    const required = deriveRequiredInputs(topTool.inputSchema);
    const missing = required.filter((field) => !(field in knownInputs) && !producedFields.has(bareFieldName(field)));
    if (missing.length > 0) missingInputs.push(...missing);

    let status: PlanStepStatus = 'ready';
    let warning: string | undefined;
    if (missing.length > 0) {
      status = 'blocked_missing_input';
      warning = `Missing required inputs: ${missing.join(', ')}`;
      warnings.push(warning);
    }

    steps.push({
      order: order++,
      domainId,
      apiSourceId,
      operationId: topTool.operationId,
      httpMethod: topTool.httpMethod,
      path: topTool.path,
      purpose: topTool.summary || `Call ${topTool.operationId}`,
      requiredInputs: required,
      producedOutputs,
      status,
      actionId: topTool.actionId,
      ...(warning ? { warning } : {}),
    });
  }

  return ExecutionPlanSchema.parse({
    taskDescription: task,
    primaryDomain,
    dependentDomains,
    steps,
    missingInputs,
    warnings,
    alternateDomains,
    generatedAt: new Date().toISOString(),
  });
}
