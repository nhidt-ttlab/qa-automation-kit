import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { Readable } from 'stream';
import type {
  PaginatedResponse,
  ListTestRunsQueryDto,
  TestRunDetailResponseDto,
  TestRunListItemResponseDto,
  ReviewRecordResponseDto,
  BugLinkType,
  DefectSeverity,
  Reproducibility,
  TestRunResult,
  EntityType,
  RunType,
  SuiteModule,
  FeatureDomain,
} from '@qakit/reporting-shared';
import {
  NotFoundError,
  REVIEW_ARTIFACT_KIND,
  checkStatus,
  normalizeReviewRecord,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import type { TestCase, TestRun } from '../../generated/prisma/client';
import {
  resolveArtifactStorageRoot,
  resolveSafeArtifactPath,
  inferContentType,
} from './artifact-storage.util';
import { resolveEvidenceStorageRoot } from './evidence-storage.util';
import {
  findStoredItem,
  parseStoredUiEvidence,
  toPublicUiEvidence,
} from './ui-evidence.util';

type RunWithTestCase = TestRun & { testCase: TestCase };

export type ArtifactDownloadResult =
  | { kind: 'redirect'; url: string }
  | {
      kind: 'stream';
      stream: NodeJS.ReadableStream;
      contentType: string;
      contentLength?: number;
      filename: string;
    };

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asPayloadArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
      )
    : [];
}

type BugLinkRow = {
  id: number;
  createdFromRunId: string | null;
  redmineIssueId: number;
  redmineUrl: string | null;
  redmineProject: string | null;
  linkType: string;
  createdAt: Date;
};

type RunRedmineLink = NonNullable<
  TestRunDetailResponseDto['redmine_links']
>[number];

/**
 * Merges the Redmine tickets filed from this run with those already hanging off the run's
 * defect signatures — a signature is shared by every run reproducing the same defect, so a
 * ticket another run filed is still the answer to "has this been reported?".
 *
 * Deduplicated by issue id, with the entry filed from this run winning so
 * `created_from_this_run` is not lost when a link reaches us down both paths.
 */
