import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { flattenCsvMeta } from '../checklist/flatten.js';
import type { RequestTraceEntry } from '../http/http-client.js';
import { selectKeyEvidenceRows, shortenEndpointForDisplay, type EvidenceRow } from '../report/evidence-rows.js';
import type { QaReportModel } from '../report/model.js';
import type { ReportableResult, RunArtifact } from '../report/result.js';
import { checkpointRowStatus, deriveVerdict, isBlockedResult } from '../report/verdict.js';
import { toJsonColumn, toJsonColumnOmitEmpty } from './json.js';

export type RunVerdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED' | 'ERROR';

export interface PersistRunMeta {
  /** Target environment name, distinct from the dry-run/live distinction carried by `result.dryRun`. */
  environment: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  executedBy?: string;
}

/** Where a run belongs: suite folder, documentation module, and the spec feature id if declared. */
export interface RunGrouping {
  module?: string;
  domain: string;
  featureId?: string;
}

/** A searchable entity the run touched (project, order, item, ...). */
export interface RelatedEntity {
  entityType: string;
  entityId: string;
  entityLabel?: string;
}

/** One subject the scenario exercised, stored in `test_runs.payloads`. */
export interface StoredPayload {
  label: string;
  payload: unknown;
  context?: unknown;
}

export interface PersistRunHooks<R extends ReportableResult = ReportableResult> {
  payloads?(result: R): StoredPayload[];
  /** Extra `custom_data` fields; `undefined` values are skipped. Written before `detailTables`. */
  customData?(result: R): Record<string, unknown>;
  relatedEntities?(result: R): RelatedEntity[];
  /** Error code for the defect signature. Defaults to the first `Namespace:Area:Code`-shaped value. */
  errorCode?(result: R): string | undefined;
}

export interface PersistRunInput<R extends ReportableResult = ReportableResult> {
  result: R;
  artifact: RunArtifact;
  trace: RequestTraceEntry[];
  /** The fully resolved report model, exactly as rendered. Optional for callers that built none. */
  model: QaReportModel | undefined;
  paths: { reportPath: string; outputPath: string };
  meta: PersistRunMeta;
  /** Artifact paths are stored relative to this directory, with forward slashes. */
  rootDir: string;
  grouping: RunGrouping;
  git?: { commit?: string; branch?: string };
  /** The run's evidence manifest; recorded as an `other` artifact when the file exists. */
  evidenceManifestPath?: string;
  buildEvidenceRows(trace: RequestTraceEntry[]): EvidenceRow[];
  hooks?: PersistRunHooks<R>;
}

function n<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/**
 * `ERROR` (the scenario threw before completing) is signalled by the shape a runner's catch block
 * produces — no steps and no checks; everything else delegates to `deriveVerdict`, so the stored
 * result can never disagree with the report.
 */
export function deriveRunVerdict(result: ReportableResult): RunVerdict {
  if (!result.passed && result.steps.length === 0 && !result.checks?.length) return 'ERROR';
  return deriveVerdict({ checks: result.checks, passed: result.passed, blocked: isBlockedResult(result) });
}

export function resolveBlockedReason(result: ReportableResult): string | undefined {
  if (result.blockedReason) return result.blockedReason;
  if (typeof result.blocked === 'string' && result.blocked) return result.blocked;
  return isBlockedResult(result) ? result.error : undefined;
}

/** First `Namespace:Area:Code`-shaped value among the checks' actual values, else in `result.error`. */
export function defaultErrorCode(result: ReportableResult): string | undefined {
  const codePattern = /^[A-Za-z]+:[A-Za-z]+:[A-Za-z0-9]+$/;
  const fromChecks = (result.checks ?? []).map((c) => c.actual).find((v): v is string => typeof v === 'string' && codePattern.test(v));
  if (fromChecks) return fromChecks;
  return result.error?.match(/[A-Za-z]+:[A-Za-z]+:[A-Za-z0-9]+/)?.[0];
}

/** Dedup key for `defect_signatures`: scenario + sorted failing-check labels + error code. */
function computeSignatureHash(scenarioKey: string, failingLabels: string[], errorCode: string | undefined): string {
  const material = JSON.stringify([scenarioKey, [...failingLabels].sort(), errorCode ?? null]);
  return createHash('sha256').update(material).digest('hex');
}

function insertArtifact(db: DatabaseSync, runId: string, kind: 'markdown_report' | 'json_run_artifact' | 'other', absolutePath: string, rootDir: string): void {
  const buffer = fs.readFileSync(absolutePath);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const relPath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
  // `kind` is CHECK-constrained and an existing database keeps its original CHECK, so UI evidence
  // rides in under 'other' as one manifest pointer; the manifest carries the per-file kinds.
  db.prepare(`INSERT INTO artifacts (run_id, kind, storage_type, path, content_hash, size_bytes) VALUES (?, ?, 'file', ?, ?, ?)`).run(
    runId,
    kind,
    relPath,
    hash,
    buffer.length,
  );
}

