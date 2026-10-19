/**
 * One-way, idempotent import of the regression runner's SQLite database into Postgres.
 *
 * This is the library form: no argv, no dotenv, no PrismaClient of its own, no console. Every
 * dependency arrives through `SqliteSyncOptions` and every line of output goes to `onProgress`,
 * so the same code serves the `db:sync` CLI (apps/api/scripts/sync-from-sqlite.ts) and the
 * regression-jobs runner, which streams the progress into a job's live log.
 *
 * The regression runner still owns and writes `db/regression.db` via raw
 * `node:sqlite`; this API reads Postgres. This script is the bridge: its first run migrates
 * the full history, and every run after that picks up only what the runner has added since.
 *
 *   pnpm --filter @qakit/reporting-api run db:sync   (or `pnpm db:sync` from the workspace root)
 *
 * Source file: $REGRESSION_SQLITE_PATH, defaulting to <$REGRESSION_RUNNER_PATH>/db/regression.db.
 *
 * Pass 5 additionally derives `run_type` and copies each UI run's browser evidence out of
 * the runner's `evidence/` tree into EVIDENCE_STORAGE_PATH, so the reporting app can serve
 * screenshots without the runner checked out. See sync-ui-evidence.ts.
 *
 * Pass 4.5 projects the unresolved evidence of the runs pass 2 just imported into the Resolution
 * Queue. It reads Postgres, never SQLite, so no comment, decision or resolution can travel back
 * into the runner's database. Pass `--repair-resolution` to re-scan the full history instead of
 * only the new runs.
 *
 * Deliberately NOT imported: `bug_links`. The runner never writes them — `persist-run.ts` touches
 * only `defect_signatures` and `defect_observations` — so they exist solely as rows this API
 * created through `linkRedmine`, and importing would risk clobbering API-owned data.
 *
 * Deliberately NOT exported either: everything under `resolution_*`. Those tables are API-owned
 * in exactly the same sense as `bug_links`, and this script must never learn to write them back.
 */
import * as fs from 'fs';
import Database from 'better-sqlite3';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  ResolutionProjectionService,
  formatProjectionReport,
  type ProjectionReport,
} from '../resolution/resolution-projection.service';
import { csvColumnsFromSqliteCheck } from './checklist-backfill.util';
import {
  initialDefectFields,
  runnerOwnedDefectFields,
} from '../defects/defect-sync.util';
import { syncUiEvidence, type UiEvidenceSyncStats } from './sync-ui-evidence';

/**
 * Everything the sync needs from its caller. Paths are resolved by the caller rather than read
 * from `process.env` here, so the CLI and the API agree on one runner checkout instead of each
 * growing its own copy of the resolution logic.
 */
export interface SqliteSyncOptions {
  prisma: PrismaClient;
  /** Injected so the API reuses its own singleton instead of building a second one per call. */
  projection: ResolutionProjectionService;
  sqlitePath: string;
  runnerRoot: string;
  evidenceRoot: string;
  /**
   * Re-project every historical BLOCKED/PARTIAL/ERROR run instead of only the runs this pass
   * imported. Idempotent either way; a full scan is just slow enough not to want by default.
   */
  repairResolution?: boolean;
  /** Pass an array to collect warnings across several calls; one is created when omitted. */
  warnings?: string[];
  /** Progress-line sink. Omit to stay silent, which is what a non-interactive caller wants. */
  onProgress?: (message: string) => void;
}

export interface SqliteSyncStats {
  testCases: number;
  runs: number;
  runsSkipped: number;
  checks: number;
  steps: number;
  evidence: number;
  relatedEntities: number;
  artifacts: number;
  defectSignatures: number;
  defectObservations: number;
}

export interface SqliteSyncReport {
  stats: SqliteSyncStats;
  /** The run ids this pass actually inserted. Empty on a repeat sync, which is the point. */
  importedRunIds: string[];
  projection: ProjectionReport;
  uiEvidence: UiEvidenceSyncStats;
  warnings: string[];
  sqlitePath: string;
  durationMs: number;
}

/**
 * SQLite stores U+0000 in TEXT without complaint; Postgres accepts it in neither `text` nor
 * `jsonb` and fails the whole statement with SQLSTATE 22P05, "unsupported Unicode escape
 * sequence". A scenario that captures a binary response body as a string — an XLSX download
 * reported as "Thân phản hồi lượt gọi API: PK\u0003\u0004..." — therefore poisons every run in
 * its RUN_BATCH_SIZE transaction, and every batch after it. The character carries no information
 * on this side, so strip it rather than let one such run block the import.
 */
