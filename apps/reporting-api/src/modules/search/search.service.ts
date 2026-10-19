import { Injectable } from '@nestjs/common';
import type {
  PaginatedResponse,
  SearchQueryDto,
  SearchResultResponseDto,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(
    q: string,
    query: Partial<SearchQueryDto>,
  ): Promise<PaginatedResponse<SearchResultResponseDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const term = (q || '').trim();

    if (!term) {
      return { items: [], total: 0, page, limit, has_more: false };
    }

    const wantsType = (type: SearchResultResponseDto['type']) =>
      !query.entity_type || query.entity_type === type;

    const [testCases, testRuns, defects, resolutionIssues] = await Promise.all([
      wantsType('test_case')
        ? this.prisma.testCase.findMany({
            where: {
              OR: [
                { title: { contains: term, mode: 'insensitive' } },
                { scenarioKey: { contains: term, mode: 'insensitive' } },
              ],
            },
            take: 50,
          })
        : Promise.resolve([]),
      wantsType('test_run')
        ? this.prisma.testRun.findMany({
            where: {
              OR: [
                { scenarioKey: { contains: term, mode: 'insensitive' } },
                { businessScenario: { contains: term, mode: 'insensitive' } },
                { id: { contains: term, mode: 'insensitive' } },
              ],
            },
            take: 50,
          })
        : Promise.resolve([]),
      wantsType('defect')
        ? this.prisma.defectSignature.findMany({
            where: { title: { contains: term, mode: 'insensitive' } },
            take: 50,
          })
        : Promise.resolve([]),
      // The display key is the handle people actually quote in chat ('kiem-soat-dat-hang-thua:BL-03'),
      // so it is searched alongside the prose.
      wantsType('resolution_issue')
        ? this.prisma.resolutionIssue.findMany({
            where: {
              OR: [
                { displayKey: { contains: term, mode: 'insensitive' } },
                { title: { contains: term, mode: 'insensitive' } },
                { sourceSummary: { contains: term, mode: 'insensitive' } },
                { userSummary: { contains: term, mode: 'insensitive' } },
              ],
            },
            take: 50,
          })
        : Promise.resolve([]),
    ]);

    const results: SearchResultResponseDto[] = [
      ...testCases.map((tc: (typeof testCases)[number]) => ({
        type: 'test_case' as const,
        id: tc.id,
        title: tc.title,
        snippet: tc.objective ?? undefined,
      })),
      ...testRuns.map((run: (typeof testRuns)[number]) => ({
        type: 'test_run' as const,
        id: run.id,
        title: run.scenarioKey,
        snippet: run.businessScenario ?? undefined,
      })),
      ...defects.map((d: (typeof defects)[number]) => ({
        type: 'defect' as const,
        id: String(d.id),
        title: d.title,
        snippet: d.regressionNote ?? undefined,
      })),
      ...resolutionIssues.map((i: (typeof resolutionIssues)[number]) => ({
        type: 'resolution_issue' as const,
        id: String(i.id),
        title: `${i.displayKey} — ${i.title}`,
        snippet: i.userSummary ?? i.sourceSummary ?? undefined,
        metadata: {
          workflow_status: i.workflowStatus,
          kind: i.kind,
          domain: i.domain,
          observation_count: i.observationCount,
        },
      })),
    ];

    const total = results.length;
    const start = (page - 1) * limit;
    const items = results.slice(start, start + limit);

    return {
      items,
      total,
      page,
      limit,
      has_more: start + limit < total,
    };
  }
}
