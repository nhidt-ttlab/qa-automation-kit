import { NotFoundError, REVIEW_ARTIFACT_KIND } from '@qakit/reporting-shared';
import type { CreateReviewRequestDto } from '@qakit/reporting-shared';
import { ReviewsService } from './reviews.service';
import type { PrismaService } from '../../prisma.service';

function makePrismaMock(findUniqueResult: unknown = { id: 'run-1' }) {
  return {
    testRun: { findUnique: jest.fn().mockResolvedValue(findUniqueResult) },
    artifact: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

const minimalDto: CreateReviewRequestDto = {
  test_run_id: 'run-1',
  verdict: 'approved',
};

describe('ReviewsService', () => {
  it('throws NotFoundError when the run does not exist', async () => {
    const service = new ReviewsService(makePrismaMock(null));
    await expect(service.createReview(minimalDto)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('defaults all new fields when only the minimal dto is provided', async () => {
    const prisma = makePrismaMock();
    const service = new ReviewsService(prisma);

    const review = await service.createReview(minimalDto);

    expect(review).toMatchObject({
      test_run_id: 'run-1',
      verdict: 'approved',
      reviewer: 'qa-reviewer',
      should_improve_testcase: false,
      improvement_summary: '',
      missing_coverage: [],
      suggested_steps: [],
      suggested_assertions: [],
      suggested_test_data: [],
      ai_generation_hint: '',
    });
    expect(review.testcase_quality).toBeUndefined();
    expect(review.id).toEqual(expect.any(String));
    expect(review.reviewed_at).toEqual(expect.any(String));
  });

  it('round-trips a fully-populated dto through the returned object and the persisted artifact', async () => {
    const prisma = makePrismaMock();
    const service = new ReviewsService(prisma);

    const fullDto: CreateReviewRequestDto = {
      test_run_id: 'run-1',
      verdict: 'rejected',
      note: 'missing edge case coverage',
      testcase_quality: 'needs_improvement',
      should_improve_testcase: true,
      improvement_summary: 'Add negative-path assertions',
      missing_coverage: ['zero quantity', 'expired token'],
      suggested_steps: ['Submit PO with qty 0'],
      suggested_assertions: ['Response status is 400'],
      suggested_test_data: ['qty: 0'],
      ai_generation_hint: 'Regenerate with an extra negative-path check',
    };

    const review = await service.createReview(fullDto);

    expect(review).toMatchObject({
      test_run_id: 'run-1',
      verdict: 'rejected',
      note: 'missing edge case coverage',
      testcase_quality: 'needs_improvement',
      should_improve_testcase: true,
      improvement_summary: 'Add negative-path assertions',
      missing_coverage: ['zero quantity', 'expired token'],
      suggested_steps: ['Submit PO with qty 0'],
      suggested_assertions: ['Response status is 400'],
      suggested_test_data: ['qty: 0'],
      ai_generation_hint: 'Regenerate with an extra negative-path check',
    });

    expect(prisma.artifact.create).toHaveBeenCalledTimes(1);
    const createCall = (prisma.artifact.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.kind).toBe(REVIEW_ARTIFACT_KIND);
    expect(createCall.data.runId).toBe('run-1');

    const persisted = JSON.parse(
      Buffer.from(createCall.data.blob).toString('utf-8'),
    );
    expect(persisted).toMatchObject({
      verdict: 'rejected',
      testcase_quality: 'needs_improvement',
      should_improve_testcase: true,
      missing_coverage: ['zero quantity', 'expired token'],
    });
  });

  it('keeps the id/reviewer/reviewed_at shape unchanged', async () => {
    const service = new ReviewsService(makePrismaMock());
    const review = await service.createReview(minimalDto);

    expect(review.id).toMatch(/^review-/);
    expect(review.reviewer).toBe('qa-reviewer');
    expect(() => new Date(review.reviewed_at).toISOString()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// exportReviewsCsv
// ---------------------------------------------------------------------------

function reviewBlob(review: Record<string, unknown>): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: 'review-x',
      test_run_id: 'run-1',
      verdict: 'approved',
      reviewer: 'qa-reviewer',
      reviewed_at: '2026-09-10T02:00:00.000Z',
      ...review,
    }),
    'utf-8',
  );
}

function runFor(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    testCaseId: 'TC-BOQT-B03',
    scenarioKey: 'inv-labor-value-cap-limit',
    runType: 'api',
    module: 'boq-acceptance',
    domain: 'boq-nghiem-thu-thanh-toan',
    result: 'fail',
    startedAt: new Date('2026-09-09T10:00:00.000Z'),
    testCase: { title: 'GT nhân công', featureId: 'QLDN-VT-04' },
    ...overrides,
  };
}

function makeExportPrisma(artifacts: unknown[]) {
  return {
    artifact: { findMany: jest.fn().mockResolvedValue(artifacts) },
  } as unknown as PrismaService;
}

describe('ReviewsService.exportReviewsCsv', () => {
  it('exports only the latest review of each run', async () => {
    // findMany is ordered runId asc, createdAt desc — the first row per run is the newest.
    const prisma = makeExportPrisma([
      {
        runId: 'run-1',
        blob: reviewBlob({ improvement_summary: 'NEWEST' }),
        testRun: runFor('run-1'),
      },
      {
        runId: 'run-1',
        blob: reviewBlob({ improvement_summary: 'OLDER' }),
        testRun: runFor('run-1'),
      },
    ]);

    const { csv } = await new ReviewsService(prisma).exportReviewsCsv();

    expect(csv).toContain('NEWEST');
    expect(csv).not.toContain('OLDER');
  });

  it('skips a corrupt blob instead of failing the whole export', async () => {
    const prisma = makeExportPrisma([
      {
        runId: 'run-1',
        blob: Buffer.from('not json', 'utf-8'),
        testRun: runFor('run-1'),
      },
      { runId: 'run-2', blob: null, testRun: runFor('run-2') },
      {
        runId: 'run-3',
        blob: reviewBlob({ improvement_summary: 'GOOD' }),
        testRun: runFor('run-3'),
      },
    ]);

    const { csv } = await new ReviewsService(prisma).exportReviewsCsv();

    expect(csv).toContain('GOOD');
    expect(csv).not.toContain('run-1');
    expect(csv).not.toContain('run-2');
  });

  it('applies the blob-side filters that SQL cannot', async () => {
    const prisma = makeExportPrisma([
      {
        runId: 'run-1',
        blob: reviewBlob({
          verdict: 'approved',
          improvement_summary: 'KEEP-APPROVED',
        }),
        testRun: runFor('run-1'),
      },
      {
        runId: 'run-2',
        blob: reviewBlob({
          verdict: 'rejected',
          improvement_summary: 'DROP-REJECTED',
        }),
        testRun: runFor('run-2'),
      },
    ]);

    const { csv } = await new ReviewsService(prisma).exportReviewsCsv({
      verdict: 'approved',
    });

    expect(csv).toContain('KEEP-APPROVED');
    expect(csv).not.toContain('DROP-REJECTED');
  });

  it('can filter for should_improve_testcase=false', async () => {
    const prisma = makeExportPrisma([
      {
        runId: 'run-1',
        blob: reviewBlob({
          should_improve_testcase: true,
          improvement_summary: 'NEEDS-WORK',
        }),
        testRun: runFor('run-1'),
      },
      {
        runId: 'run-2',
        blob: reviewBlob({
          should_improve_testcase: false,
          improvement_summary: 'FINE',
        }),
        testRun: runFor('run-2'),
      },
    ]);

    const { csv } = await new ReviewsService(prisma).exportReviewsCsv({
      should_improve_testcase: false,
    });

    expect(csv).toContain('FINE');
    expect(csv).not.toContain('NEEDS-WORK');
  });

  it('pushes the run-shaped filters into the query', async () => {
    const prisma = makeExportPrisma([]);

    await new ReviewsService(prisma).exportReviewsCsv({
      module: 'warehouse',
      run_type: 'ui',
      from_date: '2026-09-01T00:00:00.000Z',
    });

    const where = (prisma.artifact.findMany as jest.Mock).mock.calls[0][0]
      .where;
    expect(where.kind).toBe(REVIEW_ARTIFACT_KIND);
    expect(where.testRun).toMatchObject({ module: 'warehouse', runType: 'ui' });
    expect(where.testRun.startedAt.gte).toEqual(
      new Date('2026-09-01T00:00:00.000Z'),
    );
  });

  it('refuses an export larger than the cap, counting after the blob-side filters', async () => {
    const artifacts = Array.from({ length: 5001 }, (_, i) => ({
      runId: `run-${i}`,
      blob: reviewBlob({}),
      testRun: runFor(`run-${i}`),
    }));

    await expect(
      new ReviewsService(makeExportPrisma(artifacts)).exportReviewsCsv(),
    ).rejects.toThrow(/limited to 5000 reviews; these filters match 5001/);
  });
  it('filters on the review date in SQL when reviewed_from is set', async () => {
    const prisma = makeExportPrisma([]);

    await new ReviewsService(prisma).exportReviewsCsv({
      reviewed_from: '2026-09-13T17:00:00.000Z',
    });

    const where = (prisma.artifact.findMany as jest.Mock).mock.calls[0][0]
      .where;
    expect(where.createdAt).toEqual({
      gte: new Date('2026-09-13T17:00:00.000Z'),
    });
    // The review date is not the run date: the run-shaped filter stays untouched.
    expect(where.testRun.startedAt).toBeUndefined();
  });

  it('does not bound the review date when reviewed_from is absent', async () => {
    const prisma = makeExportPrisma([]);

    await new ReviewsService(prisma).exportReviewsCsv();

    const where = (prisma.artifact.findMany as jest.Mock).mock.calls[0][0]
      .where;
    expect(where).not.toHaveProperty('createdAt');
  });

  it('names the file after the export timestamp', async () => {
    const { filename } = await new ReviewsService(
      makeExportPrisma([]),
    ).exportReviewsCsv({}, new Date('2026-09-10T08:30:00.000Z'));

    expect(filename).toBe('run-reviews-2026-09-10T08-30-00Z.csv');
  });
});
