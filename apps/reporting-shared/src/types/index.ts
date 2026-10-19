/**
 * Core domain types for QA Regression Reporting
 */

import type {
  TestRunResult,
  TestCaseStatus,
  Reproducibility,
  DefectSeverity,
  ReviewVerdict,
  EntityType,
  HttpMethod,
  BugLinkType,
  RunType,
  SuiteModule,
  FeatureDomain,
} from '../constants.js';

/**
 * Payload entry representing a business entity in the test run
 */
export interface PayloadEntry {
  label: string;
  payload: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/**
 * HTTP trace entry capturing API call details
 */
export interface HttpTraceEntry {
  index: number;
  method: HttpMethod;
  url: string;
  status: number;
  requestBody?: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}

/**
 * Check/assertion result from a test run
 */
export interface CheckResult {
  name: string;
  passed: boolean;
  message?: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Orchestration step in the test execution
 */
export interface ExecutionStep {
  name: string;
  description?: string;
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  timestamp: string;
}

/**
 * Related business entity linked from a test run
 */
export interface RelatedEntity {
  type: EntityType;
  id: string;
  label?: string;
  href?: string;
}

/**
 * A single test case definition (stable)
 */
export interface TestCase {
  id: string;
  scenario_key: string;
  title: string;
  objective?: string;
  impacted_area?: string;
  /** Suite folder the scenario lives in. Absent for a producer that is not a registered scenario. */
  module?: SuiteModule;
  /** Documentation module (the "feature"). Finer than `module`; `_unknown` for non-scenarios. */
  domain?: FeatureDomain;
  /**
   * ERP Feature List id, e.g. `QLDN-VT-04` (Cài đặt sinh mã) — how a case is reconciled against
   * the business-spec workbook, which numbers screens rather than testcases. Free text on
   * purpose: the workbook owns the vocabulary, so a new screen must not need a code change here.
   * Undefined for a scenario that has not declared one, which is most of them today.
   */
  feature_id?: string;
  owner?: string;
  status: TestCaseStatus;
  /** Which layer this case exercises. Derived during sync; defaults to 'api'. */
  run_type: RunType;
  tags: string[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * A single test run (execution record)
 */
export interface TestRun {
  id: string;
  test_case_id: string;
  scenario_key: string;
  /** Denormalized from the test case at run time — see TestCase#module. */
  module?: SuiteModule;
  /** Denormalized from the test case at run time — see TestCase#domain. */
  domain?: FeatureDomain;
  environment: string;
  dry_run: boolean;
  result: TestRunResult;
  /** Which layer this run exercised. Derived during sync; defaults to 'api'. */
  run_type: RunType;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  executed_by?: string;
  git_commit?: string;
  git_branch?: string;
  business_scenario?: string;
  severity?: DefectSeverity;
  reproducibility?: Reproducibility;
  defect_statement?: string;
  blocked_reason?: string;
  error_summary?: string;
  conclusion?: string;
  overview_key_data: string[];
  overview_highlights: string[];
  payloads: PayloadEntry[];
  tags: string[];
  custom_data?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * A test run check/assertion
 */
export interface TestRunCheck {
  id: string;
  test_run_id: string;
  name: string;
  passed: boolean;
  message?: string;
  expected?: unknown;
  actual?: unknown;
  created_at: string;
}

/**
 * A test run execution step
 */
export interface TestRunStep {
  id: string;
  test_run_id: string;
  sequence: number;
  name: string;
  description?: string;
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  timestamp: string;
  created_at: string;
}

/**
 * Evidence of an API call captured during test run
 */
export interface TestRunEvidence {
  id: string;
  test_run_id: string;
  http_method: HttpMethod;
  url: string;
  status: number;
  request_body?: Record<string, unknown>;
  response_body?: Record<string, unknown>;
  error?: string;
  timestamp: string;
  created_at: string;
}

/**
 * Related entity observed in a test run
 */
export interface TestRunRelatedEntity {
  id: string;
  test_run_id: string;
  entity_type: EntityType;
  entity_id: string;
  entity_label?: string;
  entity_href?: string;
  created_at: string;
}

/**
 * Artifact file storing large data (Markdown, JSON, raw trace)
 */
export interface Artifact {
  id: string;
  test_run_id: string;
  type: 'markdown_report' | 'json_output' | 'raw_trace' | 'other';
  file_path: string;
  file_size: number;
  mime_type: string;
  checksum?: string;
  created_at: string;
}

/**
 * Master identity of a distinct bug signature
 */
export interface DefectSignature {
  id: string;
  test_case_id: string;
  scenario_key: string;
  title: string;
  severity: DefectSeverity;
  diagnosis?: string;
  first_seen_at: string;
  last_seen_at: string;
  observation_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Per-run observation of a defect signature
 */
export interface DefectObservation {
  id: string;
  defect_signature_id: string;
  test_run_id: string;
  observation_data?: Record<string, unknown>;
  created_at: string;
}

/**
 * Link to external Redmine issue
 */
export interface BugLink {
  id: string;
  defect_signature_id: string;
  redmine_issue_id: number;
  redmine_url: string;
  redmine_project: string;
  link_type: BugLinkType;
  created_at: string;
  updated_at: string;
}

/**
 * Human review record for a test run
 */
export interface ReviewRecord {
  id: string;
  test_run_id: string;
  reviewer: string;
  verdict: ReviewVerdict;
  note?: string;
  created_at: string;
  updated_at: string;
}

/**
 * AI/heuristic proposal for scenario override
 */
export interface ProposalRecord {
  id: string;
  test_run_id: string;
  proposer: string;
  proposed_data: Record<string, unknown>;
  reasoning?: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
}
