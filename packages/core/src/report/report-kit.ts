import path from 'node:path';
import type { RequestTraceEntry } from '../http/http-client.js';
import { buildEvidenceRows, selectKeyEvidenceRows, shortenEndpointForDisplay, type EvidenceRow } from './evidence-rows.js';
import type {
  QaCheckpointRow,
  QaDecisionSummary,
  QaDefectDetails,
  QaEvidenceRow,
  QaReportHeader,
  QaReportModel,
  QaReportModelOverride,
  QaTechnicalAppendixMeta,
  QaVerdict,
} from './model.js';
import { newRunId, type ReportableResult, type RunArtifact, type VisualStep } from './result.js';
import { checkpointRowStatus, isBlockedResult, resultVerdict } from './verdict.js';
import { defaultReportWording, type ReportWording } from './wording.js';

export interface QaBuildMeta {
  runId: string;
  /** Markdown link text (relative path) from the report file to its machine-readable run artifact. */
  artifactLink: string;
}

export interface ReportPaths {
  runId: string;
  reportPath: string;
  outputPath: string;
}

export interface ReportKit<R extends ReportableResult = ReportableResult> {
  readonly wording: ReportWording<R>;
  formatOverallResult(result: R): string;
  overallVerdict(result: R): QaVerdict;
  buildEvidenceRows(trace: RequestTraceEntry[]): EvidenceRow[];
  renderTechnicalAppendix(result: R, trace: RequestTraceEntry[], reportPath: string, outputPath: string, depth?: number): string[];
  buildHeader(result: R, meta: QaBuildMeta): QaReportHeader;
  buildQaSummary(result: R): QaDecisionSummary;
  buildExpectedVsActual(result: R): QaCheckpointRow[];
  buildReproStepsFromSteps(result: R): string[];
  buildPassedScope(result: R): string[];
  buildDefectDetails(result: R): QaDefectDetails;
  buildEvidenceSummary(trace: RequestTraceEntry[]): QaEvidenceRow[];
  buildAppendixMeta(result: R, meta: QaBuildMeta): QaTechnicalAppendixMeta;
  buildConclusion(result: R): string;
  buildDefaultReportModel(result: R, trace: RequestTraceEntry[], meta: QaBuildMeta): QaReportModel;
  /** The generic model with the scenario's `reportModel` merged on top, header verdict re-synced. */
  buildReportModel(result: R, trace: RequestTraceEntry[], paths: ReportPaths): QaReportModel;
  renderQaMarkdown(model: QaReportModel, result: R, trace: RequestTraceEntry[], reportPath: string, outputPath: string): string;
  buildRunArtifact(result: R, trace: RequestTraceEntry[], runId?: string): RunArtifact;
}

const MAX_KEY_CHECKS = 8;
const MAX_REPRO_STEPS = 12;
const MAX_PASSED_SCOPE = 10;

/** Forward-slash relative link from one file to another, for Markdown. */
export function toMarkdownLink(fromFile: string, toFile: string): string {
  return path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/');
}

/** Merges a scenario's override on top of the generic model — override fields win. */
export function mergeReportModel(base: QaReportModel, override: QaReportModelOverride | undefined): QaReportModel {
  if (!override) return base;
  return {
    ...base,
    header: override.header ? { ...base.header, ...override.header } : base.header,
    qaSummary: override.qaSummary ?? base.qaSummary,
    expectedVsActual: override.expectedVsActual ?? base.expectedVsActual,
    reproSteps: override.reproSteps ?? base.reproSteps,
    passedScope: override.passedScope ?? base.passedScope,
    defectDetails: override.defectDetails ?? base.defectDetails,
    evidenceSummary: override.evidenceSummary ?? base.evidenceSummary,
    conclusion: override.conclusion ?? base.conclusion,
  };
}

