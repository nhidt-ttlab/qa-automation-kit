import { NotFoundError, ValidationError } from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import { ResolutionService } from './resolution.service';
import { ResolutionWorkflowService } from './resolution-workflow.service';

/**
 * Controller-facing behaviour: what the list filters translate into, what pagination reports, and
 * the two rules the API must not soften — a comment never changes status, and only an issue a
 * human has classified as PRODUCT_DEFECT may be linked to Redmine.
 */

function makeIssueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    importKey: 'kiem-soat-dat-hang-thua:BL-03',
    displayKey: 'kiem-soat-dat-hang-thua:BL-03',
    title: 'BL-03 — mâu thuẫn công thức Mất cost',
    kind: 'UNCLASSIFIED',
    workflowStatus: 'OPEN',
    owner: null,
    priority: null,
    module: 'excess-order',
    domain: 'kiem-soat-dat-hang-thua',
    sourceSummary: 'mâu thuẫn công thức',
    userSummary: null,
    decision: null,
    decisionBy: null,
    decisionAt: null,
    resolution: null,
    resolutionType: null,
    resolvedBy: null,
    resolvedAt: null,
    verificationNote: null,
    verifiedBy: null,
    verifiedAt: null,
    verificationRunId: null,
    defectSignatureId: null,
    affectedTestCaseCount: 3,
    observationCount: 12,
    recurrenceCount: 0,
    firstSeenAt: new Date('2026-09-01T00:00:00Z'),
    lastSeenAt: new Date('2026-09-05T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-05T00:00:00Z'),
    _count: { redmineLinks: 0 },
    observations: [],
    comments: [],
    events: [],
    redmineLinks: [],
    defectSignature: null,
    ...overrides,
  };
}

function makePrismaMock(overrides: Record<string, unknown> = {}) {
  const prisma = {
    resolutionIssue: {
      findMany: jest.fn().mockResolvedValue([makeIssueRow()]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(makeIssueRow()),
      groupBy: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(makeIssueRow()),
    },
    resolutionObservation: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    resolutionComment: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(
          async (args: { data: Record<string, unknown> }) => ({
            id: 1,
            edited: false,
            createdAt: new Date('2026-09-06T00:00:00Z'),
            updatedAt: new Date('2026-09-06T00:00:00Z'),
            ...args.data,
          }),
        ),
    },
    resolutionEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    resolutionRedmineLink: { upsert: jest.fn() },
    testRun: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    testCase: { findMany: jest.fn().mockResolvedValue([]) },
    defectSignature: { count: jest.fn().mockResolvedValue(1) },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    ),
    ...overrides,
  };
  return prisma as unknown as PrismaService;
}

function makeService(prisma = makePrismaMock()) {
  return {
    service: new ResolutionService(
      prisma,
      new ResolutionWorkflowService(prisma),
    ),
    prisma,
  };
}

const baseQuery = { page: 1, limit: 20 };

