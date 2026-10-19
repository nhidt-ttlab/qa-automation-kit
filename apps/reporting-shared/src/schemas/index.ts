/**
 * Zod schemas for input validation
 */

import { z } from 'zod';
import {
  TEST_RUN_RESULT,
  TEST_CASE_STATUS,
  REPRODUCIBILITY,
  DEFECT_SEVERITY,
  REVIEW_VERDICT,
  REVIEW_TESTCASE_QUALITY,
  ENTITY_TYPE,
  BUG_LINK_TYPE,
  REDMINE_PRIORITY,
  MAX_REVIEW_ARRAY_ITEMS,
  MAX_REVIEW_ARRAY_ITEM_LENGTH,
  MAX_REVIEW_LONG_TEXT_LENGTH,
} from '../constants.js';

// ============================================================================
// Reusable field validators
// ============================================================================

const ISODateTime = z.string().datetime();
const RawId = z.string().min(1).max(255);
const EnvironmentString = z.enum(['staging', 'uat', 'production', 'development']);
const Tags = z.array(z.string().min(1).max(50)).max(20);
const Metadata = z.record(z.unknown()).optional();

// ============================================================================
// Test Case Schemas
// ============================================================================

export const CreateTestCaseSchema = z.object({
  id: RawId,
  scenario_key: z.string().min(1).max(255).regex(/^[a-z0-9\-]+$/),
  title: z.string().min(1).max(500),
  objective: z.string().max(2000).optional(),
  impacted_area: z.string().max(500).optional(),
  // Not an enum: the suite folders and documentation modules both grow, and a closed list here
  // would reject a valid new module until this file catches up.
  module: z.string().max(100).optional(),
  domain: z.string().max(100).optional(),
  owner: z.string().max(255).optional(),
  status: z.enum([TEST_CASE_STATUS.ACTIVE, TEST_CASE_STATUS.DEPRECATED, TEST_CASE_STATUS.DRAFT]).optional(),
  tags: Tags.optional(),
  metadata: Metadata,
});

export const UpdateTestCaseSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  objective: z.string().max(2000).optional(),
  impacted_area: z.string().max(500).optional(),
  // Not an enum: the suite folders and documentation modules both grow, and a closed list here
  // would reject a valid new module until this file catches up.
  module: z.string().max(100).optional(),
  domain: z.string().max(100).optional(),
  owner: z.string().max(255).optional(),
  status: z.enum([TEST_CASE_STATUS.ACTIVE, TEST_CASE_STATUS.DEPRECATED, TEST_CASE_STATUS.DRAFT]).optional(),
  tags: Tags.optional(),
  metadata: Metadata,
});

// ============================================================================
// Test Run Schemas
// ============================================================================

const CheckResultSchema = z.object({
  name: z.string().min(1).max(255),
  passed: z.boolean(),
  message: z.string().max(1000).optional(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
});

const ExecutionStepSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  status: z.enum(['passed', 'failed', 'skipped']),
  message: z.string().max(1000).optional(),
  timestamp: ISODateTime,
});

const HttpTraceEntrySchema = z.object({
  index: z.number().int().min(0),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().url(),
  status: z.number().int().min(100).max(599),
  requestBody: z.record(z.unknown()).optional(),
  responseBody: z.record(z.unknown()).optional(),
  error: z.string().max(500).optional(),
  timestamp: ISODateTime,
});

const RelatedEntitySchema = z.object({
  type: z.enum(Object.values(ENTITY_TYPE) as [string, ...string[]]),
  id: z.string().min(1).max(255),
  label: z.string().max(500).optional(),
  href: z.string().url().optional(),
});

const PayloadEntrySchema = z.object({
  label: z.string().min(1).max(255),
  payload: z.record(z.unknown()),
  context: z.record(z.unknown()).optional(),
});

export const CreateTestRunSchema = z.object({
  test_case_id: RawId,
  environment: EnvironmentString,
  dry_run: z.boolean().optional().default(false),
  result: z.enum(Object.values(TEST_RUN_RESULT) as [string, ...string[]]),
  started_at: ISODateTime,
  finished_at: ISODateTime.optional(),
  duration_ms: z.number().int().min(0).optional(),
  executed_by: z.string().max(255).optional(),
  git_commit: z.string().max(40).optional(),
  git_branch: z.string().max(255).optional(),
  checks: z.array(CheckResultSchema).optional(),
  steps: z.array(ExecutionStepSchema).optional(),
  evidence: z.array(HttpTraceEntrySchema).optional(),
  related_entities: z.array(RelatedEntitySchema).optional(),
  business_scenario: z.string().max(500).optional(),
  severity: z.enum(Object.values(DEFECT_SEVERITY) as [string, ...string[]]).optional(),
  reproducibility: z.enum(Object.values(REPRODUCIBILITY) as [string, ...string[]]).optional(),
  defect_statement: z.string().max(1000).optional(),
  blocked_reason: z.string().max(500).optional(),
  error_summary: z.string().max(1000).optional(),
  conclusion: z.string().max(2000).optional(),
  overview_key_data: z.array(z.string().max(500)).optional(),
  overview_highlights: z.array(z.string().max(500)).optional(),
  payloads: z.array(PayloadEntrySchema).optional(),
  tags: Tags.optional(),
  custom_data: Metadata,
});

