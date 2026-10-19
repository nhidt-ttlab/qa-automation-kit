import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { rebuildCsvMeta } from '../checklist/flatten.js';
import type { RequestTraceEntry } from '../http/http-client.js';
import type { QaReportModel } from '../report/model.js';
import type { DetailTable, ReportableResult, RunArtifact } from '../report/result.js';
import { parseJsonColumn } from './json.js';
import type { StoredPayload } from './persist-run.js';

export interface StoredRun {
  runId: string;
  model: QaReportModel;
  /** The generic result, rebuilt from the run, check and step rows. */
  result: ReportableResult;
  trace: RequestTraceEntry[];
  /** Used only for relative-link math; never read. */
  reportPath: string;
  /** The JSON run artifact — read, for `trace`. */
  outputPath: string;
  /** `test_runs.payloads`, for projects that store domain subjects there. */
  payloads: StoredPayload[];
  /** `test_runs.custom_data`, including `detailTables`. */
  customData: Record<string, unknown>;
}

export interface LoadRunOptions {
  /** Directory stored artifact paths are relative to. */
  rootDir: string;
  /** Where the Markdown report would be when no `markdown_report` artifact was recorded. */
  fallbackReportPath(scenarioKey: string, runId: string): string;
}

interface TestRunRow {
  id: string;
  scenario_key: string;
  dry_run: number;
  result: 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED' | 'ERROR';
  blocked_reason: string | null;
  error_summary: string | null;
  payloads: string | null;
  custom_data: string | null;
  report_model: string | null;
}

interface CheckRow {
  seq: number;
  test_id: string | null;
  label: string;
  expected: string | null;
  actual: string | null;
  passed: number;
  csv_checklist_id: string | null;
  csv_testcase_id: string | null;
  csv_expected: string | null;
  csv_business_rule: string | null;
  csv_priority: string | null;
}

interface StepRow {
  seq: number;
  title: string;
  ok: number;
  http_status: number | null;
  details: string | null;
}

/**
 * Reconstructs one run's report inputs from the database plus its JSON run artifact (for the raw
 * trace). `model` is the primary source for the summary sections; `result`/`trace` feed the
 * technical appendix. Throws when the run, its `report_model`, or its artifact can't be read —
 * there is no silent partial reconstruction.
 */
export function loadRunFromStore(db: DatabaseSync, runId: string, options: LoadRunOptions): StoredRun {
  const run = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(runId) as TestRunRow | undefined;
  if (!run) throw new Error(`no test_runs row found for run id "${runId}"`);

  const model = parseJsonColumn<QaReportModel>(run.report_model);
  if (!model) {
    throw new Error(
      `run "${runId}" has no persisted report_model — it was likely written before this column existed and cannot be faithfully reconstructed from DB alone.`,
    );
  }

  const artifactRows = db.prepare('SELECT kind, path FROM artifacts WHERE run_id = ?').all(runId) as unknown as Array<{ kind: string; path: string | null }>;
  const jsonArtifact = artifactRows.find((a) => a.kind === 'json_run_artifact');
  if (!jsonArtifact?.path) {
    throw new Error(`no json_run_artifact recorded for run "${runId}" — cannot recover the request/response trace.`);
  }
  const mdArtifact = artifactRows.find((a) => a.kind === 'markdown_report');

  const outputPath = path.join(options.rootDir, jsonArtifact.path);
  // Only its directory matters (relative-link math); the real base name isn't recoverable from the DB.
  const reportPath = mdArtifact?.path ? path.join(options.rootDir, mdArtifact.path) : options.fallbackReportPath(run.scenario_key, runId);

  let trace: RequestTraceEntry[];
  try {
    const rawArtifact = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as Partial<RunArtifact>;
    trace = rawArtifact.trace ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to read referenced json_run_artifact at "${outputPath}" for run "${runId}": ${message}`);
  }

  const checkRows = db
    .prepare('SELECT seq, test_id, label, expected, actual, passed, csv_checklist_id, csv_testcase_id, csv_expected, csv_business_rule, csv_priority FROM test_run_checks WHERE run_id = ? ORDER BY seq')
    .all(runId) as unknown as CheckRow[];
  const stepRows = db.prepare('SELECT seq, title, ok, http_status, details FROM test_run_steps WHERE run_id = ? ORDER BY seq').all(runId) as unknown as StepRow[];

  const customData = parseJsonColumn<Record<string, unknown>>(run.custom_data) ?? {};

  const result: ReportableResult = {
    scenario: run.scenario_key,
    dryRun: Boolean(run.dry_run),
    // Only the literal PASS counts as a full pass.
    passed: run.result === 'PASS',
    // Reflects whatever was recorded: a PARTIAL run can carry its own blocked reason too.
    blocked: run.blocked_reason ?? undefined,
    blockedReason: run.blocked_reason ?? undefined,
    steps: stepRows.map((s) => ({
      title: s.title,
      ok: Boolean(s.ok),
      status: s.http_status ?? undefined,
      data: parseJsonColumn(s.details),
    })),
    checks: checkRows.map((c) => ({
      label: c.label,
      expected: parseJsonColumn(c.expected),
      actual: parseJsonColumn(c.actual),
      passed: Boolean(c.passed),
      testId: c.test_id ?? undefined,
      csv: rebuildCsvMeta(c),
    })),
    error: run.error_summary ?? undefined,
    detailTables: customData.detailTables as DetailTable[] | undefined,
  };

  return {
    runId,
    model,
    result,
    trace,
    reportPath,
    outputPath,
    payloads: parseJsonColumn<StoredPayload[]>(run.payloads) ?? [],
    customData,
  };
}
