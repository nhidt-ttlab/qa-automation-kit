import { z } from 'zod';

export const ConfidenceSchema = z.enum(['confirmed', 'inferred', 'unknown']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const CapabilityStatusSchema = z.enum(['active', 'planned', 'unknown']);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

export const CapabilitySchema = z.object({
  id: z.string(),
  summary: z.string(),
  status: CapabilityStatusSchema,
  source: z.string().optional(),
  notes: z.string().optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const DomainStatusSchema = z.enum(['active', 'planned', 'unknown']);
export type DomainStatus = z.infer<typeof DomainStatusSchema>;

/** One business domain, as declared in `<api.domainsDir>/<id>.yaml`. */
export const DomainSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  apiSourceIds: z.array(z.string()).default([]),
  capabilities: z.array(CapabilitySchema).default([]),
  tags: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  status: DomainStatusSchema,
  confidence: ConfidenceSchema.default('unknown'),
  notes: z.string().optional(),
});
export type Domain = z.infer<typeof DomainSchema>;

export const EdgeRelationSchema = z.enum(['requires', 'calls', 'produces']);
export const EdgeLevelSchema = z.enum(['domain', 'service']);

export const DependencyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  relation: EdgeRelationSchema,
  level: EdgeLevelSchema,
  description: z.string(),
  confidence: ConfidenceSchema.default('unknown'),
});
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;

export const PlanStepStatusSchema = z.enum(['ready', 'blocked_missing_input', 'blocked_no_auth', 'blocked_capability_not_implemented']);
export type PlanStepStatus = z.infer<typeof PlanStepStatusSchema>;

export const PlanStepSchema = z.object({
  order: z.number().int().nonnegative(),
  domainId: z.string(),
  apiSourceId: z.string().optional(),
  operationId: z.string().optional(),
  httpMethod: z.string().optional(),
  path: z.string().optional(),
  purpose: z.string(),
  requiredInputs: z.array(z.string()).default([]),
  producedOutputs: z.array(z.string()).default([]),
  status: PlanStepStatusSchema,
  actionId: z.string().optional(),
  warning: z.string().optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanSchema = z.object({
  taskDescription: z.string(),
  primaryDomain: z.string().optional(),
  dependentDomains: z.array(z.string()).default([]),
  steps: z.array(PlanStepSchema).default([]),
  missingInputs: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  alternateDomains: z.array(z.string()).default([]),
  generatedAt: z.string(),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const FieldDependencySchema = z.object({
  fieldName: z.string(),
  resource: z.string(),
  repo: z.string(),
  domainId: z.string(),
  apiSourceId: z.string(),
  lookupMethod: z.string(),
  lookupPath: z.string(),
  confidence: ConfidenceSchema,
});
export type FieldDependency = z.infer<typeof FieldDependencySchema>;

/**
 * A candidate operation ranked out of an OpenAPI spec — not a second tier of MCP-registered tools.
 * `actionId` is the only handle a caller ever gets.
 */
export interface Tool {
  actionId: string;
  operationId: string;
  httpMethod: string;
  path: string;
  domainId: string;
  apiSourceId: string;
  summary: string;
  intentKeywords: string[];
  requiresAuth: boolean;
  /** Attached lazily — only for operations actually selected past ranking/truncation. */
  inputSchema?: Record<string, unknown>;
}