function upsertTestCase(
  db: DatabaseSync,
  args: { scenarioKey: string; testCaseId: string; title: string; objective?: string; impactedArea?: string; grouping: RunGrouping },
): string {
  const { grouping } = args;
  const existing = db.prepare('SELECT id FROM test_cases WHERE scenario_key = ?').get(args.scenarioKey) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE test_cases SET title = ?, objective = ?, impacted_area = ?, module = ?, domain = ?, feature_id = ? WHERE scenario_key = ?').run(
      args.title,
      n(args.objective),
      n(args.impactedArea),
      n(grouping.module),
      grouping.domain,
      n(grouping.featureId),
      args.scenarioKey,
    );
    return existing.id;
  }
  db.prepare('INSERT INTO test_cases (id, scenario_key, title, objective, impacted_area, module, domain, feature_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    args.testCaseId,
    args.scenarioKey,
    args.title,
    n(args.objective),
    n(args.impactedArea),
    n(grouping.module),
    grouping.domain,
    n(grouping.featureId),
  );
  return args.testCaseId;
}

/** One row per assertion; the `csv_*` columns snapshot the checklist text the run actually saw. */
function insertChecks(db: DatabaseSync, runId: string, checks: ReportableResult['checks']): void {
  (checks ?? []).forEach((c, i) => {
    const csv = flattenCsvMeta(c.csv);
    db.prepare(
      `INSERT INTO test_run_checks (run_id, seq, test_id, label, expected, actual, passed,
                                    csv_checklist_id, csv_testcase_id, csv_expected,
                                    csv_business_rule, csv_priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId,
      i + 1,
      n(c.testId),
      c.label,
      toJsonColumn(c.expected),
      toJsonColumn(c.actual),
      c.passed ? 1 : 0,
      n(csv.csvChecklistId),
      n(csv.csvTestcaseId),
      n(csv.csvExpected),
      n(csv.csvBusinessRule),
      n(csv.csvPriority),
    );
  });
}

/** One row per step; `details` carries the step's raw `data`, needed to rebuild the steps table. */
function insertSteps(db: DatabaseSync, runId: string, steps: ReportableResult['steps']): void {
  steps.forEach((s, i) => {
    db.prepare(`INSERT INTO test_run_steps (run_id, seq, title, ok, http_status, details) VALUES (?, ?, ?, ?, ?, ?)`).run(
      runId,
      i + 1,
      s.title,
      s.ok ? 1 : 0,
      n(s.status),
      toJsonColumnOmitEmpty(s.data),
    );
  });
}

function insertEvidence(db: DatabaseSync, runId: string, trace: RequestTraceEntry[], rows: EvidenceRow[]): void {
  const keyRows = new Set(selectKeyEvidenceRows(rows));
  rows.forEach((row, i) => {
    const httpStatus = trace[row.firstIndex]?.status;
    db.prepare(
      `INSERT INTO test_run_evidence (run_id, seq, method, endpoint, purpose, key_input, http_status, result_classification, collapsed_count, is_key_evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId,
      i + 1,
      row.method,
      shortenEndpointForDisplay(row.url),
      n(row.purpose),
      n(row.keyInput),
      n(httpStatus),
      n(row.result),
      row.count,
      keyRows.has(row) ? 1 : 0,
    );
  });
}

/** Defect identity + observation for any non-PASS run (BLOCKED/ERROR included — recurring blockers are worth tracking). */
function recordDefect<R extends ReportableResult>(
  db: DatabaseSync,
  runId: string,
  verdict: RunVerdict,
  result: R,
  model: QaReportModel | undefined,
  errorCode: string | undefined,
): void {
  if (verdict === 'PASS') return;
  const scenarioKey = result.scenario;

  const failing = (result.checks ?? []).filter((c) => checkpointRowStatus(c) === 'FAIL');
  const signatureHash = computeSignatureHash(scenarioKey, failing.map((c) => c.label), errorCode);

  const defectStatement =
    model?.qaSummary.defectStatement ??
    result.reportModel?.qaSummary?.defectStatement ??
    result.overview?.attention ??
    result.error ??
    resolveBlockedReason(result);
  const title = defectStatement ?? `${scenarioKey} — ${verdict}`;
  const severity = model?.qaSummary.severity ?? result.reportModel?.qaSummary?.severity;
  const probableFailingRule = model?.defectDetails.probableFailingRule ?? result.reportModel?.defectDetails?.probableFailingRule ?? failing[0]?.testId;
  const suspectedComponent = model?.defectDetails.suspectedComponent ?? result.reportModel?.defectDetails?.suspectedComponent;
  const regressionNote = model?.defectDetails.regressionNote ?? result.reportModel?.defectDetails?.regressionNote ?? resolveBlockedReason(result);

  const existing = db.prepare('SELECT id FROM defect_signatures WHERE signature_hash = ?').get(signatureHash) as { id: number } | undefined;

  let defectSignatureId: number;
  if (existing) {
    defectSignatureId = existing.id;
    db.prepare('UPDATE defect_signatures SET title = ?, severity = ?, probable_failing_rule = ?, suspected_component = ?, regression_note = ? WHERE id = ?').run(
      title,
      n(severity),
      n(probableFailingRule),
      n(suspectedComponent),
      n(regressionNote),
      defectSignatureId,
    );
  } else {
    const info = db
      .prepare(
        `INSERT INTO defect_signatures (signature_hash, scenario_key, title, severity, probable_failing_rule, suspected_component, regression_note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(signatureHash, scenarioKey, title, n(severity), n(probableFailingRule), n(suspectedComponent), n(regressionNote));
    defectSignatureId = Number(info.lastInsertRowid);
  }

  db.prepare('INSERT OR IGNORE INTO defect_observations (defect_signature_id, run_id, defect_statement) VALUES (?, ?, ?)').run(
    defectSignatureId,
    runId,
    n(defectStatement),
  );
}

/**
 * Persists one run's full report data in a single transaction, so a mid-write failure leaves no
 * partial run behind. Throws on failure — callers that treat persistence as best-effort catch.
 *
 * `model` is stored verbatim in `test_runs.report_model`: several of its fields can be
 * scenario-authored prose that is not re-derivable from the check and step rows alone.
 */
export function writeRunToStore<R extends ReportableResult>(db: DatabaseSync, input: PersistRunInput<R>): { runId: string; testCaseId: string } {
  const { result, artifact, trace, model, paths, meta, grouping, hooks } = input;
  const runId = artifact.runId;
  const scenarioKey = result.scenario;
  const verdict = deriveRunVerdict(result);

  const customData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hooks?.customData?.(result) ?? {})) {
    if (value !== undefined) customData[key] = value;
  }
  if (result.detailTables?.length) customData.detailTables = result.detailTables;

  db.exec('BEGIN');
  try {
    const testCaseId = upsertTestCase(db, {
      scenarioKey,
      testCaseId: result.overview?.testCaseId ?? scenarioKey,
      title: result.overview?.testCaseName ?? scenarioKey,
      objective: result.overview?.objective,
      impactedArea: model?.qaSummary.impactedArea ?? result.reportModel?.qaSummary?.impactedArea,
      grouping,
    });

    db.prepare(
      `INSERT INTO test_runs (
         id, test_case_id, scenario_key, module, domain, environment, dry_run, result, started_at, finished_at, duration_ms,
         executed_by, git_commit, git_branch, business_scenario, severity, reproducibility, defect_statement,
         blocked_reason, error_summary, conclusion, overview_key_data, overview_highlights, payloads, tags, custom_data,
         report_model
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId,
      testCaseId,
      scenarioKey,
      n(grouping.module),
      grouping.domain,
      meta.environment,
      result.dryRun ? 1 : 0,
      verdict,
      meta.startedAt,
      n(meta.finishedAt),
      n(meta.durationMs),
      n(meta.executedBy),
      n(input.git?.commit),
      n(input.git?.branch),
      n(model?.qaSummary.businessScenario ?? result.reportModel?.qaSummary?.businessScenario ?? result.overview?.objective),
      n(model?.qaSummary.severity ?? result.reportModel?.qaSummary?.severity),
      n(model?.qaSummary.reproducibility ?? result.reportModel?.qaSummary?.reproducibility),
      n(model?.qaSummary.defectStatement ?? result.reportModel?.qaSummary?.defectStatement ?? result.overview?.attention),
      n(resolveBlockedReason(result)),
      n(result.error),
      n(model?.conclusion ?? result.reportModel?.conclusion),
      toJsonColumnOmitEmpty(result.overview?.keyData),
      toJsonColumnOmitEmpty(result.overview?.highlights),
      toJsonColumnOmitEmpty(hooks?.payloads?.(result) ?? []),
      null,
      toJsonColumnOmitEmpty(customData),
      toJsonColumn(model),
    );

    insertChecks(db, runId, result.checks);
    insertSteps(db, runId, result.steps);
    insertEvidence(db, runId, trace, input.buildEvidenceRows(trace));
    for (const entity of hooks?.relatedEntities?.(result) ?? []) {
      db.prepare(`INSERT OR IGNORE INTO test_run_related_entities (run_id, entity_type, entity_id, entity_label) VALUES (?, ?, ?, ?)`).run(
        runId,
        entity.entityType,
        entity.entityId,
        n(entity.entityLabel),
      );
    }
    insertArtifact(db, runId, 'markdown_report', paths.reportPath, input.rootDir);
    insertArtifact(db, runId, 'json_run_artifact', paths.outputPath, input.rootDir);
    if (input.evidenceManifestPath && fs.existsSync(input.evidenceManifestPath)) {
      insertArtifact(db, runId, 'other', input.evidenceManifestPath, input.rootDir);
    }
    recordDefect(db, runId, verdict, result, model, (hooks?.errorCode ?? defaultErrorCode)(result));

    db.exec('COMMIT');
    return { runId, testCaseId };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
