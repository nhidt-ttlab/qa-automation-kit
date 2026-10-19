import { Injectable } from '@nestjs/common';
import type {
  PaginatedResponse,
  ListTestCasesQueryDto,
  ListTestCaseDomainsQueryDto,
  TestCaseDomainListResponseDto,
  TestCaseListItemResponseDto,
  TestCaseDetailResponseDto,
  ListTestRunsQueryDto,
  TestRunListItemResponseDto,
  TestCaseStatus,
  TestRunResult,
  RunType,
  SuiteModule,
  FeatureDomain,
} from '@qakit/reporting-shared';
import { FEATURE_DOMAIN, NotFoundError } from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import { RunsService } from '../runs/runs.service';
import { countScreenshots } from '../runs/ui-evidence.util';
import type { TestCase, TestRun } from '../../generated/prisma/client';

type TestCaseWithCount = TestCase & { _count: { testRuns: number } };

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toTestCaseListItem(
  tc: TestCaseWithCount,
  latestRun?: TestRun,
): TestCaseListItemResponseDto {
  return {
    id: tc.id,
    scenario_key: tc.scenarioKey,
    title: tc.title,
    objective: tc.objective ?? undefined,
    impacted_area: tc.impactedArea ?? undefined,
    module: (tc.module as SuiteModule) ?? undefined,
    domain: (tc.domain as FeatureDomain) ?? undefined,
    feature_id: tc.featureId ?? undefined,
    owner: tc.owner ?? undefined,
    status: tc.status as TestCaseStatus,
    run_type: tc.runType as RunType,
    tags: asStringArray(tc.tags),
    metadata: (tc.metadata as Record<string, unknown>) ?? undefined,
    created_at: tc.createdAt.toISOString(),
    updated_at: tc.updatedAt.toISOString(),
    latest_run_id: latestRun?.id,
    latest_run_result: (latestRun?.result as TestRunResult) ?? undefined,
    latest_run_environment: latestRun?.environment,
    latest_run_started_at: latestRun?.startedAt.toISOString(),
    // Free: batchLoadLatestRuns already returns the whole run row, ui_evidence included.
    latest_run_screenshot_count: latestRun
      ? countScreenshots(latestRun.uiEvidence)
      : undefined,
    total_run_count: tc._count.testRuns,
  };
}

@Injectable()
export class TestCasesService {
  constructor(
    private prisma: PrismaService,
    private runsService: RunsService,
  ) {}

  private async batchLoadLatestRuns(
    testCaseIds: string[],
  ): Promise<Map<string, TestRun>> {
    if (testCaseIds.length === 0) return new Map();
    const latestRuns = await this.prisma.testRun.findMany({
      where: { testCaseId: { in: testCaseIds } },
      orderBy: [{ testCaseId: 'asc' }, { startedAt: 'desc' }],
      distinct: ['testCaseId'],
    });
    return new Map(
      latestRuns.map((run: (typeof latestRuns)[number]) => [
        run.testCaseId,
        run,
      ]),
    );
  }

