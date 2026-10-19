import * as fs from 'fs';
import * as path from 'path';
import { NotFoundError, REVIEW_ARTIFACT_KIND } from '@qakit/reporting-shared';
import { RunsService } from './runs.service';
import type { PrismaService } from '../../prisma.service';
import { resolveArtifactStorageRoot } from './artifact-storage.util';

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    createReadStream: jest.fn(),
    promises: { ...actual.promises, stat: jest.fn() },
  };
});

function blobOf(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

function makePrismaMock({
  run = { id: 'run-1' },
  artifact = null,
}: {
  run?: unknown;
  artifact?: unknown;
} = {}) {
  return {
    testRun: { findUnique: jest.fn().mockResolvedValue(run) },
    artifact: { findFirst: jest.fn().mockResolvedValue(artifact) },
  } as unknown as PrismaService;
}

describe('RunsService.getRunReview', () => {
  it('throws NotFoundError when the run does not exist', async () => {
    const service = new RunsService(makePrismaMock({ run: null }));
    await expect(service.getRunReview('missing-run')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws NotFoundError mentioning TestRunReview when no review has been submitted yet', async () => {
    const service = new RunsService(makePrismaMock({ artifact: null }));
    const error = await service.getRunReview('run-1').catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain('TestRunReview');
  });

  it('normalizes an old-shape minimal artifact blob to defaulted new fields (backward compat)', async () => {
    const oldShapeBlob = blobOf({
      id: 'review-old1',
      test_run_id: 'run-1',
      verdict: 'approved',
      note: 'looks fine',
      reviewer: 'qa-reviewer',
      reviewed_at: '2025-01-01T00:00:00.000Z',
    });
    const service = new RunsService(
      makePrismaMock({ artifact: { blob: oldShapeBlob } }),
    );

    const review = await service.getRunReview('run-1');

    expect(review).toMatchObject({
      id: 'review-old1',
      verdict: 'approved',
      note: 'looks fine',
      should_improve_testcase: false,
      improvement_summary: '',
      missing_coverage: [],
      suggested_steps: [],
      suggested_assertions: [],
      suggested_test_data: [],
      ai_generation_hint: '',
    });
    expect(review.testcase_quality).toBeUndefined();
  });

  it('round-trips a fully-enriched artifact blob unchanged', async () => {
    const enriched = {
      id: 'review-full1',
      test_run_id: 'run-1',
      verdict: 'rejected',
      note: 'needs work',
      reviewer: 'qa-reviewer',
      reviewed_at: '2025-01-02T00:00:00.000Z',
      testcase_quality: 'poor',
      should_improve_testcase: true,
      improvement_summary: 'add assertions',
      missing_coverage: ['edge case'],
      suggested_steps: ['step 1'],
      suggested_assertions: ['assert 1'],
      suggested_test_data: ['data 1'],
      ai_generation_hint: 'regenerate with more checks',
    };
    const service = new RunsService(
      makePrismaMock({ artifact: { blob: blobOf(enriched) } }),
    );

    const review = await service.getRunReview('run-1');

    expect(review).toMatchObject(enriched);
  });

  it('queries the latest review artifact with runId/kind and newest-first ordering', async () => {
    const prisma = makePrismaMock({
      artifact: {
        blob: blobOf({
          id: 'review-1',
          test_run_id: 'run-1',
          verdict: 'approved',
          reviewer: 'qa-reviewer',
          reviewed_at: '2025-01-01T00:00:00.000Z',
        }),
      },
    });
    const service = new RunsService(prisma);

    await service.getRunReview('run-1');

    expect(prisma.artifact.findFirst).toHaveBeenCalledWith({
      where: { runId: 'run-1', kind: REVIEW_ARTIFACT_KIND },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('RunsService.getArtifactDownload', () => {
  const statSpy = fs.promises.stat as jest.Mock;
  const createReadStreamSpy = fs.createReadStream as jest.Mock;

  beforeEach(() => {
    statSpy.mockReset();
    createReadStreamSpy.mockReset().mockReturnValue({});
  });

  it('throws NotFoundError when the artifact does not exist', async () => {
    const service = new RunsService(makePrismaMock({ artifact: null }));
    await expect(
      service.getArtifactDownload('run-1', 999),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError for a review-kind artifact', async () => {
    const service = new RunsService(
      makePrismaMock({
        artifact: { id: 1, runId: 'run-1', kind: REVIEW_ARTIFACT_KIND },
      }),
    );
    await expect(
      service.getArtifactDownload('run-1', 1),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resolves an externalUrl-backed artifact to a redirect', async () => {
    const service = new RunsService(
      makePrismaMock({
        artifact: {
          id: 2,
          runId: 'run-1',
          kind: 'trace',
          externalUrl: 'https://example.com/trace.json',
        },
      }),
    );

    const result = await service.getArtifactDownload('run-1', 2);

    expect(result).toEqual({
      kind: 'redirect',
      url: 'https://example.com/trace.json',
    });
  });

  it('resolves a blob-backed artifact to a stream with the right content type/length', async () => {
    const buffer = blobOf({ hello: 'world' });
    const service = new RunsService(
      makePrismaMock({
        artifact: { id: 3, runId: 'run-1', kind: 'trace', blob: buffer },
      }),
    );

    const result = await service.getArtifactDownload('run-1', 3);

    expect(result.kind).toBe('stream');
    if (result.kind === 'stream') {
      expect(result.contentType).toBe('application/json');
      expect(result.contentLength).toBe(buffer.byteLength);
      expect(result.filename).toBe('artifact-3.json');
    }
  });

  it('resolves a file-backed artifact to a stream rooted under the storage root', async () => {
    statSpy.mockResolvedValue({ size: 123 });
    const fakeStream = {} as fs.ReadStream;
    createReadStreamSpy.mockReturnValue(fakeStream);

    const service = new RunsService(
      makePrismaMock({
        artifact: {
          id: 4,
          runId: 'run-1',
          kind: 'trace',
          path: 'outputs/run-1/trace.json',
        },
      }),
    );

    const result = await service.getArtifactDownload('run-1', 4);

    const expectedRoot = resolveArtifactStorageRoot();
    const expectedPath = path.resolve(expectedRoot, 'outputs/run-1/trace.json');

    expect(createReadStreamSpy).toHaveBeenCalledWith(expectedPath);
    expect(expectedPath.startsWith(expectedRoot + path.sep)).toBe(true);
    expect(result).toEqual({
      kind: 'stream',
      stream: fakeStream,
      contentType: 'application/json',
      contentLength: 123,
      filename: 'trace.json',
    });
  });

  it('throws NotFoundError when the file-backed artifact is missing on disk', async () => {
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    statSpy.mockRejectedValue(enoent);

    const service = new RunsService(
      makePrismaMock({
        artifact: {
          id: 5,
          runId: 'run-1',
          kind: 'trace',
          path: 'outputs/run-1/missing.json',
        },
      }),
    );

    await expect(
      service.getArtifactDownload('run-1', 5),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('RunsService.getRun artifact_links', () => {
  it('points each artifact link at the download endpoint instead of a raw path', async () => {
    const run = {
      id: 'run-1',
      testCaseId: 'tc-1',
      scenarioKey: 'scenario',
      environment: 'staging',
      dryRun: false,
      result: 'passed',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      checks: [],
      steps: [],
      evidence: [],
      relatedEntities: [],
      defectObservations: [],
      bugLinksCreatedFromThisRun: [],
      artifacts: [
        {
          id: 3,
          kind: 'trace',
          path: 'outputs/run-1/trace.json',
          sizeBytes: 100,
        },
      ],
    };
    const service = new RunsService(makePrismaMock({ run, artifact: null }));

    const detail = await service.getRun('run-1');

    expect(detail.artifact_links).toEqual([
      {
        type: 'trace',
        url: '/api/runs/run-1/artifacts/3/download',
        label: 'trace (100 bytes)',
      },
    ]);
  });
});

describe('RunsService.getRun check status', () => {
  /**
   * Regression for the bug where a `NOT_EVALUATED` checkpoint surfaced as a green tick: the
   * harness encodes "could not be scored" by setting `expected === actual === 'NOT_EVALUATED …'`,
   * which makes `passed` trivially true (`check()` computes it as `expected === actual`). The
   * boolean `test_run_checks.passed` column cannot carry that third state, so `getRun` re-derives
   * it from the marker. Shape below is taken verbatim from run `TC-NC-E76`.
   */
  function runWithChecks(checks: unknown[]) {
    return {
      id: 'run-1',
      testCaseId: 'TC-NC-E76',
      scenarioKey: 'pr-detail-qty-difference-formula',
      environment: 'qa',
      dryRun: false,
      result: 'PARTIAL',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      checks,
      steps: [],
      evidence: [],
      relatedEntities: [],
      defectObservations: [],
      bugLinksCreatedFromThisRun: [],
      artifacts: [],
    };
  }

  it('reports a trivially-passing NOT_EVALUATED check as not_evaluated, not passed', async () => {
    const marker =
      'NOT_EVALUATED (BL-16 — chưa chốt quy tắc làm tròn / dung sai cho trường công thức TIỀN.)';
    const run = runWithChecks([
      {
        id: 2089,
        label: 'A1 — Chênh lệch KL',
        testId: 'TC-NC-E76 / A1',
        expected: marker,
        actual: marker,
        passed: true,
      },
    ]);
    const service = new RunsService(makePrismaMock({ run, artifact: null }));

    const detail = await service.getRun('run-1');

    expect(detail.checks?.[0]).toMatchObject({
      test_id: 'TC-NC-E76 / A1',
      status: 'not_evaluated',
      // `passed` stays as the harness recorded it — clients must branch on `status`.
      passed: true,
    });
  });

  it('flags the variant where only one side carries the marker', async () => {
    const run = runWithChecks([
      {
        id: 1,
        label: 'A4',
        testId: 'TC-NC-E76 / A4',
        expected: 'NOT_EVALUATED',
        actual: 'NOT_EVALUATED — no comparison set',
        passed: false,
      },
    ]);
    const service = new RunsService(makePrismaMock({ run, artifact: null }));

    const detail = await service.getRun('run-1');

    expect(detail.checks?.[0]?.status).toBe('not_evaluated');
  });

  it('leaves genuine passes and failures alone', async () => {
    const run = runWithChecks([
      {
        id: 1,
        label: 'create',
        testId: null,
        expected: true,
        actual: true,
        passed: true,
      },
      {
        id: 2,
        label: 'approve',
        testId: null,
        expected: 'expected-thing',
        actual: 'actual-thing',
        passed: false,
      },
      // A value that merely mentions the token mid-string is a real comparison, not a marker.
      {
        id: 3,
        label: 'mentions the token',
        testId: null,
        expected: 'left NOT_EVALUATED behind',
        actual: 'left NOT_EVALUATED behind',
        passed: true,
      },
    ]);
    const service = new RunsService(makePrismaMock({ run, artifact: null }));

    const detail = await service.getRun('run-1');

    expect(detail.checks?.map((c) => c.status)).toEqual([
      'passed',
      'failed',
      'passed',
    ]);
  });
});

describe('RunsService.getRun redmine_links', () => {
  const baseRun = {
    id: 'run-1',
    testCaseId: 'tc-1',
    scenarioKey: 'scenario',
    environment: 'staging',
    dryRun: false,
    result: 'failed',
    startedAt: new Date('2025-01-01T00:00:00.000Z'),
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    checks: [],
    steps: [],
    evidence: [],
    relatedEntities: [],
    artifacts: [],
  };

  function bugLink(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      createdFromRunId: 'run-1',
      redmineIssueId: 100,
      redmineUrl: 'https://redmine.example.com/issues/100',
      redmineProject: 'shop',
      linkType: 'created_from_run',
      createdAt: new Date('2025-01-02T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('merges links filed from this run with those on its defect signatures', async () => {
    const service = new RunsService(
      makePrismaMock({
        run: {
          ...baseRun,
          bugLinksCreatedFromThisRun: [bugLink()],
          defectObservations: [
            {
              defectSignature: {
                id: 7,
                title: 'd',
                severity: 'High',
                bugLinks: [
                  bugLink({
                    id: 2,
                    redmineIssueId: 200,
                    createdFromRunId: 'run-other',
                    createdAt: new Date('2025-01-03T00:00:00.000Z'),
                  }),
                ],
              },
            },
          ],
        },
      }),
    );

    const detail = await service.getRun('run-1');

    // Newest first; the ticket another run filed is still worth showing, since a shared
    // defect signature means this failure was already reported.
    expect(detail.redmine_links).toEqual([
      expect.objectContaining({
        redmine_issue_id: 200,
        created_from_this_run: false,
      }),
      expect.objectContaining({
        redmine_issue_id: 100,
        created_from_this_run: true,
        redmine_url: 'https://redmine.example.com/issues/100',
        link_type: 'created_from_run',
      }),
    ]);
  });

  it('deduplicates a link reachable down both paths, keeping created_from_this_run', async () => {
    const shared = bugLink();
    const service = new RunsService(
      makePrismaMock({
        run: {
          ...baseRun,
          bugLinksCreatedFromThisRun: [shared],
          defectObservations: [
            {
              defectSignature: {
                id: 7,
                title: 'd',
                severity: 'High',
                bugLinks: [shared],
              },
            },
          ],
        },
      }),
    );

    const detail = await service.getRun('run-1');

    expect(detail.redmine_links).toHaveLength(1);
    expect(detail.redmine_links?.[0].created_from_this_run).toBe(true);
  });

  it('returns an empty list when the run has no linked tickets', async () => {
    const service = new RunsService(
      makePrismaMock({
        run: {
          ...baseRun,
          bugLinksCreatedFromThisRun: [],
          defectObservations: [],
        },
      }),
    );

    await expect(service.getRun('run-1')).resolves.toMatchObject({
      redmine_links: [],
    });
  });
});
