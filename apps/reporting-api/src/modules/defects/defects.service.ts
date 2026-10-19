import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  PaginatedResponse,
  ListDefectSignaturesQueryDto,
  DefectSignatureSummaryResponseDto,
  DefectSignatureDetailResponseDto,
  DefectSignatureStatus,
  LinkRedmineRequestDto,
  DefectSeverity,
  BugLinkType,
  TestRunResult,
} from '@qakit/reporting-shared';
import { NotFoundError } from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import type { Prisma } from '../../generated/prisma/client';

const detailInclude = {
  testCase: true,
  bugLinks: true,
  firstObservedRun: { select: { startedAt: true } },
  lastObservedRun: { select: { startedAt: true } },
  observations: {
    include: { testRun: true },
    orderBy: { observedAt: 'desc' as const },
  },
} satisfies Prisma.DefectSignatureInclude;

type DefectWithDetail = Prisma.DefectSignatureGetPayload<{
  include: typeof detailInclude;
}>;

@Injectable()
export class DefectsService {
  constructor(private prisma: PrismaService) {}

  async listDefects(
    query: Partial<ListDefectSignaturesQueryDto>,
  ): Promise<PaginatedResponse<DefectSignatureSummaryResponseDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.scenario_key) where.scenarioKey = query.scenario_key;
    if (query.severity) where.severity = query.severity;
    if (query.status) where.status = query.status;
    // defect_signatures carries only scenario_key, so every test-case-shaped filter goes through
    // the relation — and they have to be merged into ONE `testCase` object: assigning it twice
    // would silently drop the earlier filter.
    const testCaseFilter: Record<string, unknown> = {};
    if (query.test_case_id) testCaseFilter.id = query.test_case_id;
    if (query.module) testCaseFilter.module = query.module;
    if (query.domain) testCaseFilter.domain = query.domain;
    if (Object.keys(testCaseFilter).length > 0) where.testCase = testCaseFilter;

    const [items, total] = await Promise.all([
      this.prisma.defectSignature.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          bugLinks: true,
          firstObservedRun: { select: { startedAt: true } },
          lastObservedRun: { select: { startedAt: true } },
          _count: { select: { observations: true } },
        },
      }),
      this.prisma.defectSignature.count({ where }),
    ]);

    return {
      items: items.map((d: (typeof items)[number]) => ({
        id: String(d.id),
        title: d.title,
        severity: (d.severity as DefectSeverity) ?? 'Low',
        status: d.status as DefectSignatureStatus,
        scenario_key: d.scenarioKey,
        first_seen_at: (
          d.firstObservedRun?.startedAt ?? d.createdAt
        ).toISOString(),
        last_seen_at: (
          d.lastObservedRun?.startedAt ?? d.updatedAt
        ).toISOString(),
        observation_count: d._count.observations,
        bug_link_count: d.bugLinks.length,
      })),
      total,
      page,
      limit,
      has_more: skip + limit < total,
    };
  }

  async getDefect(id: string): Promise<DefectSignatureDetailResponseDto> {
    const defect = await this.prisma.defectSignature.findUnique({
      where: { id: Number(id) },
      include: detailInclude,
    });

    if (!defect) {
      throw new NotFoundError('DefectSignature', id);
    }

    return this.toDetailDto(defect);
  }

  async createFromRun(
    runId: string,
  ): Promise<DefectSignatureDetailResponseDto> {
    const run = await this.prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundError('TestRun', runId);
    }

    const basis =
      run.defectStatement ||
      run.errorSummary ||
      run.conclusion ||
      `Unclassified defect in ${run.scenarioKey}`;
    const signatureHash = createHash('sha256')
      .update(`${run.scenarioKey}:${basis}`)
      .digest('hex');

    let defect = await this.prisma.defectSignature.findUnique({
      where: { signatureHash },
    });

    if (!defect) {
      defect = await this.prisma.defectSignature.create({
        data: {
          signatureHash,
          scenarioKey: run.scenarioKey,
          title: basis.slice(0, 200),
          severity: run.severity ?? undefined,
          status: 'draft',
        },
      });
    }

    await this.prisma.defectObservation.upsert({
      where: {
        defectSignatureId_runId: {
          defectSignatureId: defect.id,
          runId: run.id,
        },
      },
      create: {
        defectSignatureId: defect.id,
        runId: run.id,
        defectStatement: run.defectStatement ?? undefined,
      },
      update: {},
    });

    return this.getDefect(String(defect.id));
  }

  async linkRedmine(
    id: string,
    dto: LinkRedmineRequestDto,
  ): Promise<DefectSignatureDetailResponseDto> {
    const numericId = Number(id);
    const defect = await this.prisma.defectSignature.findUnique({
      where: { id: numericId },
    });
    if (!defect) {
      throw new NotFoundError('DefectSignature', id);
    }

    await this.prisma.bugLink.create({
      data: {
        defectSignatureId: numericId,
        redmineIssueId: dto.redmine_issue_id,
        redmineUrl: dto.redmine_url,
        redmineProject: dto.redmine_project,
        linkType: dto.link_type ?? 'manually_linked',
      },
    });

    return this.getDefect(id);
  }

  private toDetailDto(
    defect: DefectWithDetail,
  ): DefectSignatureDetailResponseDto {
    return {
      id: String(defect.id),
      title: defect.title,
      severity: (defect.severity as DefectSeverity) ?? 'Low',
      status: defect.status as DefectSignatureStatus,
      diagnosis:
        defect.regressionNote ??
        defect.probableFailingRule ??
        defect.suspectedComponent ??
        undefined,
      test_case_id: defect.testCase?.id,
      scenario_key: defect.scenarioKey,
      first_seen_at: (
        defect.firstObservedRun?.startedAt ??
        defect.observations.at(-1)?.observedAt ??
        defect.createdAt
      ).toISOString(),
      last_seen_at: (
        defect.lastObservedRun?.startedAt ??
        defect.observations[0]?.observedAt ??
        defect.updatedAt
      ).toISOString(),
      observation_count: defect.observations.length,
      linked_runs: defect.observations.map(
        (o: (typeof defect.observations)[number]) => ({
          id: o.testRun.id,
          environment: o.testRun.environment,
          result: o.testRun.result as TestRunResult,
          observed_at: o.observedAt.toISOString(),
        }),
      ),
      bug_links: defect.bugLinks.map((b: (typeof defect.bugLinks)[number]) => ({
        id: String(b.id),
        redmine_issue_id: b.redmineIssueId,
        redmine_url: b.redmineUrl ?? '',
        redmine_project: b.redmineProject ?? '',
        link_type: b.linkType as BugLinkType,
      })),
      created_at: defect.createdAt.toISOString(),
      updated_at: defect.updatedAt.toISOString(),
    };
  }
}