// ============================================================================
// Review Schemas
// ============================================================================

const ReviewStringArray = z.array(z.string().max(MAX_REVIEW_ARRAY_ITEM_LENGTH)).max(MAX_REVIEW_ARRAY_ITEMS);

export const CreateReviewSchema = z.object({
  test_run_id: RawId,
  verdict: z.enum(Object.values(REVIEW_VERDICT) as [string, ...string[]]),
  note: z.string().max(5000).optional(),
  testcase_quality: z.enum(Object.values(REVIEW_TESTCASE_QUALITY) as [string, ...string[]]).optional(),
  should_improve_testcase: z.boolean().optional(),
  improvement_summary: z.string().max(MAX_REVIEW_LONG_TEXT_LENGTH).optional(),
  missing_coverage: ReviewStringArray.optional(),
  suggested_steps: ReviewStringArray.optional(),
  suggested_assertions: ReviewStringArray.optional(),
  suggested_test_data: ReviewStringArray.optional(),
  ai_generation_hint: z.string().max(MAX_REVIEW_LONG_TEXT_LENGTH).optional(),
});

export const UpdateReviewSchema = z.object({
  verdict: z.enum(Object.values(REVIEW_VERDICT) as [string, ...string[]]).optional(),
  note: z.string().max(5000).optional(),
});

// ============================================================================
// Defect Schemas
// ============================================================================

export const CreateDefectSignatureSchema = z.object({
  title: z.string().min(1).max(500),
  severity: z.enum(Object.values(DEFECT_SEVERITY) as [string, ...string[]]),
  test_case_id: RawId.optional(),
  scenario_key: z.string().max(255).optional(),
  diagnosis: z.string().max(2000).optional(),
});

export const LinkRedmineSchema = z.object({
  redmine_issue_id: z.number().int().positive(),
  redmine_url: z.string().url(),
  redmine_project: z.string().min(1).max(100),
  link_type: z.enum(Object.values(BUG_LINK_TYPE) as [string, ...string[]]).optional(),
});

export const CreateRedmineIssueSchema = z.object({
  project_key: z.string().min(1).max(100),
  tracker: z.string().min(1).max(100),
  subject: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  priority: z.enum(REDMINE_PRIORITY).optional(),
  assigned_to: z.string().max(255).optional(),
  target_version: z.string().max(255).optional(),
  custom_fields: z
    .array(
      z.object({
        id: z.number().int().positive(),
        value: z.union([z.string(), z.array(z.string())]),
      }),
    )
    .optional(),
});

// ============================================================================
// Query Schemas
// ============================================================================

export const ListTestRunsQuerySchema = z.object({
  test_case_id: RawId.optional(),
  scenario_key: z.string().max(255).optional(),
  environment: EnvironmentString.optional(),
  result: z.enum(Object.values(TEST_RUN_RESULT) as [string, ...string[]]).optional(),
  reviewed: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  from_date: ISODateTime.optional(),
  to_date: ISODateTime.optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sort_by: z.enum(['created_at', 'started_at', 'result']).optional(),
  sort_order: z.enum(['ASC', 'DESC']).optional(),
});

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(255),
  entity_type: z.enum(['test_case', 'test_run', 'defect', 'bug']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const DashboardQuerySchema = z.object({
  environment: EnvironmentString.optional(),
  from_date: ISODateTime.optional(),
  to_date: ISODateTime.optional(),
});

// ============================================================================
// Type exports for use in other modules
// ============================================================================

export type CreateTestCaseInput = z.infer<typeof CreateTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof UpdateTestCaseSchema>;
export type CreateTestRunInput = z.infer<typeof CreateTestRunSchema>;
export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;
export type UpdateReviewInput = z.infer<typeof UpdateReviewSchema>;
export type CreateDefectSignatureInput = z.infer<typeof CreateDefectSignatureSchema>;
export type LinkRedmineInput = z.infer<typeof LinkRedmineSchema>;
export type CreateRedmineIssueInput = z.infer<typeof CreateRedmineIssueSchema>;
export type ListTestRunsQuery = z.infer<typeof ListTestRunsQuerySchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;
