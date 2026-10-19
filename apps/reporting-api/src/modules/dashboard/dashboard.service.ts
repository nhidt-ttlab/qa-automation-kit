import { Injectable } from '@nestjs/common';
import type {
  DashboardQueryDto,
  DashboardSummaryResponseDto,
  DefectSeverity,
  TestRunResult,
} from '@qakit/reporting-shared';
import { TEST_RUN_RESULT } from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import { ResolutionService } from '../resolution/resolution.service';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private readonly resolution: ResolutionService,
  ) {}

  async getSummary(
    query: Partial<DashboardQueryDto>,
  ): Promise<DashboardSummaryResponseDto> {
    const where: Record<string, unknown> = {};
    if (query.environment) where.environment = query.environment;
    if (query.module) where.module = query.module;
    if (query.domain) where.domain = query.domain;

    const startDate = query.from_date ? new Date(query.from_date) : undefined;
    const endDate = query.to_date ? new Date(query.to_date) : undefined;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    const [
      totalRuns,
      resultGroups,
      reviewedRuns,
      openBugs,
      topDefects,
      recentFailures,
      domainGroups,
      latestRuns,
    ] = await Promise.all([
      this.prisma.testRun.count({ where }),
      this.prisma.testRun.groupBy({
        by: ['result'],
        where,
        _count: { _all: true },
      }),
      this.prisma.artifact.findMany({
        where: { kind: 'review_record', testRun: where },
        select: { runId: true },
        distinct: ['runId'],
      }),
      this.prisma.defectSignature.count({
        where: { status: { notIn: ['resolved', 'wontfix'] } },
      }),
      this.prisma.defectSignature.findMany({
        orderBy: { observations: { _count: 'desc' } },
        take: 5,
        include: { _count: { select: { observations: true } } },
      }),
      this.prisma.testRun.findMany({
        where: { ...where, result: { not: TEST_RUN_RESULT.PASS } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      // Two rows per domain at most (total + passed), rather than a query per domain.
      this.prisma.testRun.groupBy({
        by: ['domain', 'result'],
        where,
        _count: { _all: true },
      }),
      // The current state of the suite: each test case's most recent run under this filter, and
      // nothing else. Same distinct-scoped shape TestCasesService.batchLoadLatestRuns uses, so
      // the pass rate here and the `latest_run_result` shown on the test case list agree by
      // construction. `result` and `domain` only — the rows are counted, never rendered.
      this.prisma.testRun.findMany({
        where,
        orderBy: [{ testCaseId: 'asc' }, { startedAt: 'desc' }],
        distinct: ['testCaseId'],
        select: { testCaseId: true, result: true, domain: true },
      }),
    ]);

    const countFor = (result: TestRunResult) =>
      resultGroups.find(
        (g: (typeof resultGroups)[number]) => g.result === result,
      )?._count._all ?? 0;

    type DomainEntry = {
      total: number;
      passed: number;
      latestTotal: number;
      latestPassed: number;
    };
    const emptyDomainEntry = (): DomainEntry => ({
      total: 0,
      passed: 0,
      latestTotal: 0,
      latestPassed: 0,
    });
    // A run whose producer was not a registered scenario has domain NULL in the DB; it shares the
    // `_unknown` bucket the runner already writes for new rows, so the two never split.
    const domainKey = (domain: string | null) => domain ?? '_unknown';

    const byDomain = new Map<string, DomainEntry>();
    for (const group of domainGroups) {
      const key = domainKey(group.domain);
      const entry = byDomain.get(key) ?? emptyDomainEntry();
      entry.total += group._count._all;
      if (group.result === TEST_RUN_RESULT.PASS)
        entry.passed += group._count._all;
      byDomain.set(key, entry);
    }

    const latestCounts = {
      total: latestRuns.length,
      passed: 0,
      failed: 0,
      blocked: 0,
      error: 0,
    };
    for (const run of latestRuns) {
      if (run.result === TEST_RUN_RESULT.PASS) latestCounts.passed += 1;
      else if (run.result === TEST_RUN_RESULT.FAIL) latestCounts.failed += 1;
      else if (run.result === TEST_RUN_RESULT.BLOCKED)
        latestCounts.blocked += 1;
      else if (run.result === TEST_RUN_RESULT.ERROR) latestCounts.error += 1;

      // A domain present only in history — every one of its test cases filtered out of the
      // latest set — would otherwise be missing from the map entirely, so seed on demand.
      const key = domainKey(run.domain);
      const entry = byDomain.get(key) ?? emptyDomainEntry();
      entry.latestTotal += 1;
      if (run.result === TEST_RUN_RESULT.PASS) entry.latestPassed += 1;
      byDomain.set(key, entry);
    }

    const asPercent = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;

    // Resolution Queue health, kept in its own block and deliberately NOT folded into
    // open_bugs: an unresolved blocker means "the source does not say what to expect", and
    // counting it as a confirmed product defect is the conflation this feature exists to undo.
    //
    // Unfiltered on purpose. The run filters above (environment, module, domain, date) select
    // *executions*; an issue spans many, so applying a run filter to it would produce a number
    // that answers no question anyone asked. Same reasoning as open_bugs.
    const queue = await this.resolution.getSummary();

    const passedRuns = countFor(TEST_RUN_RESULT.PASS);
    const failedRuns = countFor(TEST_RUN_RESULT.FAIL);
    const blockedRuns = countFor(TEST_RUN_RESULT.BLOCKED);
    const errorRuns = countFor(TEST_RUN_RESULT.ERROR);

    return {
      metric_date: new Date().toISOString(),
      total_runs: totalRuns,
      passed_runs: passedRuns,
      failed_runs: failedRuns,
      blocked_runs: blockedRuns,
      error_runs: errorRuns,
      latest: latestCounts,
      // Latest run per test case, not every execution: re-running one failing scenario ten more
      // times must not move the suite's pass rate.
      pass_rate: asPercent(latestCounts.passed, latestCounts.total),
      reviewed_count: reviewedRuns.length,
      open_bugs: openBugs,
      top_defects: topDefects
        .filter((d: (typeof topDefects)[number]) => d._count.observations > 0)
        .map((d: (typeof topDefects)[number]) => ({
          id: String(d.id),
          title: d.title,
          observation_count: d._count.observations,
          severity: (d.severity as DefectSeverity) ?? 'Low',
        })),
      by_domain: [...byDomain.entries()]
        .map(([domain, { total, passed, latestTotal, latestPassed }]) => ({
          domain,
          total_runs: total,
          passed_runs: passed,
          latest_total: latestTotal,
          latest_passed: latestPassed,
          pass_rate: asPercent(latestPassed, latestTotal),
        }))
        .sort(
          (a, b) =>
            b.latest_total - a.latest_total ||
            b.total_runs - a.total_runs ||
            a.domain.localeCompare(b.domain),
        ),
      resolution: {
        open_blockers: queue.by_status.OPEN,
        waiting_for_decision: queue.by_status.WAITING_FOR_DECISION,
        ready_for_rerun: queue.by_status.READY_FOR_RERUN,
        recurring: queue.by_status.RECURRED,
        unclassified: queue.by_kind.UNCLASSIFIED,
        verified: queue.by_status.VERIFIED,
        by_kind: Object.entries(queue.by_kind)
          .map(([kind, total]) => ({ kind, total }))
          .filter((k) => k.total > 0)
          .sort((a, b) => b.total - a.total),
        by_domain: queue.by_domain,
        by_owner: queue.by_owner,
        oldest_unresolved: queue.oldest_unresolved.slice(0, 5),
      },
      recent_failures: recentFailures.map(
        (r: (typeof recentFailures)[number]) => ({
          id: r.id,
          test_case_id: r.testCaseId,
          scenario_key: r.scenarioKey,
          result: r.result as TestRunResult,
          created_at: r.createdAt.toISOString(),
        }),
      ),
    };
  }
}
