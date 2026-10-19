import type { QaVerdict } from './model.js';
import type { ReportableResult } from './result.js';

export interface ReportConclusionInput<R extends ReportableResult = ReportableResult> {
  verdict: QaVerdict;
  result: R;
  /** Checkpoints carrying the `NOT_EVALUATED` marker. */
  notEvaluatedCount: number;
}

/** Every human-language string the generic report pipeline emits outside of its English section titles. */
export interface ReportText<R extends ReportableResult = ReportableResult> {
  overallResult: Record<QaVerdict, string>;
  environment: { dryRun: string; live: string };
  stepsHeading: string;
  /** Header row of the four-column steps table. */
  stepsTableHeader: string;
  checklistHeading: string;
  /** Header row of the five-column checklist table. */
  checklistTableHeader: string;
  /** Header row of the eight-column checklist table shown when some check answers a checklist row. */
  checklistTableHeaderWithCsv: string;
  missingObjective(scenario: string): string;
  blockedRegressionNote: string;
  observedMismatch(description: string, expected: string, actual: string): string;
  conclusion(input: ReportConclusionInput<R>): string;
  noCheckpoints: string;
  noApiCalls: string;
  noReproSteps: string;
  noPassedScope: string;
  noDefect: string;
  noKeyData: string;
  pollingRetries(count: number): string;
}

export interface KeyInputConfig {
  /** Fields of `body.items[0]` surfaced in the evidence table's key-input column, in order. */
  itemFields: string[];
  /** Top-level body fields surfaced after the item fields, in order. */
  bodyFields: string[];
  /** Query parameters left out of the key-input column (e.g. pagination), compared case-insensitively. */
  ignoredQueryParams: string[];
}

/**
 * The project-specific half of the report pipeline: wording, domain hooks and API conventions.
 * `createReportKit` binds a wording to the generic builders and renderers.
 */
export interface ReportWording<R extends ReportableResult = ReportableResult> {
  text: ReportText<R>;
  /** Business-language description of a technical step title. */
  describeStep(title: string): string;
  /** Business-language description of a technical check label. */
  describeCheck(label: string): string;
  formatCheckValue(label: string, value: unknown): string;
  /** Short purpose of an HTTP call; `undefined` falls back to `METHOD /path`. */
  describeApiCall(method: string, url: string): string | undefined;
  /** Error code/message carried by a response body, in the backend's convention. */
  extractError(data: unknown): { code?: string; message?: string };
  keyInput: KeyInputConfig;
  /** Extra technical-appendix sections rendered before the steps table (e.g. domain payloads). */
  appendixBeforeSteps?(result: R, depth: number): string[];
  /** Extra technical-appendix sections rendered after the scenario's detail tables. */
  appendixAfterDetailTables?(result: R, depth: number): string[];
  /** Extra run-artifact fields, placed between `checks` and `error`. */
  artifactFields?(result: R): Record<string, unknown>;
}

/** Reads `{ error: { code, message } }` (ABP and similar) or a top-level `{ code, message }`. */
export function extractErrorInfo(data: unknown): { code?: string; message?: string } {
  if (data === null || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  const nested = record.error;
  const source = nested !== null && typeof nested === 'object' ? (nested as Record<string, unknown>) : record;
  return {
    code: typeof source.code === 'string' ? source.code : undefined,
    message: typeof source.message === 'string' ? source.message : undefined,
  };
}

export const englishReportText: ReportText = {
  overallResult: {
    PASS: 'Passed (PASS)',
    PARTIAL: 'Partially passed; some checkpoints were not evaluated (PARTIAL)',
    BLOCKED: 'Blocked; not fully verified (BLOCKED)',
    FAIL: 'Failed (FAIL)',
  },
  environment: { dryRun: 'DRY RUN', live: 'LIVE' },
  stepsHeading: 'Steps',
  stepsTableHeader: '| # | Business description | Technical step | Result |',
  checklistHeading: 'Checklist',
  checklistTableHeader: '| Test ID | Checkpoint | Expected | Actual | Result |',
  checklistTableHeaderWithCsv: '| Test ID | Checkpoint | Expected | Actual | Result | CSV testcase ID | CSV expected | CSV priority |',
  missingObjective: (scenario) => `Scenario ${scenario} declares no business summary.`,
  blockedRegressionNote: 'BLOCKED — part of the scenario could not be verified; this is neither a clean PASS nor a FAIL.',
  observedMismatch: (description, expected, actual) => `${description}: expected ${expected}, actual ${actual}`,
  conclusion: ({ verdict, result, notEvaluatedCount }) => {
    if (verdict === 'PASS') return `Scenario ${result.scenario} passed — no business deviation was found in this run.`;
    if (verdict === 'BLOCKED') {
      return `Scenario ${result.scenario} could not be fully verified: ${typeof result.blocked === 'string' ? result.blocked : result.error ?? 'missing data or preconditions.'}`;
    }
    if (verdict === 'PARTIAL') {
      const open = notEvaluatedCount > 0 ? `${notEvaluatedCount} checkpoint(s) could not be evaluated` : 'some content is not fully verified';
      return `Scenario ${result.scenario} partially passed: every hard assertion that ran passed, ${open} (known blockers, not a suspected product defect)${result.overview?.attention ? ` — ${result.overview.attention}` : '.'}`;
    }
    return `Scenario ${result.scenario} FAILED: ${result.overview?.attention ?? result.error ?? 'see the technical appendix.'}`;
  },
  noCheckpoints: '_No checkpoints were recorded for this run._',
  noApiCalls: '_No API calls were recorded._',
  noReproSteps: '_No reproduction steps were recorded for this run._',
  noPassedScope: 'No check was confirmed as passing in this run.',
  noDefect: 'No defect found in this run.',
  noKeyData: '(no key data recorded)',
  pollingRetries: (count) => `Polling/retries: ${count} step(s) — see the "Steps" table below.`,
};

export const defaultReportWording: ReportWording = {
  text: englishReportText,
  describeStep: (title) => title,
  describeCheck: (label) => label,
  formatCheckValue: (_label, value) => (value === undefined ? 'undefined' : JSON.stringify(value)),
  describeApiCall: () => undefined,
  extractError: extractErrorInfo,
  keyInput: { itemFields: [], bodyFields: ['name', 'code', 'description'], ignoredQueryParams: [] },
};