describe('listIssues — filters', () => {
  it('returns the pagination envelope every list endpoint uses', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.count as jest.Mock).mockResolvedValue(55);
    const { service } = makeService(prisma);

    const result = await service.listIssues({ page: 2, limit: 20 });

    expect(result).toMatchObject({
      total: 55,
      page: 2,
      limit: 20,
      has_more: true,
    });
    expect(result.items[0].display_key).toBe('kiem-soat-dat-hang-thua:BL-03');
    expect(
      (prisma.resolutionIssue.findMany as jest.Mock).mock.calls[0][0],
    ).toMatchObject({
      skip: 20,
      take: 20,
    });
  });

  it('reports has_more false on the last page', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.count as jest.Mock).mockResolvedValue(25);
    const { service } = makeService(prisma);

    const result = await service.listIssues({ page: 2, limit: 20 });
    expect(result.has_more).toBe(false);
  });

  it('caps limit at MAX_PAGE_SIZE so a client cannot ask for the whole table', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    await service.listIssues({ page: 1, limit: 5000 });

    expect(
      (prisma.resolutionIssue.findMany as jest.Mock).mock.calls[0][0].take,
    ).toBe(100);
  });

  it('translates the simple filters onto their columns', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    await service.listIssues({
      ...baseQuery,
      kind: 'SPEC_DECISION',
      workflow_status: 'DECIDED',
      owner: 'qa_user',
      priority: 'High',
      module: 'excess-order',
      domain: 'kiem-soat-dat-hang-thua',
    });

    expect(
      (prisma.resolutionIssue.findMany as jest.Mock).mock.calls[0][0].where,
    ).toMatchObject({
      kind: 'SPEC_DECISION',
      workflowStatus: 'DECIDED',
      owner: 'qa_user',
      priority: 'High',
      module: 'excess-order',
      domain: 'kiem-soat-dat-hang-thua',
    });
  });

  it('searches display key, title and both summaries for free text', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    await service.listIssues({ ...baseQuery, q: 'BL-03' });

    const where = (prisma.resolutionIssue.findMany as jest.Mock).mock
      .calls[0][0].where;
    expect(where.OR).toHaveLength(4);
    expect(where.OR[0]).toEqual({
      displayKey: { contains: 'BL-03', mode: 'insensitive' },
    });
  });

  it('collapses the observation-shaped filters into a single `some`', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    await service.listIssues({
      ...baseQuery,
      scenario_key: 'xpkg-excess-total',
      test_case_id: 'TC-KSDH-A05',
      observed_result: 'NOT_EVALUATED',
    });

    // Assigning `where.observations` three times would silently keep only the last filter.
    expect(
      (prisma.resolutionIssue.findMany as jest.Mock).mock.calls[0][0].where
        .observations,
    ).toEqual({
      some: {
        scenarioKey: 'xpkg-excess-total',
        testCaseId: 'TC-KSDH-A05',
        observedResult: 'NOT_EVALUATED',
      },
    });
  });

  it('turns the link filters into presence checks', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    await service.listIssues({
      ...baseQuery,
      has_defect: true,
      has_redmine: false,
    });

    expect(
      (prisma.resolutionIssue.findMany as jest.Mock).mock.calls[0][0].where,
    ).toMatchObject({
      defectSignatureId: { not: null },
      redmineLinks: { none: {} },
    });
  });

  it('rejects an unparseable date rather than silently ignoring the filter', async () => {
    const { service } = makeService();
    await expect(
      service.listIssues({ ...baseQuery, last_seen_from: 'yesterday-ish' }),
    ).rejects.toThrow(ValidationError);
  });

  it('sorts by last seen descending by default', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    await service.listIssues(baseQuery);

    expect(
      (prisma.resolutionIssue.findMany as jest.Mock).mock.calls[0][0].orderBy,
    ).toEqual({
      lastSeenAt: 'desc',
    });
  });

  it('orders priority by severity, not alphabetically', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.findMany as jest.Mock).mockResolvedValue([
      makeIssueRow({ id: 1, priority: 'Low' }),
      makeIssueRow({ id: 2, priority: 'Critical' }),
      makeIssueRow({ id: 3, priority: 'Medium' }),
    ]);
    (prisma.resolutionIssue.count as jest.Mock).mockResolvedValue(3);
    const { service } = makeService(prisma);

    const result = await service.listIssues({
      ...baseQuery,
      sort_by: 'priority',
      sort_order: 'ASC',
    });

    expect(result.items.map((i) => i.priority)).toEqual([
      'Critical',
      'Medium',
      'Low',
    ]);
  });
});

describe('exportIssuesCsv', () => {
  it('exports what the filters select, with no pagination', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    const result = await service.exportIssuesCsv({
      workflow_status: 'VERIFIED',
      page: 2,
      limit: 20,
    });

    const call = (prisma.resolutionIssue.findMany as jest.Mock).mock
      .calls[0][0];
    expect(call.where).toMatchObject({ workflowStatus: 'VERIFIED' });
    // Paging the export would silently truncate the file.
    expect(call.skip).toBeUndefined();
    expect(call.take).toBeUndefined();
    expect(result.filename).toMatch(
      /^resolution-issues-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  it('includes the observations, comments and Redmine links each row needs', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    await service.exportIssuesCsv({ page: 1, limit: 20 });

    const include = (prisma.resolutionIssue.findMany as jest.Mock).mock
      .calls[0][0].include;
    expect(Object.keys(include).sort()).toEqual([
      'comments',
      'observations',
      'redmineLinks',
    ]);
  });

  it('returns a header-only file when nothing matched', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.resolutionIssue.count as jest.Mock).mockResolvedValue(0);
    const { service } = makeService(prisma);

    const { csv } = await service.exportIssuesCsv({ page: 1, limit: 20 });

    expect(csv).toContain('display_key,test_case_id');
    expect(csv.trimEnd().split('\r\n')).toHaveLength(1);
  });

  it('refuses an export larger than the cap rather than trying to build it', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.count as jest.Mock).mockResolvedValue(50_000);
    const { service } = makeService(prisma);

    await expect(
      service.exportIssuesCsv({ page: 1, limit: 20 }),
    ).rejects.toThrow(/Narrow the filters/);
    expect(prisma.resolutionIssue.findMany).not.toHaveBeenCalled();
  });
});