const NUL = /\u0000/g;

/** Strips U+0000 from every string in a parsed JSON value, object keys included. */
function stripNul<T>(value: T): T {
  if (typeof value === 'string') return value.replace(NUL, '') as T;
  if (Array.isArray(value)) return value.map(stripNul) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key.replace(NUL, '')] = stripNul(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Same treatment for a SQLite row's own TEXT columns, one level deep — rows are flat, and a
 * shallow walk leaves `artifacts.blob` (a Buffer, legitimately full of NUL bytes) alone.
 * JSON columns are still raw text here, where the NUL is the six-character escape `\u0000`
 * rather than the character; `toJson` strips those once `JSON.parse` has turned them back.
 */
function scrubRow<T extends object>(row: T): T {
  let dirty = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (typeof value === 'string' && value.includes('\u0000')) {
      out[key] = value.replace(NUL, '');
      dirty = true;
    } else {
      out[key] = value;
    }
  }
  return dirty ? (out as T) : row;
}

/**
 * The value converters that need somewhere to report malformed input.
 *
 * A factory rather than module-level functions because `warnings` is now per-call: two syncs
 * running in the same process must not pool their warnings, and a module-level array would also
 * grow without bound in a long-lived API process.
 */
function createConverters(warnings: string[]) {
  /**
   * JSON TEXT -> a value Prisma writes into a `jsonb` column. Returns `undefined` (leaving the
   * column NULL) rather than throwing on malformed JSON: one bad legacy row must not abort the
   * whole import, so it is reported in the summary and skipped. NUL is stripped for the same
   * reason — see `stripNul` — but reported rather than silently dropped.
   */
  function toJson(value: string | null | undefined, where: string): never {
    if (value === null || value === undefined || value === '') return undefined as never;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      warnings.push(`${where}: malformed JSON, imported as NULL`);
      return undefined as never;
    }
    // `value` is TEXT in the runner's schema but better-sqlite3 hands back whatever the column
    // actually holds, so a legacy numeric row must not turn this check into a crash.
    if (typeof value === 'string' && value.includes('\\u0000')) {
      warnings.push(`${where}: stripped U+0000, which Postgres rejects in jsonb`);
    }
    return stripNul(parsed) as never;
  }

  return { toJson };
}


// --- SQLite -> Postgres value conversion ------------------------------------------------
// The runner stores timestamps as ISO-8601 TEXT, booleans as INTEGER 0/1, and JSON as TEXT.

/** ISO-8601 TEXT -> Date. */
function toDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`unparseable timestamp: ${value}`);
  return d;
}

function toRequiredDate(value: string, column: string): Date {
  const d = toDate(value);
  if (!d) throw new Error(`${column} is unexpectedly null`);
  return d;
}

/** INTEGER 0/1 -> boolean. */
function toBool(value: number | null | undefined): boolean {
  return value === 1;
}


// --- Source row shapes (SQLite storage types, not the Prisma ones) ----------------------

