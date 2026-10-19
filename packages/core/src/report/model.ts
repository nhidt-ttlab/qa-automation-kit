/**
 * Structured QA/QC report model — the source of truth the Markdown renderer reads from. Scenarios
 * never format Markdown for business content: they populate (or override) this shape, and
 * rendering is a pure function of the data. JSON-serializable on purpose: it is persisted as a DB
 * column and could feed a bug-tracker issue.
 */

/**
 * PARTIAL covers a run that is neither a clean PASS nor a hard FAIL/BLOCKED: some checkpoints
 * passed while others were not evaluated or blocked. See `deriveVerdict`.
 */
export type QaVerdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED';

export interface QaReportHeader {
  /** e.g. "TC-ORD-R02" */
  testCaseId: string;
  testName: string;
  /** ISO timestamp of report generation. */
  executedAt: string;
  /** e.g. "LIVE" / "DRY RUN". */
  environment: string;
  overallResult: QaVerdict;
  /** Known bug-tracker ids this scenario guards against, if any. */
  relatedBugs?: string[];
  /** Run artifact id — cross-references the machine-readable JSON artifact. */
  runId: string;
}

export interface QaDecisionSummary {
  /** Plain-language description of the business behavior under test. */
  businessScenario: string;
  verdict: QaVerdict;
  /** e.g. "Critical" / "High" / "Medium" / "Low" — only when a defect is confirmed. */
  severity?: string;
  /** e.g. "Always" / "Intermittent" / "N/A" — only when meaningful to state. */
  reproducibility?: string;
  /** One-line defect statement, set when verdict is not PASS. */
  defectStatement?: string;
  /** e.g. "Orders — excess quantity". */
  impactedArea?: string;
}

export interface QaCheckpointRow {
  checkpoint: string;
  expected: string;
  actual: string;
  /** `NOT_EVALUATED` renders with its own warning icon instead of collapsing into PASS/FAIL. */
  result: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  /**
   * Hardening-checklist metadata, when this checkpoint answers a sheet row. Optional and rendered
   * as an em dash when absent; an assertion answering several rows arrives joined with ` | `.
   * These are the sheet's words about invented data — never the value `expected` was judged against.
   */
  csvTestcaseId?: string;
  csvExpected?: string;
  csvPriority?: string;
}

export interface QaEvidenceRow {
  /** e.g. "E1" — cross-references `trace[N]` in the technical appendix. */
  evidenceId: string;
  /** e.g. "POST /orders". */
  action: string;
  keyInput: string;
  keyOutput: string;
  /** Why this call matters to the verdict — business framing, not a repeat of keyOutput. */
  whyItMatters: string;
}

export interface QaDefectDetails {
  observedMismatch?: string;
  probableFailingRule?: string;
  regressionNote?: string;
  suspectedComponent?: string;
}

export interface QaTechnicalAppendixMeta {
  keyTestData: string[];
  /** Markdown link text to the full machine-readable run artifact. */
  artifactLinkText: string;
  rawEvidenceNote: string;
  pollingRetries: string[];
  cleanupActions: string[];
}

export interface QaReportModel {
  header: QaReportHeader;
  qaSummary: QaDecisionSummary;
  /** Small table — only the key assertions; the technical appendix has the full checklist. */
  expectedVsActual: QaCheckpointRow[];
  /** Human-readable minimal repro steps, business language. */
  reproSteps: string[];
  /** Short list of validations confirmed correct. */
  passedScope: string[];
  defectDetails: QaDefectDetails;
  /** Compact table — only the most relevant calls; the technical appendix has the full table. */
  evidenceSummary: QaEvidenceRow[];
  appendixMeta: QaTechnicalAppendixMeta;
  /** One short paragraph summarizing the run's outcome and business impact. */
  conclusion: string;
}

/**
 * Scenario-supplied override for the parts of `QaReportModel` that carry business meaning.
 * Everything else is derived generically and merged underneath. Leave a field unset to keep the
 * generic value.
 */
export interface QaReportModelOverride {
  header?: Pick<QaReportHeader, 'relatedBugs'>;
  qaSummary?: QaDecisionSummary;
  expectedVsActual?: QaCheckpointRow[];
  reproSteps?: string[];
  passedScope?: string[];
  defectDetails?: QaDefectDetails;
  evidenceSummary?: QaEvidenceRow[];
  conclusion?: string;
}