describe('getIssue', () => {
  it('is a 404 for an unknown id, and for a non-numeric one', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.findUnique as jest.Mock).mockResolvedValue(null);
    const { service } = makeService(prisma);

    await expect(service.getIssue('999')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getIssue('not-a-number')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('addComment', () => {
  it('stores the comment and audits it without touching the status', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    const comment = await service.addComment('7', {
      actor: 'qa_minh',
      body: 'BA nói sẽ trả lời trong tuần này.',
    });

    expect(comment.author).toBe('qa_minh');
    expect(comment.body).toBe('BA nói sẽ trả lời trong tuần này.');
    // The only issue-table write in the whole call would be a status change — there is none.
    expect(prisma.resolutionIssue.update).not.toHaveBeenCalled();
    const event = (prisma.resolutionEvent.create as jest.Mock).mock.calls[0][0]
      .data;
    expect(event.action).toBe('COMMENT_ADDED');
    expect(event.newStatus).toBeUndefined();
  });

  it('requires an author and a non-empty body', async () => {
    const { service } = makeService();
    await expect(
      service.addComment('7', { actor: '', body: 'x' }),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.addComment('7', { actor: 'qa', body: '  ' }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a body beyond the length cap', async () => {
    const { service } = makeService();
    await expect(
      service.addComment('7', { actor: 'qa', body: 'x'.repeat(9000) }),
    ).rejects.toThrow(/at most/);
  });
});

describe('linkRedmine', () => {
  it('refuses an issue that has not been classified as a product defect', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.findUnique as jest.Mock).mockResolvedValue(
      makeIssueRow({ kind: 'SPEC_DECISION' }),
    );
    const { service } = makeService(prisma);

    await expect(
      service.linkRedmine('7', { actor: 'qa', redmine_issue_id: 4321 }),
    ).rejects.toThrow(/PRODUCT_DEFECT/);
    expect(prisma.resolutionRedmineLink.upsert).not.toHaveBeenCalled();
  });

  it('refuses an unclassified issue — the state every import starts in', async () => {
    const prisma = makePrismaMock();
    const { service } = makeService(prisma);

    await expect(
      service.linkRedmine('7', { actor: 'qa', redmine_issue_id: 4321 }),
    ).rejects.toThrow(/PRODUCT_DEFECT/);
  });

  it('links once the issue is a confirmed product defect, and audits it', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.findUnique as jest.Mock).mockResolvedValue(
      makeIssueRow({ kind: 'PRODUCT_DEFECT' }),
    );
    const { service } = makeService(prisma);

    await service.linkRedmine('7', {
      actor: 'qa',
      redmine_issue_id: 4321,
      redmine_url: 'https://redmine.example/issues/4321',
    });

    expect(
      (prisma.resolutionRedmineLink.upsert as jest.Mock).mock.calls[0][0]
        .create,
    ).toMatchObject({ redmineIssueId: 4321, createdBy: 'qa' });
    expect(
      (prisma.resolutionEvent.create as jest.Mock).mock.calls[0][0].data.action,
    ).toBe('REDMINE_LINKED');
  });

  it('rejects a non-numeric Redmine id', async () => {
    const prisma = makePrismaMock();
    (prisma.resolutionIssue.findUnique as jest.Mock).mockResolvedValue(
      makeIssueRow({ kind: 'PRODUCT_DEFECT' }),
    );
    const { service } = makeService(prisma);

    await expect(
      service.linkRedmine('7', { actor: 'qa', redmine_issue_id: 'abc' }),
    ).rejects.toThrow(ValidationError);
  });
});