function mdHeading(depth: number, title: string): string {
  return `${'#'.repeat(depth)} ${title}`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Returns the balanced `{...}` substring starting at `start`, tracking string state so braces in values don't count. */
function extractBalancedJson(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Recursively parses string fields that are themselves JSON, for a cleaner pretty-print. */
function deepParseNestedJson(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return deepParseNestedJson(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(deepParseNestedJson);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepParseNestedJson(v);
    return out;
  }
  return value;
}

/** Renders a `" | "`-joined error string as bullets, pulling embedded JSON blobs into pretty-printed code blocks. */
function renderErrorDetails(error: string): string[] {
  const lines: string[] = [];
  const parts = error.split(' | ').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const braceIdx = part.indexOf('{');
    const raw = braceIdx !== -1 ? extractBalancedJson(part, braceIdx) : undefined;
    let pretty: string | undefined;
    if (raw) {
      try {
        pretty = JSON.stringify(deepParseNestedJson(JSON.parse(raw)), null, 2);
      } catch {
        pretty = undefined;
      }
    }

    if (pretty && raw) {
      const inline = part.slice(0, braceIdx) + '(see JSON below)' + part.slice(braceIdx + raw.length);
      lines.push(`- ${inline.trim()}`);
      lines.push('  ```json');
      for (const l of pretty.split('\n')) lines.push(`  ${l}`);
      lines.push('  ```');
    } else {
      lines.push(`- ${part}`);
    }
  }
  return lines;
}

function renderEvidenceRowRefs(row: EvidenceRow): { numberCell: string; artifactCell: string } {
  if (row.count === 1) {
    return { numberCell: `${row.firstIndex + 1}`, artifactCell: `\`trace[${row.firstIndex}]\`` };
  }
  return {
    numberCell: `${row.firstIndex + 1}–${row.lastIndex + 1}`,
    artifactCell: `\`trace[${row.firstIndex}]\`–\`trace[${row.lastIndex}]\``,
  };
}

function renderEvidenceTable(rows: EvidenceRow[]): string[] {
  const lines: string[] = [];
  lines.push('| # | Purpose | Method | Endpoint | Key input | Result | Artifact ref |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const row of rows) {
    const { numberCell, artifactCell } = renderEvidenceRowRefs(row);
    const purposeCell = row.count > 1 ? `${row.purpose} (×${row.count})` : row.purpose;
    const resultCell = row.count > 1 ? `${row.result} (×${row.count})` : row.result;
    lines.push(
      `| ${numberCell} | ${escapeCell(purposeCell)} | ${row.method} | \`${escapeCell(shortenEndpointForDisplay(row.url))}\` | ${escapeCell(row.keyInput)} | ${escapeCell(resultCell)} | ${artifactCell} |`,
    );
  }
  return lines;
}

/** Best-effort pointer from a failed check's `actual` value back to the trace call whose response likely produced it. */
function findRelatedTraceIndex(trace: RequestTraceEntry[], actual: unknown): number | undefined {
  if (typeof actual !== 'string' || actual.length < 6) return undefined;
  for (let i = trace.length - 1; i >= 0; i--) {
    const body = trace[i]?.responseBody;
    if (body === undefined) continue;
    let haystack: string;
    try {
      haystack = JSON.stringify(body);
    } catch {
      continue;
    }
    if (haystack.includes(actual)) return i;
  }
  return undefined;
}

function bulletsOrNone(items: string[], noneText: string): string[] {
  if (!items.length) return [`- ${noneText}`, ''];
  return [...items.map((i) => `- ${i}`), ''];
}

const CHECKPOINT_ROW_ICON: Record<QaCheckpointRow['result'], string> = {
  PASS: '✅ PASS',
  FAIL: '❌ FAIL',
  NOT_EVALUATED: '⚠️ NOT_EVALUATED',
};

/**
 * Binds a project's `ReportWording` to the generic report builders and renderers. Everything
 * returned is a pure function of its arguments plus the wording.
 */
export function createReportKit<R extends ReportableResult = ReportableResult>(
  wording: ReportWording<R> = defaultReportWording as unknown as ReportWording<R>,
): ReportKit<R> {
  const { text } = wording;

  const overallVerdict = (result: R): QaVerdict => resultVerdict(result);
  const formatOverallResult = (result: R): string => text.overallResult[overallVerdict(result)];
  const evidenceRows = (trace: RequestTraceEntry[]): EvidenceRow[] => buildEvidenceRows(trace, wording);

  function renderNotableObservations(rows: EvidenceRow[], trace: RequestTraceEntry[], depth = 3): string[] {
    const bullets: string[] = [];
    for (const row of rows) {
      if (row.count >= 3) {
        bullets.push(
          `**${row.purpose}** was called ${row.count} times consecutively (calls #${row.firstIndex + 1}–#${row.lastIndex + 1}, \`trace[${row.firstIndex}]\`–\`trace[${row.lastIndex}]\`) with identical input — likely polling/settle-wait behavior rather than distinct verification steps.`,
        );
      }
    }
    trace.forEach((entry, i) => {
      if (entry.error || entry.status >= 500) {
        const { code, message } = wording.extractError(entry.responseBody);
        const detail = [code, message].filter(Boolean).join(': ');
        bullets.push(
          `Call #${i + 1} (\`${entry.method} ${shortenEndpointForDisplay(entry.url)}\`) returned ${entry.error ? 'a network/transport error' : `HTTP ${entry.status}`}${detail ? ` — ${detail}` : ''}. Check the Steps table above for whether this was an expected validation reject.`,
        );
      }
    });
    if (!bullets.length) {
      bullets.push('No repeated polling and no HTTP-level error/network-failure responses detected in this run.');
    }
    return [mdHeading(depth, 'Notable observations'), '', ...bullets.map((b) => `- ${b}`), ''];
  }

  function renderFailureFocus(result: R, trace: RequestTraceEntry[], depth = 3): string[] {
    const failingChecks = (result.checks ?? []).filter((c) => !c.passed);
    if (!failingChecks.length) {
      if (result.passed) return [];
      return [
        mdHeading(depth, 'Failure focus'),
        '',
        "- This run did not pass, but no specific failing checklist assertion was recorded — see the Error section above for the reported cause, and this artifact's `trace` array for full request/response bodies.",
        '',
      ];
    }
    const lines = [mdHeading(depth, 'Failure focus'), ''];
    for (const c of failingChecks) {
      const testId = c.testId ?? result.scenario;
      const description = wording.describeCheck(c.label);
      const expected = wording.formatCheckValue(c.label, c.expected);
      const actual = wording.formatCheckValue(c.label, c.actual);
      const relatedIndex = findRelatedTraceIndex(trace, c.actual);
      const pointer =
        relatedIndex !== undefined
          ? ` Likely related call: \`trace[${relatedIndex}]\` in the JSON artifact.`
          : " See the API call table above (and this artifact's `trace` array) for the relevant create/update/verify calls.";
      lines.push(`- **${testId}** — ${description}: expected \`${expected}\`, got \`${actual}\`.${pointer}`);
    }
    lines.push('');
    return lines;
  }

  /**
   * The full technical detail: error, project sections, steps, checklist, detail tables and the
   * evidence section. `depth` is the heading level each sub-section starts at.
   */
  function renderTechnicalAppendix(result: R, trace: RequestTraceEntry[], reportPath: string, outputPath: string, depth = 2): string[] {
    const lines: string[] = [];

    if (result.error) {
      lines.push(mdHeading(depth, 'Error'));
      lines.push(...renderErrorDetails(result.error));
      lines.push('');
    }

    lines.push(...(wording.appendixBeforeSteps?.(result, depth) ?? []));

    lines.push(mdHeading(depth, text.stepsHeading));
    lines.push(text.stepsTableHeader);
    lines.push('|---|---|---|---|');
    result.steps.forEach((step, index) => {
      const humanTitle = escapeCell(wording.describeStep(step.title));
      const technical = escapeCell(step.title);
      let resultText = `${step.ok ? '✅' : '❌'}${step.status ? ` HTTP ${step.status}` : ''}`;
      if (!step.ok) {
        const { code, message } = wording.extractError(step.data);
        if (code || message) resultText += ` — ${[code, message].filter(Boolean).join(': ')}`;
      }
      lines.push(`| ${index + 1} | ${humanTitle} | ${technical} | ${escapeCell(resultText)} |`);
    });
    lines.push('');

    if (result.checks) {
      // The CSV columns appear only when some assertion answers a checklist row.
      const withCsv = result.checks.some((c) => c.csv?.length);
      const dash = '—';
      lines.push(mdHeading(depth, text.checklistHeading));
      lines.push(withCsv ? text.checklistTableHeaderWithCsv : text.checklistTableHeader);
      lines.push(withCsv ? '|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|');
      for (const c of result.checks) {
        const testId = c.testId ?? result.scenario;
        const description = escapeCell(wording.describeCheck(c.label));
        const expected = escapeCell(wording.formatCheckValue(c.label, c.expected));
        const actual = escapeCell(wording.formatCheckValue(c.label, c.actual));
        const base = `| ${testId} | ${description} | ${expected} | ${actual} | ${CHECKPOINT_ROW_ICON[checkpointRowStatus(c)]} |`;
        if (!withCsv) {
          lines.push(base);
          continue;
        }
        const join = (parts: Array<string | undefined>): string => (parts.length ? parts.map((p) => p ?? dash).join(' | ') : dash);
        const csvIds = join((c.csv ?? []).map((m) => m.testcaseId));
        const csvExpected = join((c.csv ?? []).map((m) => m.expected));
        const csvPriority = join((c.csv ?? []).map((m) => m.priority));
        lines.push(`${base} ${escapeCell(csvIds)} | ${escapeCell(csvExpected)} | ${escapeCell(csvPriority)} |`);
      }
      lines.push('');
    }

    if (result.detailTables?.length) {
      for (const table of result.detailTables) {
        lines.push(mdHeading(depth, table.title));
        if (table.note) {
          lines.push('');
          lines.push(table.note);
        }
        lines.push('');
        lines.push(`| ${table.columns.join(' | ')} |`);
        lines.push(`|${table.columns.map(() => '---').join('|')}|`);
        for (const row of table.rows) {
          lines.push(`| ${row.map((cell) => escapeCell(cell)).join(' | ')} |`);
        }
        lines.push('');
      }
    }

    lines.push(...(wording.appendixAfterDetailTables?.(result, depth) ?? []));

    if (trace.length) {
      const artifactLink = toMarkdownLink(reportPath, outputPath);
      const rows = evidenceRows(trace);
      lines.push(mdHeading(depth, 'Evidence — API calls (input / output)'));
      lines.push('');
      lines.push(
        `Full request/response bodies (redacted) are recorded in the machine-readable artifact: [${path.basename(outputPath)}](${artifactLink}) — \`trace[N]\` below refers to that file's \`trace\` array (0-indexed).`,
      );
      lines.push('');
      lines.push(
        `This run made **${trace.length} API call${trace.length === 1 ? '' : 's'}** (${rows.length} distinct step${rows.length === 1 ? '' : 's'} after collapsing repeated polls). Overall result: **${formatOverallResult(result)}**.`,
      );
      lines.push('');
      lines.push(mdHeading(depth + 1, 'API call summary'));
      lines.push('');
      lines.push(...renderEvidenceTable(rows));
      lines.push('');
      lines.push(...renderNotableObservations(rows, trace, depth + 1));
      lines.push(...renderFailureFocus(result, trace, depth + 1));
    }

    return lines;
  }

  function buildHeader(result: R, meta: QaBuildMeta): QaReportHeader {
    const overview = result.overview;
    return {
      testCaseId: overview?.testCaseId ?? result.scenario,
      testName: overview?.testCaseName ?? result.scenario,
      executedAt: new Date().toISOString(),
      environment: result.dryRun ? text.environment.dryRun : text.environment.live,
      overallResult: overallVerdict(result),
      runId: meta.runId,
    };
  }

  function buildQaSummary(result: R): QaDecisionSummary {
    const overview = result.overview;
    const verdict = overallVerdict(result);
    return {
      businessScenario: overview?.objective ?? text.missingObjective(result.scenario),
      verdict,
      defectStatement: verdict !== 'PASS' ? overview?.attention ?? result.error?.split(' | ')[0] : undefined,
    };
  }

  /** Every failing check first, then passing ones up to the cap; original order kept. */
  function buildExpectedVsActual(result: R): QaCheckpointRow[] {
    const checks = result.checks ?? [];
    if (!checks.length) return [];
    const notPassing = checks.filter((c) => checkpointRowStatus(c) !== 'PASS');
    const passing = checks.filter((c) => checkpointRowStatus(c) === 'PASS');
    const selected = checks.length <= MAX_KEY_CHECKS ? checks : [...notPassing, ...passing].slice(0, MAX_KEY_CHECKS);
    const selectedSet = new Set(selected);
    return checks
      .filter((c) => selectedSet.has(c))
      .map((c) => ({
        checkpoint: wording.describeCheck(c.label),
        expected: wording.formatCheckValue(c.label, c.expected),
        actual: wording.formatCheckValue(c.label, c.actual),
        result: checkpointRowStatus(c),
      }));
  }

  function buildReproStepsFromSteps(result: R): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const step of result.steps) {
      if (/^cleanup:/i.test(step.title)) continue;
      const desc = wording.describeStep(step.title);
      if (seen.has(desc)) continue;
      seen.add(desc);
      out.push(desc);
      if (out.length >= MAX_REPRO_STEPS) break;
    }
    return out;
  }

  function buildPassedScope(result: R): string[] {
    const passed = (result.checks ?? []).filter((c) => checkpointRowStatus(c) === 'PASS');
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of passed) {
      const desc = wording.describeCheck(c.label);
      if (seen.has(desc)) continue;
      seen.add(desc);
      out.push(desc);
      if (out.length >= MAX_PASSED_SCOPE) break;
    }
    return out;
  }

  function buildDefectDetails(result: R): QaDefectDetails {
    const failing = (result.checks ?? []).find((c) => checkpointRowStatus(c) === 'FAIL');
    if (!failing) {
      if (isBlockedResult(result)) {
        return {
          observedMismatch: typeof result.blocked === 'string' ? result.blocked : result.error,
          regressionNote: text.blockedRegressionNote,
        };
      }
      return {};
    }
    return {
      observedMismatch: text.observedMismatch(
        wording.describeCheck(failing.label),
        wording.formatCheckValue(failing.label, failing.expected),
        wording.formatCheckValue(failing.label, failing.actual),
      ),
      probableFailingRule: failing.testId,
    };
  }

  function buildEvidenceSummary(trace: RequestTraceEntry[]): QaEvidenceRow[] {
    return selectKeyEvidenceRows(evidenceRows(trace)).map((row, i) => ({
      evidenceId: `E${i + 1} (\`trace[${row.firstIndex}]\`${row.lastIndex !== row.firstIndex ? `–\`trace[${row.lastIndex}]\`` : ''})`,
      action: `${row.method} ${shortenEndpointForDisplay(row.url)}`,
      keyInput: row.keyInput,
      keyOutput: row.result,
      whyItMatters: row.purpose,
    }));
  }

  function buildAppendixMeta(result: R, meta: QaBuildMeta): QaTechnicalAppendixMeta {
    const cleanupActions = result.steps.filter((s) => /^cleanup:/i.test(s.title)).map((s) => `${s.title} — ${s.ok ? 'OK' : 'FAILED'}`);
    const pollingRetries = result.steps.filter((s) => /poll|attempt \d+/i.test(s.title)).map((s) => s.title);
    return {
      keyTestData: result.overview?.keyData ?? [],
      artifactLinkText: meta.artifactLink,
      rawEvidenceNote:
        "Full request/response bodies (redacted) are in the machine-readable run artifact's `trace` array; see the API call summary table below for `trace[N]` indices.",
      pollingRetries,
      cleanupActions,
    };
  }

  function buildConclusion(result: R): string {
    const verdict = overallVerdict(result);
    const notEvaluatedCount = (result.checks ?? []).filter((c) => checkpointRowStatus(c) === 'NOT_EVALUATED').length;
    return text.conclusion({ verdict, result, notEvaluatedCount });
  }

  function buildDefaultReportModel(result: R, trace: RequestTraceEntry[], meta: QaBuildMeta): QaReportModel {
    return {
      header: buildHeader(result, meta),
      qaSummary: buildQaSummary(result),
      expectedVsActual: buildExpectedVsActual(result),
      reproSteps: buildReproStepsFromSteps(result),
      passedScope: buildPassedScope(result),
      defectDetails: buildDefectDetails(result),
      evidenceSummary: buildEvidenceSummary(trace),
      appendixMeta: buildAppendixMeta(result, meta),
      conclusion: buildConclusion(result),
    };
  }

  function buildReportModel(result: R, trace: RequestTraceEntry[], paths: ReportPaths): QaReportModel {
    const base = buildDefaultReportModel(result, trace, {
      runId: paths.runId,
      artifactLink: `[${path.basename(paths.outputPath)}](${toMarkdownLink(paths.reportPath, paths.outputPath)})`,
    });
    const merged = mergeReportModel(base, result.reportModel);
    // A scenario may override qaSummary (and its verdict) without touching header; they must agree.
    return { ...merged, header: { ...merged.header, overallResult: merged.qaSummary.verdict } };
  }

  function renderCheckpointTable(rows: QaReportModel['expectedVsActual']): string[] {
    if (!rows.length) return [text.noCheckpoints, ''];
    const withCsv = rows.some((r) => r.csvTestcaseId ?? r.csvExpected ?? r.csvPriority);
    const dash = '—';
    const lines = withCsv
      ? ['| Checkpoint | Expected | Actual | Result | CSV testcase ID | CSV expected | CSV priority |', '|---|---|---|---|---|---|---|']
      : ['| Checkpoint | Expected | Actual | Result |', '|---|---|---|---|'];
    for (const r of rows) {
      const base = `| ${escapeCell(r.checkpoint)} | ${escapeCell(r.expected)} | ${escapeCell(r.actual)} | ${CHECKPOINT_ROW_ICON[r.result]} |`;
      lines.push(
        withCsv ? `${base} ${escapeCell(r.csvTestcaseId ?? dash)} | ${escapeCell(r.csvExpected ?? dash)} | ${escapeCell(r.csvPriority ?? dash)} |` : base,
      );
    }
    lines.push('');
    return lines;
  }

  function renderEvidenceSummaryTable(rows: QaReportModel['evidenceSummary']): string[] {
    if (!rows.length) return [text.noApiCalls, ''];
    const lines = ['| Evidence ID | Action | Key input | Key output | Why it matters |', '|---|---|---|---|---|'];
    for (const r of rows) {
      lines.push(`| ${r.evidenceId} | ${escapeCell(r.action)} | ${escapeCell(r.keyInput)} | ${escapeCell(r.keyOutput)} | ${escapeCell(r.whyItMatters)} |`);
    }
    lines.push('');
    return lines;
  }

  /** The QA/QC Markdown report: a triage summary (sections 1-7, 9) plus the full technical appendix (section 8). */
  function renderQaMarkdown(model: QaReportModel, result: R, trace: RequestTraceEntry[], reportPath: string, outputPath: string): string {
    const lines: string[] = [];
    const { header, qaSummary, defectDetails, appendixMeta } = model;

    lines.push(`# Test Report: ${header.testName}`);
    lines.push('');

    lines.push('## 1. Report Header');
    lines.push('');
    lines.push(`- Test case ID: \`${header.testCaseId}\``);
    lines.push(`- Test name: ${header.testName}`);
    lines.push(`- Execution timestamp: ${header.executedAt}`);
    lines.push(`- Environment / mode: ${header.environment}`);
    lines.push(`- Overall result: **${header.overallResult}**`);
    if (header.relatedBugs?.length) lines.push(`- Related bugs: ${header.relatedBugs.join(', ')}`);
    lines.push(`- Run/artifact ID: \`${header.runId}\``);
    lines.push('');

    lines.push('## 2. QA/QC Decision Summary');
    lines.push('');
    lines.push(`- Business scenario: ${qaSummary.businessScenario}`);
    lines.push(`- Final verdict: **${qaSummary.verdict}**`);
    if (qaSummary.severity) lines.push(`- Severity: ${qaSummary.severity}`);
    if (qaSummary.reproducibility) lines.push(`- Reproducibility: ${qaSummary.reproducibility}`);
    if (qaSummary.defectStatement) lines.push(`- Defect statement: ${qaSummary.defectStatement}`);
    if (qaSummary.impactedArea) lines.push(`- Impacted functional area: ${qaSummary.impactedArea}`);
    lines.push('');

    lines.push('## 3. Expected vs Actual');
    lines.push('');
    lines.push(...renderCheckpointTable(model.expectedVsActual));

    lines.push('## 4. Business Reproduction Steps');
    lines.push('');
    if (!model.reproSteps.length) {
      lines.push(text.noReproSteps);
      lines.push('');
    } else {
      model.reproSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
      lines.push('');
    }

    lines.push('## 5. Scope of What Passed');
    lines.push('');
    lines.push(...bulletsOrNone(model.passedScope, text.noPassedScope));

    lines.push('## 6. Defect Details');
    lines.push('');
    const hasDefect = Boolean(defectDetails.observedMismatch || defectDetails.probableFailingRule || defectDetails.regressionNote || defectDetails.suspectedComponent);
    if (!hasDefect) {
      lines.push(`- ${text.noDefect}`);
    } else {
      if (defectDetails.observedMismatch) lines.push(`- Observed mismatch: ${defectDetails.observedMismatch}`);
      if (defectDetails.probableFailingRule) lines.push(`- Probable failing rule: ${defectDetails.probableFailingRule}`);
      if (defectDetails.regressionNote) lines.push(`- Regression note: ${defectDetails.regressionNote}`);
      if (defectDetails.suspectedComponent) lines.push(`- Suspected boundary/component: ${defectDetails.suspectedComponent}`);
    }
    lines.push('');

    lines.push('## 7. Evidence Summary');
    lines.push('');
    lines.push(...renderEvidenceSummaryTable(model.evidenceSummary));

    lines.push('## 8. Technical Appendix');
    lines.push('');
    lines.push('Key facts:');
    lines.push('');
    lines.push(...bulletsOrNone(appendixMeta.keyTestData, text.noKeyData));
    lines.push(`- Full trace artifact: ${appendixMeta.artifactLinkText}`);
    lines.push(`- ${appendixMeta.rawEvidenceNote}`);
    if (appendixMeta.pollingRetries.length) {
      lines.push(`- ${text.pollingRetries(appendixMeta.pollingRetries.length)}`);
    }
    if (appendixMeta.cleanupActions.length) {
      lines.push('- Cleanup actions:');
      for (const c of appendixMeta.cleanupActions) lines.push(`  - ${c}`);
    }
    lines.push('');
    lines.push(...renderTechnicalAppendix(result, trace, reportPath, outputPath, 3));

    lines.push('## 9. Final Conclusion');
    lines.push('');
    lines.push(model.conclusion);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * The structured, reviewable run artifact. `visualSteps` mirrors `trace` one-for-one — every HTTP
   * call gets its own card — rather than the scenario's logical steps, which often issue several calls.
   */
  function buildRunArtifact(result: R, trace: RequestTraceEntry[], runId?: string): RunArtifact {
    const visualSteps: VisualStep[] = trace.map((entry, i) => ({
      index: i,
      title: `${entry.method} ${entry.url}`,
      ok: !entry.error && entry.status < 400,
      status: entry.status,
      method: entry.method,
      url: entry.url,
      requestBody: entry.requestBody,
      responseBody: entry.responseBody,
      error: entry.error,
    }));

    return {
      schemaVersion: 1,
      runId: runId ?? newRunId(),
      scenario: result.scenario,
      dryRun: result.dryRun,
      passed: result.passed,
      blocked: isBlockedResult(result),
      generatedAt: new Date().toISOString(),
      summary: {
        totalSteps: result.steps.length,
        failedSteps: result.steps.filter((s) => !s.ok).length,
      },
      steps: result.steps,
      visualSteps,
      checks: result.checks,
      ...(wording.artifactFields?.(result) ?? {}),
      error: result.error,
      overview: result.overview,
      trace,
    };
  }

  return {
    wording,
    formatOverallResult,
    overallVerdict,
    buildEvidenceRows: evidenceRows,
    renderTechnicalAppendix,
    buildHeader,
    buildQaSummary,
    buildExpectedVsActual,
    buildReproStepsFromSteps,
    buildPassedScope,
    buildDefectDetails,
    buildEvidenceSummary,
    buildAppendixMeta,
    buildConclusion,
    buildDefaultReportModel,
    buildReportModel,
    renderQaMarkdown,
    buildRunArtifact,
  };
}
