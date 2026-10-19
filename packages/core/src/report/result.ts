import type { CsvCheckMeta } from '../assertions.js';
import type { RequestTraceEntry } from '../http/http-client.js';
import type { QaReportModelOverride } from './model.js';

/**
 * Business-readable run summary. Scenarios should set this explicitly (sourced from the test-case
 * doc) rather than relying on the report writer to infer it from step titles.
 */
export interface ReportOverview {
  /** e.g. "TC-ORD-R02" */
  testCaseId: string;
  testCaseName: string;
  /** What business behavior this run validates, in plain language. */
  objective: string;
  /** Short "Label value" strings describing the key data used in this run. */
  keyData?: string[];
  /** Bullet points summarizing what succeeded, failed and was blocked — most important first. */
  highlights?: string[];
  /** The single most important failure/blocker to call out first, if any. */
  attention?: string;
}

export interface ReportStep {
  title: string;
  ok: boolean;
  status?: number;
  data?: unknown;
}

export interface ReportCheck {
  label: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  testId?: string;
  csv?: CsvCheckMeta[];
}

/** One scenario-supplied evidence table for the Markdown report. */
export interface DetailTable {
  /** Section heading. */
  title: string;
  /** Short intro paragraph rendered under the heading, before the table. */
  note?: string;
  columns: string[];
  rows: string[][];
}

/** Minimal shape every scenario result satisfies. Projects extend it with their own fields. */
export interface ReportableResult {
  scenario: string;
  dryRun: boolean;
  passed: boolean;
  /**
   * Set when part of the scenario could not be evaluated rather than genuinely passing or failing.
   * Scenarios use it either as a boolean flag (with `blockedReason`) or as the reason string
   * itself, so it is read defensively via `isBlockedResult`.
   */
  blocked?: unknown;
  /** The reason string, when `blocked` is a boolean flag. */
  blockedReason?: string;
  steps: ReportStep[];
  checks?: ReportCheck[];
  error?: string;
  /** Business-readable summary. A generic one is derived when omitted. */
  overview?: ReportOverview;
  /** Per-row evidence tables rendered as their own sections after the checklist. */
  detailTables?: DetailTable[];
  /** Scenario-composed override for the QA report; unset fields keep the generic model. */
  reportModel?: QaReportModelOverride;
}

/** One reviewable step: the logical step plus its HTTP evidence (if any). */
export interface VisualStep {
  index: number;
  title: string;
  ok: boolean;
  status?: number;
  method?: string;
  url?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  error?: string;
  /** Verification evidence attached from the matching check (when one exists). */
  checkLabel?: string;
  checkPassed?: boolean;
  expected?: unknown;
  actual?: unknown;
}

/** Machine-readable execution artifact. Projects may add fields via `ReportWording.artifactFields`. */
export interface RunArtifact {
  schemaVersion: 1;
  runId: string;
  scenario: string;
  dryRun: boolean;
  passed: boolean;
  blocked?: boolean;
  generatedAt: string;
  summary: { totalSteps: number; failedSteps: number };
  steps: Array<{ title: string; ok: boolean; status?: number }>;
  visualSteps: VisualStep[];
  checks?: ReportCheck[];
  error?: string;
  overview?: ReportOverview;
  trace: RequestTraceEntry[];
}

export type ReviewVerdict = 'pass' | 'fail' | 'blocked' | 'incorrect-scenario' | 'needs-review';

/** Human/AI review decision — decoupled from the execution trace. */
export interface ReviewRecord {
  schemaVersion: 1;
  scenario: string;
  runId: string;
  generatedAt: string;
  reviewer: string;
  verdict: ReviewVerdict;
  notes: string;
  suggestedFix: string;
  correctedStepIndex?: number;
  correctedPayload?: unknown;
  reviewedAt: string;
}

export type ProposalDiagnosis = 'product-defect' | 'invalid-scenario' | 'missing-fixture-data' | 'incorrect-step-order';

/** AI-assisted (or heuristic) proposal for a corrected scenario / next step. */
export interface ProposalRecord {
  schemaVersion: 1;
  scenario: string;
  runId: string;
  generatedAt: string;
  diagnosis: ProposalDiagnosis;
  rationale: string;
  proposedStep?: { title: string; method?: string; url?: string; payload?: unknown };
  correctedScenario?: unknown;
  basedOnReview?: Pick<ReviewRecord, 'verdict' | 'notes' | 'suggestedFix'>;
}

export function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Mints a run id. Minted before a run starts so evidence written during the run shares it. */
export function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