interface SqliteTestCase {
  id: string;
  scenario_key: string;
  title: string;
  objective: string | null;
  impacted_area: string | null;
  // Stamped by the runner (persist-run.ts#resolveGrouping) from the scenario key; copied across
  // verbatim, never re-derived here. NULL module = the producer was not a registered scenario.
  // Rows the runner wrote before those columns existed read as NULL, not as an absent property.
  module: string | null;
  domain: string | null;
  // ERP Feature List id, same provenance as module/domain. NULL when the scenario declares no
  // `const FEATURE_ID`, and also NULL for rows the runner wrote before the column existed.
  feature_id: string | null;
  owner: string | null;
  status: string;
  version_label: string | null;
  tags: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

interface SqliteTestRun {
  id: string;
  test_case_id: string;
  scenario_key: string;
  module: string | null;
  domain: string | null;
  environment: string;
  dry_run: number;
  result: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  executed_by: string | null;
  git_commit: string | null;
  git_branch: string | null;
  business_scenario: string | null;
  severity: string | null;
  reproducibility: string | null;
  defect_statement: string | null;
  blocked_reason: string | null;
  error_summary: string | null;
  conclusion: string | null;
  overview_key_data: string | null;
  overview_highlights: string | null;
  payloads: string | null;
  tags: string | null;
  custom_data: string | null;
  report_model: string | null;
  created_at: string;
}

interface SqliteCheck {
  run_id: string;
  seq: number;
  test_id: string | null;
  label: string;
  expected: string | null;
  actual: string | null;
  passed: number;
  /**
   * Hardening-checklist snapshot. Optional on the TypeScript side, not just nullable: a runner
   * database created before these columns existed returns rows without the properties at all, and
   * `SELECT *` will happily hand those over. Typing them as `string | null` would make the reader
   * claim a guarantee the file cannot give.
   */
  csv_checklist_id?: string | null;
  csv_testcase_id?: string | null;
  csv_expected?: string | null;
  csv_business_rule?: string | null;
  csv_priority?: string | null;
}

interface SqliteStep {
  run_id: string;
  seq: number;
  title: string;
  ok: number;
  http_status: number | null;
  details: string | null;
}

interface SqliteEvidence {
  run_id: string;
  seq: number;
  method: string;
  endpoint: string;
  purpose: string | null;
  key_input: string | null;
  http_status: number | null;
  result_classification: string | null;
  collapsed_count: number;
  is_key_evidence: number;
  artifact_id: number | null;
}

interface SqliteRelatedEntity {
  run_id: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
}

interface SqliteArtifact {
  run_id: string;
  kind: string;
  storage_type: string;
  path: string | null;
  blob: Buffer | null;
  external_url: string | null;
  content_hash: string | null;
  size_bytes: number | null;
  created_at: string;
}

interface SqliteDefectSignature {
  id: number;
  signature_hash: string;
  scenario_key: string;
  title: string;
  severity: string | null;
  probable_failing_rule: string | null;
  suspected_component: string | null;
  regression_note: string | null;
  status: string;
  first_observed_run_id: string | null;
  last_observed_run_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SqliteDefectObservation {
  id: number;
  defect_signature_id: number;
  run_id: string;
  defect_statement: string | null;
  observed_at: string;
}

// --- Passes -------------------------------------------------------------------------------

const RUN_BATCH_SIZE = 25;

/**
 * Makes `wantedId` free so `forScenario` can take it, returning false if it cannot.
 *
 * The runner does renumber test cases — `TC-DH-U10` moved from `ui-po-create-order-full-input`
 * to `ui-po-create-order-required-only` — and a plain upsert cannot express that: whichever of
 * the two is processed first, the second one's INSERT hits test_cases_pkey and the whole sync
 * dies before a single run is imported. Handing an id over needs the holder out of the way first,
 * which is the classic two-phase rename.
 *
 * The holder is parked on a reserved id rather than deleted; its own SQLite row assigns the final
 * one later in the same loop. The FK from test_runs is ON UPDATE CASCADE, so its runs follow it
 * across both moves and no evidence is lost. If the process dies while a row is parked, the next
 * sync sees the same mismatch and completes the rename — the parked state is recoverable, not
 * terminal.
 */
const PARKED_ID_PREFIX = '__resync__';

async function ensureTestCaseIdAvailable(
  prisma: PrismaClient,
  wantedId: string,
  forScenario: string,
  sqliteIdByScenario: Map<string, string>,
  warnings: string[],
): Promise<boolean> {
  const clash = await prisma.testCase.findUnique({
    where: { id: wantedId },
    select: { scenarioKey: true },
  });
  if (!clash || clash.scenarioKey === forScenario) return true;

  const holderWants = sqliteIdByScenario.get(clash.scenarioKey);
  if (!holderWants || holderWants === wantedId) {
    // The holder still owns this id according to the runner (or the runner no longer knows the
    // holder at all). Taking it would be wrong, so the caller keeps its current id instead.
    return false;
  }

  const parkedId = `${PARKED_ID_PREFIX}${clash.scenarioKey}`.slice(0, 200);
  await prisma.testCase.update({ where: { id: wantedId }, data: { id: parkedId } });
  warnings.push(
    `test_cases.${clash.scenarioKey}: id ${wantedId} handed to ${forScenario}; parked on ` +
      `${parkedId} until its own row assigns ${holderWants}`,
  );
  return true;
}

export async function syncFromSqlite(
  options: SqliteSyncOptions,
): Promise<SqliteSyncReport> {
  const {
    prisma,
    projection,
    sqlitePath,
    runnerRoot,
    evidenceRoot,
    repairResolution = false,
  } = options;
  const warnings = options.warnings ?? [];
  const log = options.onProgress ?? ((): void => {});
  const { toJson } = createConverters(warnings);
  const startedMs = Date.now();

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(
      `Regression SQLite database not found at ${sqlitePath}. ` +
        `Set REGRESSION_SQLITE_PATH or REGRESSION_RUNNER_PATH in apps/api/.env.`,
    );
  }