  async listTestCases(
    query: Partial<ListTestCasesQueryDto>,
  ): Promise<PaginatedResponse<TestCaseListItemResponseDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.owner) where.owner = query.owner;
    if (query.scenario_key) where.scenarioKey = query.scenario_key;
    // A real column, so this stays on the fast DB-paginated path below.
    if (query.run_type) where.runType = query.run_type;
    // Likewise real columns, stamped by the runner at persist time.
    if (query.module) where.module = query.module;
    if (query.domain) where.domain = query.domain;
    // Substring rather than equality: a feature id is a screen number ("HW-KHO-03"), and QA
    // filters by a prefix to see every screen of a group as often as by the exact number.
    if (query.feature_id) {
      where.featureId = { contains: query.feature_id, mode: 'insensitive' };
    }
    // Checklist filters live on the checks of the case's runs, not on the case. Both conditions
    // sit inside the same `some` so, when both are given, one check must answer that row of that
    // sheet — two checks answering one each is not a match. Still a plain `where`, so pagination
    // stays at the DB level.
    //
    // Both are case-insensitive substrings, like `feature_id` and like a SQL LIKE: a typed prefix
    // ("QLDN-VT", "TC_1") is meant to widen the result, not to miss it. That also reaches a check
    // answering several rows, which stores them joined as "TC_16 | TC_17". The price is that
    // "TC_1" also matches "TC_16"; type the full id when that matters.
    const checklistId = query.csv_checklist_id?.trim();
    const testcaseId = query.csv_testcase_id?.trim();
    if (checklistId || testcaseId) {
      const check: Record<string, unknown> = {};
      if (checklistId) {
        check.csvChecklistId = { contains: checklistId, mode: 'insensitive' };
      }
      if (testcaseId) {
        check.csvTestcaseId = { contains: testcaseId, mode: 'insensitive' };
      }
      where.testRuns = { some: { checks: { some: check } } };
    }

    const term = query.q?.trim();
    if (term) {
      where.OR = [
        { id: { contains: term, mode: 'insensitive' } },
        { title: { contains: term, mode: 'insensitive' } },
        { scenarioKey: { contains: term, mode: 'insensitive' } },
      ];
    }

    const sortBy = query.sort_by || 'updated_at';
    const sortOrder = (query.sort_order || 'DESC').toLowerCase() as
      'asc' | 'desc';
    const orderBy: Record<string, 'asc' | 'desc'> = {};
    if (sortBy === 'created_at') {
      orderBy.createdAt = sortOrder;
    } else if (sortBy === 'title') {
      orderBy.title = sortOrder;
    } else {
      orderBy.updatedAt = sortOrder;
    }

    const includeOpts = { include: { _count: { select: { testRuns: true } } } };

    if (!query.latest_run_result) {
      // Fast path: no derived-field filter, so pagination can happen at the DB level.
      const [items, total] = await Promise.all([
        this.prisma.testCase.findMany({
          where,
          orderBy,
          skip,
          take: limit,
          ...includeOpts,
        }),
        this.prisma.testCase.count({ where }),
      ]);

      const latestRunByTestCaseId = await this.batchLoadLatestRuns(
        items.map((tc: (typeof items)[number]) => tc.id),
      );

      return {
        items: items.map((tc: (typeof items)[number]) =>
          toTestCaseListItem(tc, latestRunByTestCaseId.get(tc.id)),
        ),
        total,
        page,
        limit,
        has_more: skip + limit < total,
      };
    }

    // Slow path: `latest_run_result` isn't a TestCase column — it's derived from
    // each test case's most recent run. We can't know which rows match until we've
    // resolved that, so we fetch every row matching the other filters/sort (no
    // skip/take), resolve their latest runs in one batched query (still no N+1),
    // filter in JS, and paginate the filtered array ourselves.
    const allMatching = await this.prisma.testCase.findMany({
      where,
      orderBy,
      ...includeOpts,
    });
    const latestRunByTestCaseId = await this.batchLoadLatestRuns(
      allMatching.map((tc: (typeof allMatching)[number]) => tc.id),
    );
    const filtered = allMatching.filter(
      (tc: (typeof allMatching)[number]) =>
        latestRunByTestCaseId.get(tc.id)?.result === query.latest_run_result,
    );
    const total = filtered.length;
    const pageItems = filtered.slice(skip, skip + limit);

    return {
      items: pageItems.map((tc: (typeof pageItems)[number]) =>
        toTestCaseListItem(tc, latestRunByTestCaseId.get(tc.id)),
      ),
      total,
      page,
      limit,
      has_more: skip + limit < total,
    };
  }

  /**
   * The Feature filter's options: whatever domains the runner has actually stamped, so the select
   * never offers a domain with no cases nor misses one added after the shared constants were
   * written. `domain` is indexed, and DISTINCT over it stays cheap.
   */
  async listDomains(
    query: Partial<ListTestCaseDomainsQueryDto>,
  ): Promise<TestCaseDomainListResponseDto> {
    const where: Record<string, unknown> = { domain: { not: null } };
    if (query.run_type) where.runType = query.run_type;

    const rows = await this.prisma.testCase.findMany({
      where,
      select: { domain: true },
      distinct: ['domain'],
      orderBy: { domain: 'asc' },
    });
    const domains = rows
      .map((row: (typeof rows)[number]) => row.domain)
      .filter((domain: string | null): domain is string => !!domain);

    // `_unknown` is a real bucket (probes, MCP sessions), not a null option, so it is offered
    // last rather than sorted in among the documentation modules.
    return {
      domains: [
        ...domains.filter((d: string) => d !== FEATURE_DOMAIN.UNKNOWN),
        ...domains.filter((d: string) => d === FEATURE_DOMAIN.UNKNOWN),
      ],
    };
  }

  async getTestCase(id: string): Promise<TestCaseDetailResponseDto> {
    const testCase = await this.prisma.testCase.findUnique({
      where: { id },
      include: { _count: { select: { testRuns: true } } },
    });

    if (!testCase) {
      throw new NotFoundError('TestCase', id);
    }

    const latestRun = await this.prisma.testRun.findFirst({
      where: { testCaseId: id },
      orderBy: { startedAt: 'desc' },
    });

    return toTestCaseListItem(testCase, latestRun ?? undefined);
  }

  async getTestCaseRuns(
    id: string,
    query: Partial<ListTestRunsQueryDto>,
  ): Promise<PaginatedResponse<TestRunListItemResponseDto>> {
    const testCase = await this.prisma.testCase.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!testCase) {
      throw new NotFoundError('TestCase', id);
    }

    return this.runsService.listRuns({ ...query, test_case_id: id });
  }
}
