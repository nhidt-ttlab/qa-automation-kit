import { Injectable } from '@nestjs/common';
import type {
  CreateReviewRequestDto,
  ReviewRecordResponseDto,
} from '@qakit/reporting-shared';

import type { Prisma } from '../../generated/prisma/client';
import {
  NotFoundError,
  REVIEW_ARTIFACT_KIND,
  ValidationError,
  normalizeReviewRecord,
} from '@qakit/reporting-shared';
import type { ExportReviewsQuery } from './dto/export-reviews-query.dto';
import type { ExportableReview } from './reviews-csv.util';
import {
  buildReviewExportFilename,
  buildReviewsCsv,
  matchesReviewFilters,
} from './reviews-csv.util';
import { PrismaService } from '../../prisma.service';

const MAX_EXPORT_REVIEWS = 5000;

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Review records are intentionally kept out of the relational schema (see
   * schema.sql §"Phase 2 (postponed)") and persisted as an `artifacts` row of
   * kind `review_record` instead, mirroring the pattern used for reports.
   *
   * There is no auth/reviewer-identity system in this workspace yet, so the
   * reviewer is a fixed placeholder until one exists.
   */
  async createReview(
    dto: CreateReviewRequestDto,
  ): Promise<ReviewRecordResponseDto> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: dto.test_run_id },
    });
    if (!run) {
      throw new NotFoundError('TestRun', dto.test_run_id);
    }

    const review: ReviewRecordResponseDto = normalizeReviewRecord({
      id: `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      test_run_id: dto.test_run_id,
      verdict: dto.verdict,
      note: dto.note,
      reviewer: 'qa-reviewer',
      reviewed_at: new Date().toISOString(),
      testcase_quality: dto.testcase_quality,
      should_improve_testcase: dto.should_improve_testcase,
      improvement_summary: dto.improvement_summary,
      missing_coverage: dto.missing_coverage,
      suggested_steps: dto.suggested_steps,
      suggested_assertions: dto.suggested_assertions,
      suggested_test_data: dto.suggested_test_data,
      ai_generation_hint: dto.ai_generation_hint,
    });

    const payload = Buffer.from(JSON.stringify(review), 'utf-8');

    await this.prisma.artifact.create({
      data: {
        runId: dto.test_run_id,
        kind: REVIEW_ARTIFACT_KIND,
        storageType: 'blob',
        blob: payload,
        sizeBytes: payload.byteLength,
      },
    });

    return review;
  }

  /**
   * Every run that has a review, as a CSV an agent can walk to update the scenario scripts.
   *
   * Two things about how reviews are stored shape this method. They are append-only artifact
   * rows, so a run with three submits has three rows and only the newest counts — the same rule
   * `RunsService.getLatestReview` applies when the detail page shows one. And they are opaque
   * JSON blobs rather than columns, so `verdict` and `should_improve_testcase` cannot be filtered
   * in SQL the way the run-shaped filters can; they are applied after parsing, which is also why
   * the export cap is checked against the post-filter count rather than a `count()`.
   *
   * `reviewed_from` is the exception that *can* be SQL: the artifact's `createdAt` is written in
   * the same request as the blob's `reviewed_at`. As a lower bound it keeps the latest-wins rule
   * intact -- a run's newest review is always the last to pass it.
   */
  async exportReviewsCsv(
    query: ExportReviewsQuery = {},
    now: Date = new Date(),
  ): Promise<{ filename: string; csv: string }> {
    const artifacts = await this.prisma.artifact.findMany({
      where: {
        kind: REVIEW_ARTIFACT_KIND,
        testRun: this.buildRunWhere(query),
        ...(query.reviewed_from
          ? { createdAt: { gte: new Date(query.reviewed_from) } }
          : {}),
      },
      // runId groups the submits for one run together; createdAt desc puts the newest first, so
      // the first row seen per run is the one that counts.
      orderBy: [{ runId: 'asc' }, { createdAt: 'desc' }],
      include: {
        testRun: {
          include: { testCase: { select: { title: true, featureId: true } } },
        },
      },
    });

    const entries: ExportableReview[] = [];
    const seenRuns = new Set<string>();

    for (const artifact of artifacts) {
      if (seenRuns.has(artifact.runId)) continue;
      seenRuns.add(artifact.runId);

      const review = this.parseReviewBlob(artifact.blob);
      // A blob that will not parse is a corrupt row, not an empty review: skipping it keeps the
      // export working, exactly as getLatestReview degrades to "not reviewed" rather than throwing.
      if (!review) continue;
      if (!matchesReviewFilters(review, query)) continue;

      const run = artifact.testRun;
      entries.push({
        review,
        runId: run.id,
        testCaseId: run.testCaseId,
        testCaseTitle: run.testCase?.title ?? null,
        scenarioKey: run.scenarioKey,
        runType: run.runType,
        module: run.module,
        domain: run.domain,
        featureId: run.testCase?.featureId ?? null,
        result: run.result,
        startedAt: run.startedAt,
      });
    }

    if (entries.length > MAX_EXPORT_REVIEWS) {
      throw new ValidationError(
        `The export is limited to ${MAX_EXPORT_REVIEWS} reviews; these filters match ${entries.length}. Narrow the filters and export again.`,
        { matched: entries.length, limit: MAX_EXPORT_REVIEWS },
      );
    }

    return {
      filename: buildReviewExportFilename(now),
      csv: buildReviewsCsv(entries),
    };
  }

  /** The run-shaped half of the filters -- the half that can be SQL. */
  private buildRunWhere(query: ExportReviewsQuery): Prisma.TestRunWhereInput {
    const where: Prisma.TestRunWhereInput = {};
    if (query.module) where.module = query.module;
    if (query.domain) where.domain = query.domain;
    if (query.run_type) where.runType = query.run_type;
    if (query.from_date || query.to_date) {
      where.startedAt = {
        ...(query.from_date ? { gte: new Date(query.from_date) } : {}),
        ...(query.to_date ? { lte: new Date(query.to_date) } : {}),
      };
    }
    return where;
  }

  private parseReviewBlob(
    blob: Uint8Array | null,
  ): ReviewRecordResponseDto | null {
    if (!blob) return null;
    try {
      const parsed = JSON.parse(Buffer.from(blob).toString('utf-8')) as Record<
        string,
        unknown
      >;
      return normalizeReviewRecord(parsed);
    } catch {
      return null;
    }
  }
}
