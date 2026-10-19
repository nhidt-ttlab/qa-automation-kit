import { NotFoundError } from '@qakit/reporting-shared';
import { TestCasesService } from './testcases.service';
import type { PrismaService } from '../../prisma.service';
import type { RunsService } from '../runs/runs.service';

function makeTestCase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tc-1',
    scenarioKey: 'scenario-1',
    title: 'Test Case 1',
    objective: null,
    impactedArea: null,
    owner: null,
    status: 'active',
    tags: [],
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    _count: { testRuns: 0 },
    ...overrides,
  };
}

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    testCaseId: 'tc-1',
    result: 'PASS',
    environment: 'staging',
    startedAt: new Date('2026-01-03T00:00:00Z'),
    ...overrides,
  };
}

function makePrismaMock(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    testCase: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    testRun: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  } as unknown as PrismaService;
}

function makeRunsServiceMock() {
  return {
    listRuns: jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      has_more: false,
    }),
  } as unknown as RunsService;
}

describe('TestCasesService', () => {
  describe('listTestCases', () => {
    it('merges latest-run fields for a testcase with runs, and defaults for one with none', async () => {
      const withRuns = makeTestCase({ id: 'tc-1', _count: { testRuns: 3 } });
      const withoutRuns = makeTestCase({ id: 'tc-2', _count: { testRuns: 0 } });
      const latestRun = makeRun({
        id: 'run-9',
        testCaseId: 'tc-1',
        result: 'FAIL',
        environment: 'prod',
      });

      const prisma = makePrismaMock({
        testCase: {
          findMany: jest.fn().mockResolvedValue([withRuns, withoutRuns]),
          count: jest.fn().mockResolvedValue(2),
          findUnique: jest.fn(),
        },
        testRun: {
          findMany: jest.fn().mockResolvedValue([latestRun]),
          findFirst: jest.fn(),
        },
      });
      const runsService = makeRunsServiceMock();
      const service = new TestCasesService(prisma, runsService);

      const result = await service.listTestCases({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(2);
      const tc1 = result.items.find((i) => i.id === 'tc-1')!;
      const tc2 = result.items.find((i) => i.id === 'tc-2')!;
      expect(tc1.latest_run_id).toBe('run-9');
      expect(tc1.latest_run_result).toBe('FAIL');
      expect(tc1.total_run_count).toBe(3);
      expect(tc2.latest_run_id).toBeUndefined();
      expect(tc2.total_run_count).toBe(0);
    });

    it('fetches latest runs with a single batched, distinct-scoped query (no N+1)', async () => {
      const items = [
        makeTestCase({ id: 'tc-1' }),
        makeTestCase({ id: 'tc-2' }),
      ];
      const testRunFindMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrismaMock({
        testCase: {
          findMany: jest.fn().mockResolvedValue(items),
          count: jest.fn().mockResolvedValue(2),
          findUnique: jest.fn(),
        },
        testRun: { findMany: testRunFindMany, findFirst: jest.fn() },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({ page: 1, limit: 20 });

      expect(testRunFindMany).toHaveBeenCalledTimes(1);
      expect(testRunFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { testCaseId: { in: ['tc-1', 'tc-2'] } },
          distinct: ['testCaseId'],
        }),
      );
    });

    it('does not add an OR clause when q is absent', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = makePrismaMock({
        testCase: { findMany, count, findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({ page: 1, limit: 20 });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ OR: expect.anything() }),
        }),
      );
      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ OR: expect.anything() }),
        }),
      );
    });

    it('does not add an OR clause when q is blank/whitespace-only', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrismaMock({
        testCase: {
          findMany,
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn(),
        },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({ page: 1, limit: 20, q: '   ' });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ OR: expect.anything() }),
        }),
      );
    });

    it('adds an OR clause across id/title/scenario_key when q is provided, trimmed', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = makePrismaMock({
        testCase: { findMany, count, findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({ page: 1, limit: 20, q: '  login  ' });

      const expectedWhere = expect.objectContaining({
        OR: [
          { id: { contains: 'login', mode: 'insensitive' } },
          { title: { contains: 'login', mode: 'insensitive' } },
          { scenarioKey: { contains: 'login', mode: 'insensitive' } },
        ],
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it('filters by module and domain as real columns, keeping the fast DB-paginated path', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = makePrismaMock({
        testCase: { findMany, count, findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({
        page: 1,
        limit: 20,
        module: 'warehouse',
        domain: 'kho-bao-cao-kho',
      });

      const expectedWhere = expect.objectContaining({
        module: 'warehouse',
        domain: 'kho-bao-cao-kho',
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
      );
      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it('filters by feature_id as a case-insensitive substring, so a prefix matches a whole group', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = makePrismaMock({
        testCase: { findMany, count, findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({ page: 1, limit: 20, feature_id: 'HW-KHO' });

      const expectedWhere = expect.objectContaining({
        featureId: { contains: 'HW-KHO', mode: 'insensitive' },
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
      );
      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it("filters by csv_checklist_id through the runs' checks, staying on the fast DB-paginated path", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = makePrismaMock({
        testCase: { findMany, count, findUnique: jest.fn() },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({
        page: 1,
        limit: 20,
        csv_checklist_id: ' QLDN-VT-04 ',
      });

      // Substring like feature_id: a typed prefix selects the whole sheet family.
      const expectedWhere = expect.objectContaining({
        testRuns: {
          some: {
            checks: {
              some: {
                csvChecklistId: { contains: 'QLDN-VT-04', mode: 'insensitive' },
              },
            },
          },
        },
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
      );
      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it('matches csv_testcase_id as a case-insensitive substring, on the same check as the checklist', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrismaMock({
        testCase: {
          findMany,
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({
        page: 1,
        limit: 20,
        csv_checklist_id: 'QLDN-VT-04',
        csv_testcase_id: ' tc_16 ',
      });

      // Plain LIKE-style substring, trimmed: reaches a joined "TC_16 | TC_17" cell too.
      expect(findMany.mock.calls[0][0].where.testRuns).toEqual({
        some: {
          checks: {
            some: {
              csvChecklistId: { contains: 'QLDN-VT-04', mode: 'insensitive' },
              csvTestcaseId: { contains: 'tc_16', mode: 'insensitive' },
            },
          },
        },
      });
    });

    it('leaves the runs relation out of the where clause when neither checklist filter is given', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrismaMock({
        testCase: {
          findMany,
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({
        page: 1,
        limit: 20,
        csv_testcase_id: '   ',
      });

      expect(findMany.mock.calls[0][0].where).not.toHaveProperty('testRuns');
    });

    it('leaves feature_id out of the where clause when it is not given', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = makePrismaMock({
        testCase: { findMany, count, findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({ page: 1, limit: 20 });

      expect(findMany.mock.calls[0][0].where).not.toHaveProperty('featureId');
    });

    it('maps module and domain onto the response, and leaves them undefined for an unclassified case', async () => {
      const findMany = jest.fn().mockResolvedValue([
        makeTestCase({ module: 'purchase-order', domain: 'don-hang' }),
        makeTestCase({
          id: 'tc-2',
          scenarioKey: 'scenario-2',
          module: null,
          domain: null,
        }),
      ]);
      const prisma = makePrismaMock({
        testCase: {
          findMany,
          count: jest.fn().mockResolvedValue(2),
          findUnique: jest.fn(),
        },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      const result = await service.listTestCases({ page: 1, limit: 20 });

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          module: 'purchase-order',
          domain: 'don-hang',
        }),
      );
      expect(result.items[1].module).toBeUndefined();
      expect(result.items[1].domain).toBeUndefined();
    });

    it('without latest_run_result: uses the fast path (count() called, findMany called with skip/take)', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = makePrismaMock({
        testCase: { findMany, count, findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({ page: 2, limit: 10 });

      expect(count).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('with latest_run_result: uses the slow path (count() not called, findMany called without skip/take)', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = makePrismaMock({
        testCase: { findMany, count, findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({
        page: 1,
        limit: 20,
        latest_run_result: 'FAIL',
      });

      expect(count).not.toHaveBeenCalled();
      const call = findMany.mock.calls[0][0];
      expect(call.skip).toBeUndefined();
      expect(call.take).toBeUndefined();
    });

    it('latest_run_result=FAIL returns only test cases whose latest run is FAIL', async () => {
      const items = [
        makeTestCase({ id: 'tc-1' }),
        makeTestCase({ id: 'tc-2' }),
        makeTestCase({ id: 'tc-3' }),
      ];
      const latestRuns = [
        makeRun({ id: 'run-1', testCaseId: 'tc-1', result: 'FAIL' }),
        makeRun({ id: 'run-2', testCaseId: 'tc-2', result: 'PASS' }),
        makeRun({ id: 'run-3', testCaseId: 'tc-3', result: 'ERROR' }),
      ];
      const prisma = makePrismaMock({
        testCase: {
          findMany: jest.fn().mockResolvedValue(items),
          count: jest.fn(),
          findUnique: jest.fn(),
        },
        testRun: {
          findMany: jest.fn().mockResolvedValue(latestRuns),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      const result = await service.listTestCases({
        page: 1,
        limit: 20,
        latest_run_result: 'FAIL',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('tc-1');
      expect(result.total).toBe(1);
    });

    it('combines q + latest_run_result to the intersection', async () => {
      const items = [
        makeTestCase({ id: 'tc-1', title: 'Login flow' }),
        makeTestCase({ id: 'tc-2', title: 'Login flow' }),
      ];
      const latestRuns = [
        makeRun({ id: 'run-1', testCaseId: 'tc-1', result: 'FAIL' }),
        makeRun({ id: 'run-2', testCaseId: 'tc-2', result: 'PASS' }),
      ];
      const findMany = jest.fn().mockResolvedValue(items);
      const prisma = makePrismaMock({
        testCase: { findMany, count: jest.fn(), findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue(latestRuns),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      const result = await service.listTestCases({
        page: 1,
        limit: 20,
        q: 'login',
        latest_run_result: 'FAIL',
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.anything() }),
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('tc-1');
    });

    it('combines status/owner/scenario_key with latest_run_result', async () => {
      const items = [makeTestCase({ id: 'tc-1', status: 'active' })];
      const latestRuns = [
        makeRun({ id: 'run-1', testCaseId: 'tc-1', result: 'BLOCKED' }),
      ];
      const findMany = jest.fn().mockResolvedValue(items);
      const prisma = makePrismaMock({
        testCase: { findMany, count: jest.fn(), findUnique: jest.fn() },
        testRun: {
          findMany: jest.fn().mockResolvedValue(latestRuns),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      const result = await service.listTestCases({
        page: 1,
        limit: 20,
        status: 'active',
        owner: 'qa-team',
        scenario_key: 'scenario-1',
        latest_run_result: 'BLOCKED',
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
            owner: 'qa-team',
            scenarioKey: 'scenario-1',
          }),
        }),
      );
      expect(result.items).toHaveLength(1);
    });

    it('paginates correctly against the filtered set when latest_run_result is set', async () => {
      const items = [
        makeTestCase({ id: 'tc-1' }),
        makeTestCase({ id: 'tc-2' }),
        makeTestCase({ id: 'tc-3' }),
        makeTestCase({ id: 'tc-4' }),
        makeTestCase({ id: 'tc-5' }),
      ];
      const latestRuns = [
        makeRun({ id: 'run-1', testCaseId: 'tc-1', result: 'FAIL' }),
        makeRun({ id: 'run-2', testCaseId: 'tc-2', result: 'PASS' }),
        makeRun({ id: 'run-3', testCaseId: 'tc-3', result: 'FAIL' }),
        makeRun({ id: 'run-4', testCaseId: 'tc-4', result: 'PASS' }),
        makeRun({ id: 'run-5', testCaseId: 'tc-5', result: 'FAIL' }),
      ];
      const prisma = makePrismaMock({
        testCase: {
          findMany: jest.fn().mockResolvedValue(items),
          count: jest.fn(),
          findUnique: jest.fn(),
        },
        testRun: {
          findMany: jest.fn().mockResolvedValue(latestRuns),
          findFirst: jest.fn(),
        },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      const result = await service.listTestCases({
        page: 2,
        limit: 2,
        latest_run_result: 'FAIL',
      });

      expect(result.total).toBe(3);
      expect(result.has_more).toBe(false);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('tc-5');
    });

    it('the latest-run lookup is still batched exactly once when latest_run_result is set', async () => {
      const items = [
        makeTestCase({ id: 'tc-1' }),
        makeTestCase({ id: 'tc-2' }),
      ];
      const testRunFindMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrismaMock({
        testCase: {
          findMany: jest.fn().mockResolvedValue(items),
          count: jest.fn(),
          findUnique: jest.fn(),
        },
        testRun: { findMany: testRunFindMany, findFirst: jest.fn() },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listTestCases({
        page: 1,
        limit: 20,
        latest_run_result: 'FAIL',
      });

      expect(testRunFindMany).toHaveBeenCalledTimes(1);
      expect(testRunFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { testCaseId: { in: ['tc-1', 'tc-2'] } },
          distinct: ['testCaseId'],
        }),
      );
    });

    it('returns an empty page when no test case matches latest_run_result, without querying runs for an empty id set', async () => {
      const testRunFindMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrismaMock({
        testCase: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn(),
          findUnique: jest.fn(),
        },
        testRun: { findMany: testRunFindMany, findFirst: jest.fn() },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      const result = await service.listTestCases({
        page: 1,
        limit: 20,
        latest_run_result: 'FAIL',
      });

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        has_more: false,
      });
      expect(testRunFindMany).not.toHaveBeenCalled();
    });
  });

  describe('listDomains', () => {
    it('reads distinct non-null domains and keeps `_unknown` last', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          { domain: '_unknown' },
          { domain: 'don-hang' },
          { domain: 'kho' },
        ]);
      const prisma = makePrismaMock({
        testCase: { findMany, count: jest.fn(), findUnique: jest.fn() },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      const result = await service.listDomains({});

      expect(findMany).toHaveBeenCalledWith({
        where: { domain: { not: null } },
        select: { domain: true },
        distinct: ['domain'],
        orderBy: { domain: 'asc' },
      });
      expect(result).toEqual({ domains: ['don-hang', 'kho', '_unknown'] });
    });

    it('scopes to the requested run_type', async () => {
      const findMany = jest.fn().mockResolvedValue([{ domain: 'kho' }]);
      const prisma = makePrismaMock({
        testCase: { findMany, count: jest.fn(), findUnique: jest.fn() },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await service.listDomains({ run_type: 'ui' });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { domain: { not: null }, runType: 'ui' },
        }),
      );
    });

    it('drops empty domains a legacy row may carry', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([{ domain: '' }, { domain: 'kho' }]);
      const prisma = makePrismaMock({
        testCase: { findMany, count: jest.fn(), findUnique: jest.fn() },
      });
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      expect(await service.listDomains({})).toEqual({ domains: ['kho'] });
    });
  });

  describe('getTestCase', () => {
    it('throws NotFoundError when the testcase does not exist', async () => {
      const prisma = makePrismaMock();
      const service = new TestCasesService(prisma, makeRunsServiceMock());

      await expect(service.getTestCase('missing')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('getTestCaseRuns', () => {
    it('throws NotFoundError and does not call listRuns when the testcase does not exist', async () => {
      const prisma = makePrismaMock();
      const runsService = makeRunsServiceMock();
      const service = new TestCasesService(prisma, runsService);

      await expect(
        service.getTestCaseRuns('missing', { page: 1, limit: 20 }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(runsService.listRuns).not.toHaveBeenCalled();
    });

    it('calls runsService.listRuns scoped to the testcase id when it exists', async () => {
      const prisma = makePrismaMock({
        testCase: {
          findMany: jest.fn(),
          count: jest.fn(),
          findUnique: jest.fn().mockResolvedValue({ id: 'tc-1' }),
        },
        testRun: { findMany: jest.fn(), findFirst: jest.fn() },
      });
      const runsService = makeRunsServiceMock();
      const service = new TestCasesService(prisma, runsService);

      await service.getTestCaseRuns('tc-1', { page: 1, limit: 20 });

      expect(runsService.listRuns).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        test_case_id: 'tc-1',
      });
    });
  });
});
