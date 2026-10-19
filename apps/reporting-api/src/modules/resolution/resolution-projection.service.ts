import { Injectable } from '@nestjs/common';
import {
  RESOLUTION_KIND,
  RESOLUTION_WORKFLOW_STATUS,
  SYSTEM_ACTOR_SYNC,
  TEST_RUN_RESULT,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import {
  emptyDiagnostics,
  extractCandidates,
  summarizeReason,
  type ExtractionDiagnostics,
  type ResolutionCandidate,
} from './resolution-extract.util';
import {
  ResolutionWorkflowService,
  type ResolutionDbClient,
} from './resolution-workflow.service';

/**
 * The Prisma delegates the projection needs. Narrowing to this rather than PrismaService is what
 * lets the same code run against the client and against a transaction client without a cast.
 */
export type ProjectionDbClient = Pick<
  PrismaService,
  'resolutionIssue' | 'resolutionObservation'
>;

/**
 * Projects imported regression evidence into Resolution Queue issues and observations.
 *
 * Reads PostgreSQL, writes PostgreSQL. It never opens the runner's SQLite file — that is the
 * whole point of running *after* `db:sync` rather than inside it: comments, decisions and
 * resolutions cannot leak back into the runner because this code has no way to reach it.
 *
 * The same method serves both callers. `db:sync` passes the run ids it just imported;
 * `db:backfill-resolution` passes nothing and gets every historical candidate run. There is no
 * second implementation of the grouping rules to drift out of step.
 *
 * Idempotency comes from two constraints and one habit:
 *   - `resolution_issues.import_key` is unique
 *   - `(resolution_issue_id, run_id, observation_key)` is unique
 *   - occurrence statistics are *recomputed* from the observations table, never incremented,
 *     so a partial run followed by a rerun converges instead of double-counting.
 */

/** Runs that can carry unresolved evidence. FAIL and PASS never do — see resolveRunLevelReason. */
const CANDIDATE_RESULTS = [
  TEST_RUN_RESULT.BLOCKED,
  TEST_RUN_RESULT.PARTIAL,
  TEST_RUN_RESULT.ERROR,
];

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_SAMPLE_LIMIT = 5;

export interface ProjectionOptions {
  /** Restrict to these run ids. Omit to scan every historical candidate run. */
  runIds?: string[];
  batchSize?: number;
  /** Compute and report, write nothing. No transaction is opened at all. */
  dryRun?: boolean;
  sampleLimit?: number;
  /** Progress line writer; omit to stay silent (the API path does). */
  onProgress?: (message: string) => void;
}

export interface ProjectionReport {
  dryRun: boolean;
  /** Runs considered — those with a candidate result, within the requested scope. */
  candidateRuns: number;
  runsByResult: Record<string, number>;
  /** Checks whose canonical status is NOT_EVALUATED across the scanned runs. */
  unresolvedChecks: number;
  /** Distinct issue keys seen, split by how identity was established. */
  namedKeys: number;
  fallbackKeys: number;
  projectedNewIssues: number;
  projectedExistingIssues: number;
  projectedObservations: number;
  duplicateObservationsSkipped: number;
  recurrences: number;
  ambiguous: number;
  malformed: number;
  suppressedRunLevel: number;
  samples: {
    named: Array<{ importKey: string; displayKey: string; title: string }>;
    fallback: Array<{ importKey: string; displayKey: string; title: string }>;
    ambiguous: Array<{ runId: string; where: string; codes: string[] }>;
    malformed: Array<{ runId: string; where: string; note: string }>;
  };
}

function emptyReport(dryRun: boolean): ProjectionReport {
  return {
    dryRun,
    candidateRuns: 0,
    runsByResult: {},
    unresolvedChecks: 0,
    namedKeys: 0,
    fallbackKeys: 0,
    projectedNewIssues: 0,
    projectedExistingIssues: 0,
    projectedObservations: 0,
    duplicateObservationsSkipped: 0,
    recurrences: 0,
    ambiguous: 0,
    malformed: 0,
    suppressedRunLevel: 0,
    samples: { named: [], fallback: [], ambiguous: [], malformed: [] },
  };
}

/** One issue's worth of candidates inside a single batch. */
interface GroupedCandidates {
  importKey: string;
  /** The newest candidate wins for the sync-owned display fields. */
  newest: ResolutionCandidate;
  candidates: ResolutionCandidate[];
}

@Injectable()
export class ResolutionProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ResolutionWorkflowService,
  ) {}

  async projectRuns(
    options: ProjectionOptions = {},
  ): Promise<ProjectionReport> {
    const dryRun = options.dryRun === true;
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const sampleLimit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
    const report = emptyReport(dryRun);
    const diagnostics = emptyDiagnostics();
    // Issue keys already counted as "new" in an earlier batch of the same dry run. Without this
    // a dry run would report the same not-yet-created issue once per batch that touches it.
    const seenNewKeys = new Set<string>();

    const runIds = await this.listCandidateRunIds(options.runIds);
    report.candidateRuns = runIds.length;
    if (runIds.length === 0) return report;

    for (let i = 0; i < runIds.length; i += batchSize) {
      const batch = runIds.slice(i, i + batchSize);
      await this.projectBatch(batch, {
        dryRun,
        report,
        diagnostics,
        seenNewKeys,
      });
      options.onProgress?.(
        `resolution projection: ${Math.min(i + batchSize, runIds.length)}/${runIds.length} runs`,
      );
    }

    report.ambiguous = diagnostics.ambiguous.length;
    report.malformed = diagnostics.malformed.length;
    report.suppressedRunLevel = diagnostics.suppressedRunLevel.length;
    report.samples.ambiguous = diagnostics.ambiguous.slice(0, sampleLimit);
    report.samples.malformed = diagnostics.malformed.slice(0, sampleLimit);
    report.samples.named = report.samples.named.slice(0, sampleLimit);
    report.samples.fallback = report.samples.fallback.slice(0, sampleLimit);
    return report;
  }

  private async listCandidateRunIds(runIds?: string[]): Promise<string[]> {
    // An explicit empty list means "nothing was imported" — scanning everything would turn a
    // no-op sync into a full backfill.
    if (runIds && runIds.length === 0) return [];
    const rows = await this.prisma.testRun.findMany({
      where: {
        result: { in: CANDIDATE_RESULTS },
        ...(runIds ? { id: { in: runIds } } : {}),
      },
      select: { id: true },
      orderBy: { startedAt: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  private async projectBatch(
    runIds: string[],
    ctx: {
      dryRun: boolean;
      report: ProjectionReport;
      diagnostics: ExtractionDiagnostics;
      seenNewKeys: Set<string>;
    },
  ): Promise<void> {
    const runs = await this.prisma.testRun.findMany({
      where: { id: { in: runIds } },
      select: {
        id: true,
        testCaseId: true,
        scenarioKey: true,
        result: true,
        module: true,
        domain: true,
        startedAt: true,
        blockedReason: true,
        errorSummary: true,
        defectStatement: true,
        reportModel: true,
        // Only to recover a domain/module the run row does not carry — see resolveDomain.
        testCase: { select: { domain: true, module: true } },
        checks: {
          select: {
            sequence: true,
            testId: true,
            label: true,
            expected: true,
            actual: true,
            passed: true,
          },
          orderBy: { sequence: 'asc' },
        },
      },
    });

    const grouped = new Map<string, GroupedCandidates>();
    for (const run of runs) {
      ctx.report.runsByResult[run.result] =
        (ctx.report.runsByResult[run.result] ?? 0) + 1;

      const candidates = extractCandidates(run, run.checks, ctx.diagnostics);
      ctx.report.unresolvedChecks += candidates.filter(
        (c) => c.observation.checkSequence !== null,
      ).length;

      for (const candidate of candidates) {
        const existing = grouped.get(candidate.importKey);
        if (!existing) {
          grouped.set(candidate.importKey, {
            importKey: candidate.importKey,
            newest: candidate,
            candidates: [candidate],
          });
          continue;
        }
        existing.candidates.push(candidate);
        if (
          candidate.observation.observedAt >
          existing.newest.observation.observedAt
        ) {
          existing.newest = candidate;
        }
      }
    }

    if (grouped.size === 0) return;

    const importKeys = [...grouped.keys()];
    const existingIssues = await this.prisma.resolutionIssue.findMany({
      where: { importKey: { in: importKeys } },
      select: {
        id: true,
        importKey: true,
        workflowStatus: true,
        verifiedAt: true,
        lastSeenAt: true,
      },
    });
    const issueByKey = new Map(existingIssues.map((i) => [i.importKey, i]));

    // Which observations already exist, so both the dry-run count and the recurrence check know
    // what is genuinely new rather than re-counting a replay.
    const existingObservations =
      await this.prisma.resolutionObservation.findMany({
        where: {
          runId: { in: runIds },
          resolutionIssueId: { in: existingIssues.map((i) => i.id) },
        },
        select: { resolutionIssueId: true, runId: true, observationKey: true },
      });
    const existingObsKeys = new Set(
      existingObservations.map(
        (o) => `${o.resolutionIssueId}|${o.runId}|${o.observationKey}`,
      ),
    );

    for (const group of grouped.values()) {
      const isNamed = !group.newest.importKey.startsWith('auto:');
      const issue = issueByKey.get(group.importKey);

      if (issue) {
        ctx.report.projectedExistingIssues += 1;
      } else if (!ctx.seenNewKeys.has(group.importKey)) {
        ctx.seenNewKeys.add(group.importKey);
        ctx.report.projectedNewIssues += 1;
        if (isNamed) ctx.report.namedKeys += 1;
        else ctx.report.fallbackKeys += 1;
        const sample = {
          importKey: group.newest.importKey,
          displayKey: group.newest.displayKey,
          title: summarizeReason(group.newest.title, 160),
        };
        if (isNamed) ctx.report.samples.named.push(sample);
        else ctx.report.samples.fallback.push(sample);
      }

      for (const candidate of group.candidates) {
        const key = issue
          ? `${issue.id}|${candidate.observation.runId}|${candidate.observation.observationKey}`
          : null;
        if (key && existingObsKeys.has(key))
          ctx.report.duplicateObservationsSkipped += 1;
        else ctx.report.projectedObservations += 1;
      }
    }

    if (ctx.dryRun) return;

    const touchedIssueIds = new Set<number>();
    const recurrenceWork: Array<{
      issueId: number;
      runId: string;
      observedAt: Date;
      observationKey: string;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const group of grouped.values()) {
        const existing = issueByKey.get(group.importKey);
        const newest = group.newest;
        const observedAts = group.candidates.map(
          (c) => c.observation.observedAt,
        );
        const batchFirstSeen = new Date(
          Math.min(...observedAts.map((d) => d.getTime())),
        );
        const batchLastSeen = new Date(
          Math.max(...observedAts.map((d) => d.getTime())),
        );

        let issueId: number;
        if (!existing) {
          const created = await tx.resolutionIssue.create({
            data: {
              importKey: group.importKey,
              displayKey: newest.displayKey,
              // Imported issues are never pre-classified. A guess here would look authoritative
              // and is exactly what "do not treat every unresolved test as a defect" forbids.
              kind: RESOLUTION_KIND.UNCLASSIFIED,
              workflowStatus: RESOLUTION_WORKFLOW_STATUS.OPEN,
              title: newest.title.slice(0, 500),
              sourceSummary: newest.sourceSummary,
              module: newest.module,
              domain: newest.domain,
              firstSeenAt: batchFirstSeen,
              lastSeenAt: batchLastSeen,
            },
            select: { id: true },
          });
          issueId = created.id;
          await this.workflow.recordCreation(
            issueId,
            SYSTEM_ACTOR_SYNC,
            {
              import_key: group.importKey,
              blocker_code: newest.blockerCode ?? null,
              first_run_id: newest.observation.runId,
            },
            tx,
          );
        } else {
          issueId = existing.id;
          // Sync-owned fields only. kind, workflowStatus, owner, priority, userSummary,
          // decision*, resolution*, verification* and every comment/event are reporting-owned
          // and are deliberately absent from this object.
          const data: Record<string, unknown> = {};
          if (batchLastSeen > existing.lastSeenAt) {
            data.sourceSummary = newest.sourceSummary;
            data.displayKey = newest.displayKey;
          }
          if (Object.keys(data).length > 0) {
            await tx.resolutionIssue.update({ where: { id: issueId }, data });
          }
        }

        touchedIssueIds.add(issueId);

        const rows = group.candidates.map((c) => ({
          resolutionIssueId: issueId,
          runId: c.observation.runId,
          testCaseId: c.observation.testCaseId,
          scenarioKey: c.observation.scenarioKey,
          checkSequence: c.observation.checkSequence,
          checkTestId: c.observation.checkTestId,
          checkLabel: c.observation.checkLabel,
          observationKey: c.observation.observationKey,
          observedResult: c.observation.observedResult,
          rawReason: c.observation.rawReason,
          observedAt: c.observation.observedAt,
        }));
        await tx.resolutionObservation.createMany({
          data: rows,
          skipDuplicates: true,
        });

        // Queue a recurrence for an issue that was already verified and just saw new evidence.
        if (
          existing &&
          existing.workflowStatus === RESOLUTION_WORKFLOW_STATUS.VERIFIED
        ) {
          for (const c of group.candidates) {
            const obsKey = `${issueId}|${c.observation.runId}|${c.observation.observationKey}`;
            if (existingObsKeys.has(obsKey)) continue;
            if (
              existing.verifiedAt &&
              c.observation.observedAt <= existing.verifiedAt
            )
              continue;
            recurrenceWork.push({
              issueId,
              runId: c.observation.runId,
              observedAt: c.observation.observedAt,
              observationKey: c.observation.observationKey,
            });
            break;
          }
        }
      }

      await this.refreshStatistics([...touchedIssueIds], tx);

      for (const work of recurrenceWork) {
        const changed = await this.workflow.recordRecurrence(
          work.issueId,
          { actor: SYSTEM_ACTOR_SYNC, ...work },
          tx,
        );
        if (changed) ctx.report.recurrences += 1;
      }
    });
  }

  /**
   * Recomputes the denormalized occurrence statistics from the observations themselves.
   *
   * Recompute rather than increment: an interrupted backfill, a replayed sync and a first run all
   * have to land on the same numbers, and only a recomputation is indifferent to how many times
   * it has already happened.
   */
  async refreshStatistics(
    issueIds: number[],
    client?: ProjectionDbClient,
  ): Promise<void> {
    if (issueIds.length === 0) return;
    const db = client ?? this.prisma;

    const perIssue = await db.resolutionObservation.groupBy({
      by: ['resolutionIssueId'],
      where: { resolutionIssueId: { in: issueIds } },
      _count: { _all: true },
      _min: { observedAt: true },
      _max: { observedAt: true },
    });
    const perTestCase = await db.resolutionObservation.groupBy({
      by: ['resolutionIssueId', 'testCaseId'],
      where: { resolutionIssueId: { in: issueIds } },
    });

    const testCaseCounts = new Map<number, number>();
    for (const row of perTestCase) {
      testCaseCounts.set(
        row.resolutionIssueId,
        (testCaseCounts.get(row.resolutionIssueId) ?? 0) + 1,
      );
    }

    for (const row of perIssue) {
      await db.resolutionIssue.update({
        where: { id: row.resolutionIssueId },
        data: {
          observationCount: row._count._all,
          affectedTestCaseCount: testCaseCounts.get(row.resolutionIssueId) ?? 0,
          ...(row._min.observedAt ? { firstSeenAt: row._min.observedAt } : {}),
          ...(row._max.observedAt ? { lastSeenAt: row._max.observedAt } : {}),
        },
      });
    }
  }
}

/** Renders a projection report as the aligned block the sync and backfill scripts print. */
export function formatProjectionReport(report: ProjectionReport): string {
  const lines: string[] = [];
  const pad = (label: string) => label.padEnd(28, ' ');
  lines.push(`${pad('candidate runs:')}${report.candidateRuns}`);
  const byResult = Object.entries(report.runsByResult)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  lines.push(`${pad('  by result:')}${byResult || '-'}`);
  lines.push(`${pad('unresolved checks:')}${report.unresolvedChecks}`);
  lines.push(`${pad('named blocker keys:')}${report.namedKeys}`);
  lines.push(`${pad('fallback keys:')}${report.fallbackKeys}`);
  lines.push(`${pad('issues, new:')}${report.projectedNewIssues}`);
  lines.push(
    `${pad('issues, already present:')}${report.projectedExistingIssues}`,
  );
  lines.push(`${pad('observations, new:')}${report.projectedObservations}`);
  lines.push(
    `${pad('observations, duplicate:')}${report.duplicateObservationsSkipped}`,
  );
  lines.push(`${pad('recurrences:')}${report.recurrences}`);
  lines.push(`${pad('ambiguous (multi-code):')}${report.ambiguous}`);
  lines.push(`${pad('malformed:')}${report.malformed}`);
  lines.push(`${pad('run-level suppressed:')}${report.suppressedRunLevel}`);

  if (report.samples.named.length > 0) {
    lines.push('', 'Sample named issues:');
    for (const s of report.samples.named)
      lines.push(`  ${s.displayKey}  ${s.title}`);
  }
  if (report.samples.fallback.length > 0) {
    lines.push('', 'Sample fallback issues:');
    for (const s of report.samples.fallback)
      lines.push(`  ${s.displayKey}  ${s.title}`);
  }
  if (report.samples.ambiguous.length > 0) {
    lines.push(
      '',
      'Sample ambiguous records (first code used, rest need manual triage):',
    );
    for (const s of report.samples.ambiguous) {
      lines.push(`  ${s.runId} ${s.where}: ${s.codes.join(', ')}`);
    }
  }
  if (report.samples.malformed.length > 0) {
    lines.push('', 'Sample malformed records:');
    for (const s of report.samples.malformed)
      lines.push(`  ${s.runId} ${s.where}: ${s.note}`);
  }
  return lines.join('\n');
}
