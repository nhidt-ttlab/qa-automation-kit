import { DashboardService } from './dashboard.service';
import type { PrismaService } from '../../prisma.service';
import type { ResolutionService } from '../resolution/resolution.service';

type LatestRun = { testCaseId: string; result: string; domain: string | null };
type DomainGroup = {
  domain: string | null;
  result: string;
  _count: { _all: number };
};

function makePrismaMock({
  totalRuns = 0,
  resultGroups = [] as Array<{ result: string; _count: { _all: number } }>,
  domainGroups = [] as DomainGroup[],
  latestRuns = [] as LatestRun[],
}) {
  // The service issues two testRun.findMany calls in one Promise.all — recent failures, then the
  // latest-run-per-test-case set. They are told apart by the `distinct` option rather than by
  // call order, so reordering the Promise.all cannot silently swap the fixtures.
  const testRunFindMany = jest.fn((args: Record<string, unknown>) =>
    Promise.resolve(args?.distinct ? latestRuns : []),
  );

  return {
    prisma: {
      testRun: {
        count: jest.fn().mockResolvedValue(totalRuns),
        groupBy: jest.fn((args: { by: string[] }) =>
          Promise.resolve(
            args.by.includes('domain') ? domainGroups : resultGroups,
          ),
        ),
        findMany: testRunFindMany,
      },
      artifact: { findMany: jest.fn().mockResolvedValue([]) },
      defectSignature: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService,
    testRunFindMany,
  };
}

function makeResolutionMock() {
  return {
    getSummary: jest.fn().mockResolvedValue({
      by_status: {
        OPEN: 0,
        WAITING_FOR_DECISION: 0,
        READY_FOR_RERUN: 0,
        RECURRED: 0,
        VERIFIED: 0,
      },
      by_kind: { UNCLASSIFIED: 0 },
      by_domain: [],
      by_owner: [],
      oldest_unresolved: [],
    }),
  } as unknown as ResolutionService;
}

describe('DashboardService.getSummary', () => {
  it('derives pass_rate from the latest run of each test case, not from every execution', async () => {
    // 1000 test cases, half of them currently passing — but 4000 executions in history, most of
    // them passing, because the failing scenarios were re-run while being chased. The historical
    // ratio would read 87.5%; the number that describes the suite today is 50%.
    const latestRuns: LatestRun[] = [
      ...Array.from({ length: 500 }, (_, i) => ({
        testCaseId: `pass-${i}`,
        result: 'PASS',
        domain: 'don-hang',
      })),
      ...Array.from({ length: 500 }, (_, i) => ({
        testCaseId: `fail-${i}`,
        result: 'FAIL',
        domain: 'don-hang',
      })),
    ];
    const { prisma } = makePrismaMock({
      totalRuns: 4000,
      resultGroups: [
        { result: 'PASS', _count: { _all: 3500 } },
        { result: 'FAIL', _count: { _all: 500 } },
      ],
      latestRuns,
    });

    const summary = await new DashboardService(
      prisma,
      makeResolutionMock(),
    ).getSummary({});

    expect(summary.pass_rate).toBe(50);
    expect(summary.latest).toEqual({
      total: 1000,
      passed: 500,
      failed: 500,
      blocked: 0,
      error: 0,
    });
    // The all-executions counts stay available and untouched.
    expect(summary.total_runs).toBe(4000);
    expect(summary.passed_runs).toBe(3500);
  });

  it('counts BLOCKED and ERROR latest runs separately, and against the pass rate', async () => {
    const { prisma } = makePrismaMock({
      totalRuns: 4,
      latestRuns: [
        { testCaseId: 'tc-1', result: 'PASS', domain: 'kho' },
        { testCaseId: 'tc-2', result: 'FAIL', domain: 'kho' },
        { testCaseId: 'tc-3', result: 'BLOCKED', domain: 'kho' },
        { testCaseId: 'tc-4', result: 'ERROR', domain: 'kho' },
      ],
    });

    const summary = await new DashboardService(
      prisma,
      makeResolutionMock(),
    ).getSummary({});

    expect(summary.latest).toEqual({
      total: 4,
      passed: 1,
      failed: 1,
      blocked: 1,
      error: 1,
    });
    expect(summary.pass_rate).toBe(25);
  });

  it('reports 0 rather than dividing by zero when no test case has run', async () => {
    const { prisma } = makePrismaMock({ totalRuns: 0 });

    const summary = await new DashboardService(
      prisma,
      makeResolutionMock(),
    ).getSummary({});

    expect(summary.pass_rate).toBe(0);
    expect(summary.latest.total).toBe(0);
  });

  it('asks for one latest run per test case, newest first', async () => {
    const { prisma, testRunFindMany } = makePrismaMock({});

    await new DashboardService(prisma, makeResolutionMock()).getSummary({});

    expect(testRunFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ['testCaseId'],
        orderBy: [{ testCaseId: 'asc' }, { startedAt: 'desc' }],
      }),
    );
  });

  it('scopes the latest-run set to the same filter as the rest of the summary', async () => {
    const { prisma, testRunFindMany } = makePrismaMock({});

    await new DashboardService(prisma, makeResolutionMock()).getSummary({
      environment: 'staging',
      domain: 'kho',
    });

    expect(testRunFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ['testCaseId'],
        where: { environment: 'staging', domain: 'kho' },
      }),
    );
  });

  it('gives each domain a pass rate on the same latest-run basis as the headline', async () => {
    const { prisma } = makePrismaMock({
      totalRuns: 30,
      domainGroups: [
        { domain: 'don-hang', result: 'PASS', _count: { _all: 18 } },
        { domain: 'don-hang', result: 'FAIL', _count: { _all: 2 } },
        { domain: 'kho', result: 'PASS', _count: { _all: 5 } },
        { domain: 'kho', result: 'FAIL', _count: { _all: 5 } },
      ],
      latestRuns: [
        // don-hang: 20 executions collapse to 2 test cases, one of which is failing now.
        { testCaseId: 'tc-1', result: 'PASS', domain: 'don-hang' },
        { testCaseId: 'tc-2', result: 'FAIL', domain: 'don-hang' },
        { testCaseId: 'tc-3', result: 'PASS', domain: 'kho' },
      ],
    });

    const summary = await new DashboardService(
      prisma,
      makeResolutionMock(),
    ).getSummary({});

    const donHang = summary.by_domain.find((d) => d.domain === 'don-hang')!;
    expect(donHang).toMatchObject({
      total_runs: 20,
      passed_runs: 18,
      latest_total: 2,
      latest_passed: 1,
      pass_rate: 50,
    });
    const kho = summary.by_domain.find((d) => d.domain === 'kho')!;
    expect(kho).toMatchObject({
      latest_total: 1,
      latest_passed: 1,
      pass_rate: 100,
    });
  });

  it('buckets a NULL domain under _unknown on both the historical and latest counts', async () => {
    const { prisma } = makePrismaMock({
      totalRuns: 3,
      domainGroups: [{ domain: null, result: 'PASS', _count: { _all: 3 } }],
      latestRuns: [{ testCaseId: 'tc-1', result: 'PASS', domain: null }],
    });

    const summary = await new DashboardService(
      prisma,
      makeResolutionMock(),
    ).getSummary({});

    expect(summary.by_domain).toHaveLength(1);
    expect(summary.by_domain[0]).toMatchObject({
      domain: '_unknown',
      total_runs: 3,
      latest_total: 1,
      pass_rate: 100,
    });
  });

  it('keeps a domain that has history but no run in the latest set, at a 0% rate', async () => {
    // Not an accident of the merge order: a feature whose every test case dropped out of the
    // latest set must still be visible, and must not be silently credited with its old rate.
    const { prisma } = makePrismaMock({
      totalRuns: 4,
      domainGroups: [
        { domain: 'retired', result: 'PASS', _count: { _all: 4 } },
      ],
      latestRuns: [{ testCaseId: 'tc-1', result: 'PASS', domain: 'kho' }],
    });

    const summary = await new DashboardService(
      prisma,
      makeResolutionMock(),
    ).getSummary({});

    const retired = summary.by_domain.find((d) => d.domain === 'retired')!;
    expect(retired).toMatchObject({
      total_runs: 4,
      passed_runs: 4,
      latest_total: 0,
      latest_passed: 0,
      pass_rate: 0,
    });
    // Sorted by the latest-run count first, so the live feature leads.
    expect(summary.by_domain[0].domain).toBe('kho');
  });

  it('rounds the pass rate to two decimals', async () => {
    const { prisma } = makePrismaMock({
      totalRuns: 3,
      latestRuns: [
        { testCaseId: 'tc-1', result: 'PASS', domain: 'kho' },
        { testCaseId: 'tc-2', result: 'FAIL', domain: 'kho' },
        { testCaseId: 'tc-3', result: 'FAIL', domain: 'kho' },
      ],
    });

    const summary = await new DashboardService(
      prisma,
      makeResolutionMock(),
    ).getSummary({});

    expect(summary.pass_rate).toBe(33.33);
  });
});