function toRunRedmineLinks(
  runId: string,
  links: BugLinkRow[],
): RunRedmineLink[] {
  const byIssueId = new Map<number, RunRedmineLink>();

  for (const link of links) {
    const createdFromThisRun = link.createdFromRunId === runId;
    if (byIssueId.get(link.redmineIssueId)?.created_from_this_run) {
      continue;
    }
    byIssueId.set(link.redmineIssueId, {
      id: String(link.id),
      redmine_issue_id: link.redmineIssueId,
      redmine_url: link.redmineUrl,
      redmine_project: link.redmineProject,
      link_type: link.linkType as BugLinkType,
      created_from_this_run: createdFromThisRun,
      created_at: link.createdAt.toISOString(),
    });
  }

  return [...byIssueId.values()].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

function toRunListItem(run: RunWithTestCase): TestRunListItemResponseDto {
  return {
    id: run.id,
    test_case_id: run.testCaseId,
    scenario_key: run.scenarioKey,
    module: (run.module as SuiteModule) ?? undefined,
    domain: (run.domain as FeatureDomain) ?? undefined,
    environment: run.environment,
    dry_run: run.dryRun,
    result: run.result as TestRunResult,
    run_type: run.runType as RunType,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt?.toISOString(),
    duration_ms: run.durationMs ?? undefined,
    executed_by: run.executedBy ?? undefined,
    git_commit: run.gitCommit ?? undefined,
    git_branch: run.gitBranch ?? undefined,
    business_scenario: run.businessScenario ?? undefined,
    severity: (run.severity as DefectSeverity) ?? undefined,
    reproducibility: (run.reproducibility as Reproducibility) ?? undefined,
    defect_statement: run.defectStatement ?? undefined,
    blocked_reason: run.blockedReason ?? undefined,
    error_summary: run.errorSummary ?? undefined,
    conclusion: run.conclusion ?? undefined,
    overview_key_data: asStringArray(run.overviewKeyData),
    overview_highlights: asStringArray(run.overviewHighlights),
    payloads: asPayloadArray(
      run.payloads,
    ) as unknown as TestRunListItemResponseDto['payloads'],
    tags: asStringArray(run.tags),
    custom_data: (run.customData as Record<string, unknown>) ?? undefined,
    created_at: run.createdAt.toISOString(),
    updated_at: run.createdAt.toISOString(),
    test_case_title: run.testCase?.title,
    feature_id: run.testCase?.featureId ?? undefined,
  };
}

@Injectable()
export class RunsService {
  constructor(private prisma: PrismaService) {}

  async listRuns(
    query: Partial<ListTestRunsQueryDto>,
  ): Promise<PaginatedResponse<TestRunListItemResponseDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    // Build where filters
    const where: Record<string, unknown> = {};
    if (query.test_case_id) where.testCaseId = query.test_case_id;
    if (query.scenario_key) where.scenarioKey = query.scenario_key;
    if (query.run_type) where.runType = query.run_type;
    // Denormalized onto the run, so filtering by module/feature needs no join.
    if (query.module) where.module = query.module;
    if (query.domain) where.domain = query.domain;
    if (query.environment) where.environment = query.environment;
    if (query.result) where.result = query.result;
    if (query.dry_run !== undefined) where.dryRun = query.dry_run;

    // Date range filters
    const startDate = query.from_date ? new Date(query.from_date) : undefined;
    const endDate = query.to_date ? new Date(query.to_date) : undefined;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    // Tags filter (JSON array search - simplified)
    // For full-text search with tags, use raw SQL or implement FTS later

    // Sorting
    const sortBy = query.sort_by || 'created_at';
    const sortOrder = (query.sort_order || 'DESC').toLowerCase() as
      'asc' | 'desc';
    const orderBy: Record<string, 'asc' | 'desc'> = {};
    if (sortBy === 'created_at') {
      orderBy.createdAt = sortOrder;
    } else if (sortBy === 'started_at') {
      orderBy.startedAt = sortOrder;
    } else if (sortBy === 'result') {
      orderBy.result = sortOrder;
    }

    // Execute query
    const [items, total] = await Promise.all([
      this.prisma.testRun.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          testCase: true,
        },
      }),
      this.prisma.testRun.count({ where }),
    ]);

    return {
      items: items.map((run) => toRunListItem(run)),
      total,
      page,
      limit,
      has_more: skip + limit < total,
    };
  }

  async getRun(id: string): Promise<TestRunDetailResponseDto> {
    const run = await this.prisma.testRun.findUnique({
      where: { id },
      include: {
        testCase: true,
        checks: true,
        steps: true,
        evidence: true,
        relatedEntities: true,
        artifacts: true,
        defectObservations: {
          orderBy: { observedAt: 'desc' },
          include: {
            defectSignature: {
              include: {
                bugLinks: true,
              },
            },
          },
        },
        bugLinksCreatedFromThisRun: true,
      },
    });

    if (!run) {
      throw new NotFoundError('TestRun', id);
    }

    const review = await this.getLatestReview(id);
    const uiEvidence = parseStoredUiEvidence(run.uiEvidence);

    // Transform Prisma model to DTO
    return {
      ...toRunListItem(run),
      checks: run.checks.map((c: (typeof run.checks)[number]) => {
        const expected = c.expected ?? undefined;
        const actual = c.actual ?? undefined;
        return {
          id: String(c.id),
          name: c.label,
          passed: c.passed,
          // The DB column is a bare boolean, so the harness' third state ("could not be scored")
          // only survives as the `NOT_EVALUATED` marker on expected/actual. Re-derive it here so
          // clients never have to sniff the strings themselves.
          status: checkStatus({ expected, actual, passed: c.passed }),
          expected,
          actual,
          test_id: c.testId ?? undefined,
          // The checklist snapshot, passed through untouched. Note it plays no part in `status`
          // above: the sheet's wording describes invented data and must never move a verdict.
          csv_checklist_id: c.csvChecklistId ?? undefined,
          csv_testcase_id: c.csvTestcaseId ?? undefined,
          csv_expected: c.csvExpected ?? undefined,
          csv_business_rule: c.csvBusinessRule ?? undefined,
          csv_priority: c.csvPriority ?? undefined,
        };
      }),
      steps: run.steps.map((s: (typeof run.steps)[number]) => ({
        id: String(s.id),
        name: s.title,
        status: s.ok ? 'passed' : 'failed',
        sequence: s.sequence,
      })),
      evidence: run.evidence
        .filter((e: (typeof run.evidence)[number]) => e.artifactId == null)
        .map((e: (typeof run.evidence)[number]) => ({
          id: String(e.id),
          method: e.method,
          url: e.endpoint,
          status: e.httpStatus ?? 0,
        })),
      related_entities: run.relatedEntities.map(
        (e: (typeof run.relatedEntities)[number]) => ({
          type: e.entityType as EntityType,
          id: e.entityId,
          label: e.entityLabel ?? undefined,
        }),
      ),
      review: review ?? undefined,
      redmine_links: toRunRedmineLinks(run.id, [
        ...run.bugLinksCreatedFromThisRun,
        ...run.defectObservations.flatMap(
          (o: (typeof run.defectObservations)[number]) =>
            o.defectSignature.bugLinks,
        ),
      ]),
      defects: run.defectObservations.map(
        (o: (typeof run.defectObservations)[number]) => ({
          id: String(o.defectSignature.id),
          title: o.defectSignature.title,
          severity: (o.defectSignature.severity as DefectSeverity) ?? 'Low',
        }),
      ),
      artifact_links: run.artifacts
        .filter(
          (a: (typeof run.artifacts)[number]) =>
            a.kind !== REVIEW_ARTIFACT_KIND,
        )
        .map((a: (typeof run.artifacts)[number]) => ({
          type: a.kind,
          url: `/api/runs/${encodeURIComponent(run.id)}/artifacts/${a.id}/download`,
          label:
            a.sizeBytes != null ? `${a.kind} (${a.sizeBytes} bytes)` : a.kind,
        })),
      ui_evidence: uiEvidence ? toPublicUiEvidence(uiEvidence) : undefined,
    };
  }

  /**
   * Streams one UI evidence file.
   *
   * The caller supplies an item id, never a path — the path comes from the run's own stored
   * manifest — so there is no traversal surface here at all. resolveSafeArtifactPath is kept
   * as defence in depth against a malformed manifest.
   */
  async getUiEvidenceFile(
    runId: string,
    itemId: string,
  ): Promise<ArtifactDownloadResult> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { uiEvidence: true },
    });
    if (!run) throw new NotFoundError('TestRun', runId);

    const stored = parseStoredUiEvidence(run.uiEvidence);
    const item = stored ? findStoredItem(stored, itemId) : undefined;
    if (!item) throw new NotFoundError('UiEvidenceItem', itemId);

    const resolvedPath = resolveSafeArtifactPath(
      resolveEvidenceStorageRoot(),
      item.storage_path,
    );
    try {
      const stat = await fs.promises.stat(resolvedPath);
      return {
        kind: 'stream',
        stream: fs.createReadStream(resolvedPath),
        contentType: inferContentType(resolvedPath),
        contentLength: stat.size,
        filename: resolvedPath.split(/[\\/]/).pop() ?? item.id,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // The row survived but the file did not -- most likely storage was wiped without a
        // re-sync. A 404 is honest; the next `pnpm db:sync` restores it.
        throw new NotFoundError('UiEvidenceFile', item.storage_path);
      }
      throw error;
    }
  }

  async getArtifactDownload(
    runId: string,
    artifactId: number,
  ): Promise<ArtifactDownloadResult> {
    const artifact = await this.prisma.artifact.findFirst({
      where: { id: artifactId, runId },
    });
    if (!artifact || artifact.kind === REVIEW_ARTIFACT_KIND) {
      throw new NotFoundError('Artifact', String(artifactId));
    }

    if (artifact.externalUrl) {
      return { kind: 'redirect', url: artifact.externalUrl };
    }

    if (artifact.blob != null) {
      const buffer = Buffer.from(artifact.blob);
      return {
        kind: 'stream',
        stream: Readable.from(buffer),
        contentType: 'application/json',
        contentLength: buffer.byteLength,
        filename: `artifact-${artifact.id}.json`,
      };
    }

    if (artifact.path != null) {
      const root = resolveArtifactStorageRoot();
      const resolvedPath = resolveSafeArtifactPath(root, artifact.path);
      try {
        const stat = await fs.promises.stat(resolvedPath);
        return {
          kind: 'stream',
          stream: fs.createReadStream(resolvedPath),
          contentType: inferContentType(resolvedPath),
          contentLength: stat.size,
          filename:
            resolvedPath.split(/[\\/]/).pop() ?? `artifact-${artifact.id}`,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new NotFoundError('ArtifactFile', artifact.path);
        }
        throw error;
      }
    }

    throw new NotFoundError('Artifact', String(artifactId));
  }

  async getRunReport(id: string): Promise<Record<string, unknown>> {
    const run = await this.prisma.testRun.findUnique({
      where: { id },
      select: { id: true, reportModel: true },
    });

    if (!run) {
      throw new NotFoundError('TestRun', id);
    }

    if (!run.reportModel || typeof run.reportModel !== 'object') {
      throw new NotFoundError('TestRunReport', id);
    }

    return run.reportModel as Record<string, unknown>;
  }

  async getRunReview(id: string): Promise<ReviewRecordResponseDto> {
    const run = await this.prisma.testRun.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!run) {
      throw new NotFoundError('TestRun', id);
    }

    const review = await this.getLatestReview(id);
    if (!review) {
      throw new NotFoundError('TestRunReview', id);
    }

    return review;
  }

  /**
   * Reviews are intentionally kept out of the relational schema (see schema.sql §"Phase 2") and
   * persisted as an `artifacts` row of kind `review_record` instead — this reads the latest one.
   */
  private async getLatestReview(
    runId: string,
  ): Promise<ReviewRecordResponseDto | null> {
    const reviewArtifact = await this.prisma.artifact.findFirst({
      where: { runId, kind: REVIEW_ARTIFACT_KIND },
      orderBy: { createdAt: 'desc' },
    });

    if (!reviewArtifact?.blob) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(reviewArtifact.blob).toString('utf-8'),
      ) as Record<string, unknown>;
      return normalizeReviewRecord(parsed);
    } catch {
      return null;
    }
  }
}