  log(`Source (SQLite):   ${sqlitePath}`);

  // Read-only and fileMustExist are load-bearing, not defensive: this process must never be able
  // to write the runner's database, and resolution-boundaries.spec.ts asserts exactly that.
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });

  const stats: SqliteSyncStats = {
    testCases: 0,
    runs: 0,
    runsSkipped: 0,
    checks: 0,
    steps: 0,
    evidence: 0,
    relatedEntities: 0,
    artifacts: 0,
    defectSignatures: 0,
    defectObservations: 0,
  };

  try {
    // --- Pass 1: test_cases -----------------------------------------------------------
    // Upserted on scenario_key, the natural key the runner itself upserts on
    // (persist-run.ts#upsertTestCase looks rows up by scenario_key, not by id).
    //
    // The id has to be kept in step as well, not just the payload columns: test_runs points
    // at test_cases through the composite FK (test_case_id, scenario_key), so a Postgres row
    // whose id has drifted from SQLite's makes pass 2 fail with P2003. That drift is real —
    // scenarios first synced before the runner gave them a TC-* id still sit here with
    // id === scenario_key. Realigning the id is safe: the FK is ON UPDATE CASCADE, so runs
    // already imported under the old id follow it across.
    const testCaseIdByScenario = new Map<string, string>();
    const testCases = (
      sqlite.prepare('SELECT * FROM test_cases').all() as SqliteTestCase[]
    ).map(scrubRow);
    const sqliteIdByScenario = new Map(testCases.map((tc) => [tc.scenario_key, tc.id]));
    for (const tc of testCases) {
      let id = tc.id;
      const existing = await prisma.testCase.findUnique({
        where: { scenarioKey: tc.scenario_key },
        select: { id: true },
      });
      // The clash check applies to inserts too, not just re-ids: a scenario new to Postgres can
      // want an id that an older scenario still holds here, which is exactly what happens when
      // the runner moves a TC-* id from one scenario to another.
      if (!existing || existing.id !== id) {
        const available = await ensureTestCaseIdAvailable(
          prisma,
          id,
          tc.scenario_key,
          sqliteIdByScenario,
          warnings,
        );
        if (!available) {
          // Keep whatever id this scenario already has, or fall back to the legacy
          // id === scenario_key shape for a brand new one. Pass 2 resolves runs through
          // testCaseIdByScenario either way, so the import still completes.
          const fallback = existing?.id ?? tc.scenario_key;
          warnings.push(
            `test_cases.${tc.scenario_key}: id ${id} is held by another scenario; ` +
              `used ${fallback} instead`,
          );
          id = fallback;
        } else if (existing) {
          log(`test_cases:          re-id ${existing.id} -> ${id}`);
        }
      }
      const data = {
        id,
        scenarioKey: tc.scenario_key,
        title: tc.title,
        objective: tc.objective,
        impactedArea: tc.impacted_area,
        module: tc.module ?? null,
        domain: tc.domain ?? null,
        featureId: tc.feature_id ?? null,
        owner: tc.owner,
        status: tc.status,
        versionLabel: tc.version_label,
        tags: toJson(tc.tags, `test_cases.${tc.id}.tags`),
        metadata: toJson(tc.metadata, `test_cases.${tc.id}.metadata`),
        createdAt: toRequiredDate(tc.created_at, 'test_cases.created_at'),
        updatedAt: toRequiredDate(tc.updated_at, 'test_cases.updated_at'),
      };
      const saved = await prisma.testCase.upsert({
        where: { scenarioKey: tc.scenario_key },
        create: data,
        update: data,
      });
      testCaseIdByScenario.set(tc.scenario_key, saved.id);
      stats.testCases += 1;
    }
    log(`test_cases:          ${stats.testCases} upserted`);

    // --- Pass 2: test_runs and their children -----------------------------------------
    // Run rows are immutable once the runner writes them, so "insert if absent" is enough
    // and avoids needing a natural key for every child table. Children get fresh Postgres
    // identity values; nothing outside the run references them (see the artifact_id note
    // below), so the SQLite integer ids are intentionally not preserved.
    const sourceRunIds = (
      sqlite.prepare('SELECT id FROM test_runs').all() as Array<{ id: string }>
    ).map((r) => r.id);
    const existingRunIds = new Set(
      (
        await prisma.testRun.findMany({
          where: { id: { in: sourceRunIds } },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    const missingRunIds = sourceRunIds.filter((id) => !existingRunIds.has(id));
    stats.runsSkipped = sourceRunIds.length - missingRunIds.length;

    const runStmt = sqlite.prepare('SELECT * FROM test_runs WHERE id = ?');
    const checksStmt = sqlite.prepare(
      'SELECT * FROM test_run_checks WHERE run_id = ? ORDER BY seq',
    );
    const stepsStmt = sqlite.prepare(
      'SELECT * FROM test_run_steps WHERE run_id = ? ORDER BY seq',
    );
    const evidenceStmt = sqlite.prepare(
      'SELECT * FROM test_run_evidence WHERE run_id = ? ORDER BY seq',
    );
    const entitiesStmt = sqlite.prepare(
      'SELECT * FROM test_run_related_entities WHERE run_id = ?',
    );
    const artifactsStmt = sqlite.prepare(
      'SELECT * FROM artifacts WHERE run_id = ? ORDER BY id',
    );

    for (let i = 0; i < missingRunIds.length; i += RUN_BATCH_SIZE) {
      const batch = missingRunIds.slice(i, i + RUN_BATCH_SIZE);
      const creates = batch.map((runId) => {
        const run = scrubRow(runStmt.get(runId) as SqliteTestRun);
        const checks = (checksStmt.all(runId) as SqliteCheck[]).map(scrubRow);
        const steps = (stepsStmt.all(runId) as SqliteStep[]).map(scrubRow);
        const evidence = (evidenceStmt.all(runId) as SqliteEvidence[]).map(scrubRow);
        const entities = (
          entitiesStmt.all(runId) as SqliteRelatedEntity[]
        ).map(scrubRow);
        const artifacts = (artifactsStmt.all(runId) as SqliteArtifact[]).map(scrubRow);

        for (const e of evidence) {
          // persist-run.ts#insertEvidence never populates artifact_id, so there is no
          // child-to-child id mapping to maintain. Flag it loudly if that ever changes.
          if (e.artifact_id !== null) {
            warnings.push(
              `test_run_evidence(${runId}, seq ${e.seq}) has artifact_id=${e.artifact_id}; imported as NULL`,
            );
          }
        }

        stats.checks += checks.length;
        stats.steps += steps.length;
        stats.evidence += evidence.length;
        stats.relatedEntities += entities.length;
        stats.artifacts += artifacts.length;

        return prisma.testRun.create({
          data: {
            id: run.id,
            // Pass 1's id, not the SQLite one: they differ whenever a rename was held back
            // by a colliding id, and only the Postgres id satisfies the composite FK.
            testCaseId: testCaseIdByScenario.get(run.scenario_key) ?? run.test_case_id,
            scenarioKey: run.scenario_key,
            module: run.module ?? null,
            domain: run.domain ?? null,
            environment: run.environment,
            dryRun: toBool(run.dry_run),
            result: run.result,
            startedAt: toRequiredDate(run.started_at, 'test_runs.started_at'),
            finishedAt: toDate(run.finished_at),
            durationMs: run.duration_ms,
            executedBy: run.executed_by,
            gitCommit: run.git_commit,
            gitBranch: run.git_branch,
            businessScenario: run.business_scenario,
            severity: run.severity,
            reproducibility: run.reproducibility,
            defectStatement: run.defect_statement,
            blockedReason: run.blocked_reason,
            errorSummary: run.error_summary,
            conclusion: run.conclusion,
            overviewKeyData: toJson(
              run.overview_key_data,
              `test_runs.${runId}.overview_key_data`,
            ),
            overviewHighlights: toJson(
              run.overview_highlights,
              `test_runs.${runId}.overview_highlights`,
            ),
            payloads: toJson(run.payloads, `test_runs.${runId}.payloads`),
            tags: toJson(run.tags, `test_runs.${runId}.tags`),
            customData: toJson(run.custom_data, `test_runs.${runId}.custom_data`),
            reportModel: toJson(run.report_model, `test_runs.${runId}.report_model`),
            createdAt: toRequiredDate(run.created_at, 'test_runs.created_at'),
            checks: {
              create: checks.map((c) => ({
                sequence: c.seq,
                testId: c.test_id,
                label: c.label,
                expected: toJson(
                  c.expected,
                  `test_run_checks.${runId}.${c.seq}.expected`,
                ),
                actual: toJson(c.actual, `test_run_checks.${runId}.${c.seq}.actual`),
                passed: toBool(c.passed),
                // Carried across verbatim — see csvColumnsFromSqliteCheck for why this pass must
                // not re-derive the text.
                ...csvColumnsFromSqliteCheck(c),
              })),
            },
            steps: {
              create: steps.map((s) => ({
                sequence: s.seq,
                title: s.title,
                ok: toBool(s.ok),
                httpStatus: s.http_status,
                details: toJson(s.details, `test_run_steps.${runId}.${s.seq}.details`),
              })),
            },
            evidence: {
              create: evidence.map((e) => ({
                sequence: e.seq,
                method: e.method,
                endpoint: e.endpoint,
                purpose: e.purpose,
                keyInput: e.key_input,
                httpStatus: e.http_status,
                resultClassification: e.result_classification,
                collapsedCount: e.collapsed_count,
                isKeyEvidence: toBool(e.is_key_evidence),
                artifactId: null,
              })),
            },
            relatedEntities: {
              create: entities.map((en) => ({
                entityType: en.entity_type,
                entityId: en.entity_id,
                entityLabel: en.entity_label,
              })),
            },
            artifacts: {
              create: artifacts.map((a) => ({
                kind: a.kind,
                storageType: a.storage_type,
                path: a.path,
                // BLOB -> bytea. better-sqlite3 hands back a Node Buffer, which is a
                // Uint8Array over a possibly-shared ArrayBuffer; Prisma's Bytes input wants a
                // plain Uint8Array, so copy it rather than casting the type away.
                blob: a.blob ? new Uint8Array(a.blob) : null,
                externalUrl: a.external_url,
                contentHash: a.content_hash,
                sizeBytes: a.size_bytes,
                createdAt: toRequiredDate(a.created_at, 'artifacts.created_at'),
              })),
            },
          },
        });
      });

      await prisma.$transaction(creates);
      stats.runs += batch.length;
      // A plain line per batch, not a \r rewrite: the destination may be a log file or an SSE
      // stream, neither of which has a cursor to move.
      log(`test_runs:           ${stats.runs}/${missingRunIds.length} imported`);
    }
    log(
      `test_runs:           ${stats.runs} imported, ${stats.runsSkipped} already present`,
    );

    // --- Pass 3: defect_signatures ----------------------------------------------------
    // Upserted on signature_hash (unique), building a sqliteId -> pgId map for pass 4.
    //
    // `create` and `update` are deliberately NOT the same object. The runner recomputes a
    // signature's diagnostic fields on every non-PASS run and always writes status 'draft', so
    // importing the whole record on update would silently reset a status this API had moved to
    // 'submitted' or 'resolved' — the reporting app would lose triage work on the next sync and
    // give no sign it had happened. Status is reporting-owned from the moment the row exists.
    //
    // first/last_observed_run_id are seeded on create and then left to
    // trg_defect_observations_touch_signature, which maintains them from this database's own
    // observations by started_at chronology. Re-copying them from SQLite on every sync would
    // overwrite the trigger's answer with a stale one whenever the runner has purged a run that
    // Postgres still holds.
    const signatures = (
      sqlite.prepare('SELECT * FROM defect_signatures').all() as SqliteDefectSignature[]
    ).map(scrubRow);
    const signatureIdMap = new Map<number, number>();
    for (const sig of signatures) {
      // The create/update split lives in defect-sync.util.ts so the ownership boundary is a
      // tested value, not an object literal that is easy to collapse back into one `data`.
      const saved = await prisma.defectSignature.upsert({
        where: { signatureHash: sig.signature_hash },
        create: {
          ...initialDefectFields(sig),
          createdAt: toRequiredDate(sig.created_at, 'defect_signatures.created_at'),
          updatedAt: toRequiredDate(sig.updated_at, 'defect_signatures.updated_at'),
        },
        update: runnerOwnedDefectFields(sig),
      });
      signatureIdMap.set(sig.id, saved.id);
      stats.defectSignatures += 1;
    }
    log(`defect_signatures:   ${stats.defectSignatures} upserted`);

    // --- Pass 4: defect_observations --------------------------------------------------
    const observations = (
      sqlite
        .prepare('SELECT * FROM defect_observations')
        .all() as SqliteDefectObservation[]
    ).map(scrubRow);
    for (const obs of observations) {
      const pgSignatureId = signatureIdMap.get(obs.defect_signature_id);
      if (pgSignatureId === undefined) {
        warnings.push(
          `defect_observations.${obs.id} references unknown defect_signature ${obs.defect_signature_id}; skipped`,
        );
        continue;
      }
      await prisma.defectObservation.upsert({
        where: {
          defectSignatureId_runId: {
            defectSignatureId: pgSignatureId,
            runId: obs.run_id,
          },
        },
        create: {
          defectSignatureId: pgSignatureId,
          runId: obs.run_id,
          defectStatement: obs.defect_statement,
          observedAt: toRequiredDate(obs.observed_at, 'defect_observations.observed_at'),
        },
        update: { defectStatement: obs.defect_statement },
      });
      stats.defectObservations += 1;
    }
    log(`defect_observations: ${stats.defectObservations} upserted`);

    // --- Pass 4.5: Resolution Queue projection -----------------------------------------
    // Runs after the defect passes so a PARTIAL run's failed assertions have already reached
    // the defect workflow and its NOT_EVALUATED ones reach the queue: one run, two destinations,
    // never merged into a single generic issue.
    //
    // Scoped to the runs pass 2 actually inserted. A sync that imported nothing therefore
    // projects nothing and writes nothing, which is what makes a repeated `db:sync` a no-op.
    const projectionScope = repairResolution ? undefined : missingRunIds;
    log(
      repairResolution
        ? '\nResolution Queue (repair: full re-scan)'
        : '\nResolution Queue',
    );
    const projectionReport = await projection.projectRuns({
      runIds: projectionScope,
      batchSize: RUN_BATCH_SIZE,
    });
    log(formatProjectionReport(projectionReport));

    // --- Pass 5: UI evidence -----------------------------------------------------------
    // Runs over every UI run in Postgres, not just the ones pass 2 just inserted, so it also
    // backfills history. See sync-ui-evidence.ts for why.
    log(`\nUI evidence -> ${evidenceRoot}`);
    const uiStats = await syncUiEvidence({
      prisma,
      runnerRoot,
      evidenceRoot,
      warnings,
    });
    log(
      `ui runs:             ${uiStats.uiRuns} marked, ${uiStats.manifestsRead} with a manifest`,
    );
    log(`ui test_cases:       ${uiStats.uiTestCases} marked`);
    log(
      `evidence files:      ${uiStats.filesCopied} copied, ${uiStats.filesSkipped} already present`,
    );

    log('\nChildren imported alongside the new runs:');
    log(`  test_run_checks:           ${stats.checks}`);
    log(`  test_run_steps:            ${stats.steps}`);
    log(`  test_run_evidence:         ${stats.evidence}`);
    log(`  test_run_related_entities: ${stats.relatedEntities}`);
    log(`  artifacts:                 ${stats.artifacts}`);
    log(
      '\nbug_links: not imported (API-owned; the regression runner never writes them).',
    );

    if (warnings.length) {
      log(`\n${warnings.length} warning(s):`);
      for (const w of warnings.slice(0, 20)) log(`  - ${w}`);
      if (warnings.length > 20) log(`  ... and ${warnings.length - 20} more`);
    }
    log('\nSync complete.');

    return {
      stats,
      importedRunIds: missingRunIds,
      projection: projectionReport,
      uiEvidence: uiStats,
      warnings,
      sqlitePath,
      durationMs: Date.now() - startedMs,
    };
  } finally {
    // Only what this function opened. The Prisma client belongs to the caller — disconnecting it
    // here would close the API's shared pool out from under every other request.
    sqlite.close();
  }
}
