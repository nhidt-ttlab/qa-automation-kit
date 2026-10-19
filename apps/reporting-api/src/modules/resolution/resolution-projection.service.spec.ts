import { RESOLUTION_WORKFLOW_STATUS } from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import { ResolutionProjectionService } from './resolution-projection.service';
import { ResolutionWorkflowService } from './resolution-workflow.service';

/**
 * The projection is where idempotency lives, so these tests use a small in-memory stand-in for
 * the Prisma delegates rather than per-call `jest.fn()` stubs: "running it twice changes nothing"
 * is only a meaningful claim if the second run actually sees what the first one wrote.
 *
 * The fake enforces the two real constraints — unique `import_key`, unique
 * `(issue, run, observation_key)` — because those are what the production code relies on.
 */

interface SeedCheck {
  sequence: number;
  testId: string | null;
  label: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

interface SeedRun {
  id: string;
  testCaseId: string;
  scenarioKey: string;
  result: string;
  module: string | null;
  domain: string | null;
  startedAt: Date;
  blockedReason?: string | null;
  errorSummary?: string | null;
  defectStatement?: string | null;
  reportModel?: unknown;
  checks: SeedCheck[];
}

interface FakeIssue {
  id: number;
  importKey: string;
  displayKey: string;
  kind: string;
  workflowStatus: string;
  title: string;
  sourceSummary: string | null;
  userSummary: string | null;
  owner: string | null;
  priority: string | null;
  decision: string | null;
  resolution: string | null;
  resolutionType: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  verificationNote: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  verificationRunId: string | null;
  module: string | null;
  domain: string | null;
  observationCount: number;
  affectedTestCaseCount: number;
  recurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

interface FakeObservation {
  id: number;
  resolutionIssueId: number;
  runId: string;
  testCaseId: string;
  scenarioKey: string;
  checkSequence: number | null;
  checkTestId: string | null;
  checkLabel: string | null;
  observationKey: string;
  observedResult: string;
  rawReason: string;
  observedAt: Date;
}

function inFilter(value: unknown, clause: unknown): boolean {
  if (clause === undefined) return true;
  if (
    clause &&
    typeof clause === 'object' &&
    'in' in (clause as Record<string, unknown>)
  ) {
    return (clause as { in: unknown[] }).in.includes(value);
  }
  return value === clause;
}

function makeFakeDb(runs: SeedRun[]) {
  const state = {
    issues: [] as FakeIssue[],
    observations: [] as FakeObservation[],
    events: [] as Array<Record<string, unknown>>,
    nextIssueId: 1,
    nextObservationId: 1,
    /** Anything that would mutate imported evidence. Must stay empty. */
    forbiddenWrites: [] as string[],
  };

  const forbid = (name: string) =>
    jest.fn(() => {
      state.forbiddenWrites.push(name);
      throw new Error(
        `${name} must never be called: imported evidence is immutable`,
      );
    });

  const db = {
    testRun: {
      findMany: jest.fn(async (args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        return runs
          .filter(
            (r) => inFilter(r.result, where.result) && inFilter(r.id, where.id),
          )
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
          .map((r) => ({ ...r, checks: [...r.checks] }));
      }),
      findUnique: jest.fn(
        async (args: { where: { id: string } }) =>
          runs.find((r) => r.id === args.where.id) ?? null,
      ),
      update: forbid('testRun.update'),
      updateMany: forbid('testRun.updateMany'),
      delete: forbid('testRun.delete'),
    },
    testRunCheck: {
      update: forbid('testRunCheck.update'),
      updateMany: forbid('testRunCheck.updateMany'),
      delete: forbid('testRunCheck.delete'),
      deleteMany: forbid('testRunCheck.deleteMany'),
    },
    resolutionIssue: {
      findMany: jest.fn(async (args: { where?: Record<string, unknown> }) =>
        state.issues
          .filter((i) => inFilter(i.importKey, args.where?.importKey))
          .map((i) => ({ ...i })),
      ),
      findUnique: jest.fn(
        async (args: { where: { id?: number; importKey?: string } }) => {
          const found = state.issues.find(
            (i) =>
              (args.where.id !== undefined && i.id === args.where.id) ||
              (args.where.importKey !== undefined &&
                i.importKey === args.where.importKey),
          );
          return found ? { ...found } : null;
        },
      ),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const data = args.data;
        if (state.issues.some((i) => i.importKey === data.importKey)) {
          throw new Error(
            `unique constraint: import_key ${String(data.importKey)}`,
          );
        }
        const issue: FakeIssue = {
          id: state.nextIssueId++,
          importKey: String(data.importKey),
          displayKey: String(data.displayKey),
          kind: String(data.kind ?? 'UNCLASSIFIED'),
          workflowStatus: String(data.workflowStatus ?? 'OPEN'),
          title: String(data.title),
          sourceSummary: (data.sourceSummary as string) ?? null,
          userSummary: null,
          owner: null,
          priority: null,
          decision: null,
          resolution: null,
          resolutionType: null,
          resolvedBy: null,
          resolvedAt: null,
          verificationNote: null,
          verifiedBy: null,
          verifiedAt: null,
          verificationRunId: null,
          module: (data.module as string) ?? null,
          domain: (data.domain as string) ?? null,
          observationCount: 0,
          affectedTestCaseCount: 0,
          recurrenceCount: 0,
          firstSeenAt: data.firstSeenAt as Date,
          lastSeenAt: data.lastSeenAt as Date,
        };
        state.issues.push(issue);
        return { ...issue };
      }),
      update: jest.fn(
        async (args: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const issue = state.issues.find((i) => i.id === args.where.id);
          if (!issue) throw new Error(`no issue ${args.where.id}`);
          Object.assign(issue, args.data);
          return { ...issue };
        },
      ),
    },
    resolutionObservation: {
      findMany: jest.fn(async (args: { where?: Record<string, unknown> }) =>
        state.observations
          .filter(
            (o) =>
              inFilter(o.runId, args.where?.runId) &&
              inFilter(o.resolutionIssueId, args.where?.resolutionIssueId),
          )
          .map((o) => ({ ...o })),
      ),
      createMany: jest.fn(
        async (args: {
          data: Array<Record<string, unknown>>;
          skipDuplicates?: boolean;
        }) => {
          let count = 0;
          for (const row of args.data) {
            const dup = state.observations.some(
              (o) =>
                o.resolutionIssueId === row.resolutionIssueId &&
                o.runId === row.runId &&
                o.observationKey === row.observationKey,
            );
            if (dup) {
              if (args.skipDuplicates) continue;
              throw new Error(
                'unique constraint: (issue, run, observation_key)',
              );
            }
            state.observations.push({
              id: state.nextObservationId++,
              ...(row as unknown as Omit<FakeObservation, 'id'>),
            });
            count += 1;
          }
          return { count };
        },
      ),
      groupBy: jest.fn(
        async (args: { by: string[]; where?: Record<string, unknown> }) => {
          const rows = state.observations.filter((o) =>
            inFilter(o.resolutionIssueId, args.where?.resolutionIssueId),
          );
          const buckets = new Map<string, FakeObservation[]>();
          for (const row of rows) {
            const key = args.by
              .map((field) =>
                String((row as unknown as Record<string, unknown>)[field]),
              )
              .join('|');
            const list = buckets.get(key) ?? [];
            list.push(row);
            buckets.set(key, list);
          }
          return [...buckets.values()].map((list) => {
            const first = list[0];
            const out: Record<string, unknown> = {};
            for (const field of args.by) {
              out[field] = (first as unknown as Record<string, unknown>)[field];
            }
            out._count = { _all: list.length };
            out._min = {
              observedAt: new Date(
                Math.min(...list.map((o) => o.observedAt.getTime())),
              ),
            };
            out._max = {
              observedAt: new Date(
                Math.max(...list.map((o) => o.observedAt.getTime())),
              ),
            };
            return out;
          });
        },
      ),
    },
    resolutionEvent: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        state.events.push({ ...args.data });
        return { id: state.events.length, ...args.data };
      }),
      findMany: jest.fn(async () => state.events.map((e) => ({ ...e }))),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(db),
    ),
  };

  return { db, state };
}

function makeService(runs: SeedRun[]) {
  const { db, state } = makeFakeDb(runs);
  const prisma = db as unknown as PrismaService;
  const workflow = new ResolutionWorkflowService(prisma);
  const service = new ResolutionProjectionService(prisma, workflow);
  return { service, workflow, prisma, state, db };
}

const BL03 =
  'NOT_EVALUATED — `BL-03` — mâu thuẫn công thức `Mất cost`, BA chưa chọn cách hoà.';

function makeRun(overrides: Partial<SeedRun> = {}): SeedRun {
  return {
    id: 'run-a',
    testCaseId: 'TC-KSDH-A05',
    scenarioKey: 'xpkg-excess-total',
    result: 'PARTIAL',
    module: 'excess-order',
    domain: 'kiem-soat-dat-hang-thua',
    startedAt: new Date('2026-09-01T00:00:00Z'),
    blockedReason: null,
    errorSummary: null,
    defectStatement: null,
    reportModel: null,
    checks: [
      {
        sequence: 1,
        testId: 'TC-KSDH-A05 / A1',
        label: 'A1 — tổng gói',
        expected: BL03,
        actual: BL03,
        passed: true,
      },
    ],
    ...overrides,
  };
}

describe('ResolutionProjectionService — dry run', () => {
  it('writes nothing at all', async () => {
    const { service, state, db } = makeService([makeRun()]);

    const report = await service.projectRuns({ dryRun: true });

    expect(report.projectedNewIssues).toBe(1);
    expect(report.projectedObservations).toBe(1);
    expect(state.issues).toHaveLength(0);
    expect(state.observations).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('counts an issue spanning several batches once', async () => {
    const runs = [
      makeRun({ id: 'run-a', startedAt: new Date('2026-09-01T00:00:00Z') }),
      makeRun({ id: 'run-b', startedAt: new Date('2026-09-02T00:00:00Z') }),
      makeRun({ id: 'run-c', startedAt: new Date('2026-09-03T00:00:00Z') }),
    ];
    const { service } = makeService(runs);

    const report = await service.projectRuns({ dryRun: true, batchSize: 1 });

    expect(report.candidateRuns).toBe(3);
    expect(report.projectedNewIssues).toBe(1);
    expect(report.projectedObservations).toBe(3);
  });
});

describe('ResolutionProjectionService — projection and idempotency', () => {
  it('creates one issue with a CREATED audit event and its observations', async () => {
    const { service, state } = makeService([makeRun()]);

    await service.projectRuns();

    expect(state.issues).toHaveLength(1);
    expect(state.issues[0].importKey).toBe('kiem-soat-dat-hang-thua:BL-03');
    expect(state.issues[0].kind).toBe('UNCLASSIFIED');
    expect(state.issues[0].workflowStatus).toBe('OPEN');
    expect(state.issues[0].observationCount).toBe(1);
    expect(state.issues[0].affectedTestCaseCount).toBe(1);
    expect(state.events.map((e) => e.action)).toEqual(['CREATED']);
    expect(state.events[0].actor).toBe('system:sync');
  });

  it('creates no duplicates when run again over the same evidence', async () => {
    const runs = [
      makeRun({ id: 'run-a' }),
      makeRun({ id: 'run-b', startedAt: new Date('2026-09-02T00:00:00Z') }),
    ];
    const { service, state } = makeService(runs);

    const first = await service.projectRuns();
    const second = await service.projectRuns();

    expect(state.issues).toHaveLength(1);
    expect(state.observations).toHaveLength(2);
    expect(first.projectedObservations).toBe(2);
    expect(second.projectedObservations).toBe(0);
    expect(second.duplicateObservationsSkipped).toBe(2);
    expect(second.projectedNewIssues).toBe(0);
    expect(state.events.filter((e) => e.action === 'CREATED')).toHaveLength(1);
  });

  it('scans nothing when sync reports no newly imported runs', async () => {
    const { service, state } = makeService([makeRun()]);

    const report = await service.projectRuns({ runIds: [] });

    expect(report.candidateRuns).toBe(0);
    expect(state.issues).toHaveLength(0);
  });

  it('never touches imported runs or checks', async () => {
    const { service, state } = makeService([makeRun()]);

    await service.projectRuns();

    expect(state.forbiddenWrites).toEqual([]);
  });
});

describe('ResolutionProjectionService — field ownership', () => {
  it('leaves user-entered workflow data untouched when new evidence arrives', async () => {
    const runs = [makeRun({ id: 'run-a' })];
    const { service, state } = makeService(runs);
    await service.projectRuns();

    // A human triages it.
    Object.assign(state.issues[0], {
      kind: 'SPEC_DECISION',
      workflowStatus: 'DECIDED',
      owner: 'qa_user',
      priority: 'High',
      userSummary: 'BA chốt: Mất cost bị TRỪ.',
      decision: 'Mất cost bị TRỪ khỏi Tổng KL.',
    });
    const seenBefore = state.issues[0].lastSeenAt;

    runs.push(
      makeRun({ id: 'run-b', startedAt: new Date('2026-09-05T00:00:00Z') }),
    );
    await service.projectRuns();

    const issue = state.issues[0];
    expect(issue.kind).toBe('SPEC_DECISION');
    expect(issue.workflowStatus).toBe('DECIDED');
    expect(issue.owner).toBe('qa_user');
    expect(issue.priority).toBe('High');
    expect(issue.userSummary).toBe('BA chốt: Mất cost bị TRỪ.');
    expect(issue.decision).toBe('Mất cost bị TRỪ khỏi Tổng KL.');
    // ... while the sync-owned occurrence statistics did move.
    expect(issue.lastSeenAt.getTime()).toBeGreaterThan(seenBefore.getTime());
    expect(issue.observationCount).toBe(2);
  });

  it('keeps firstSeenAt at the earliest evidence even when older runs arrive later', async () => {
    const runs = [
      makeRun({ id: 'run-b', startedAt: new Date('2026-09-05T00:00:00Z') }),
    ];
    const { service, state } = makeService(runs);
    await service.projectRuns();
    expect(state.issues[0].firstSeenAt).toEqual(
      new Date('2026-09-05T00:00:00Z'),
    );

    runs.push(
      makeRun({ id: 'run-a', startedAt: new Date('2026-09-01T00:00:00Z') }),
    );
    await service.projectRuns();

    expect(state.issues[0].firstSeenAt).toEqual(
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(state.issues[0].lastSeenAt).toEqual(
      new Date('2026-09-05T00:00:00Z'),
    );
  });
});

describe('ResolutionProjectionService — recurrence', () => {
  async function verifiedIssueWithNewEvidence() {
    const runs = [
      makeRun({ id: 'run-a', startedAt: new Date('2026-09-01T00:00:00Z') }),
    ];
    const ctx = makeService(runs);
    await ctx.service.projectRuns();

    Object.assign(ctx.state.issues[0], {
      workflowStatus: RESOLUTION_WORKFLOW_STATUS.VERIFIED,
      resolution: 'BA đã chốt công thức.',
      resolutionType: 'SPEC_CLARIFIED',
      resolvedBy: 'qa_user',
      resolvedAt: new Date('2026-09-02T00:00:00Z'),
      verificationNote: 'Rerun sạch.',
      verifiedBy: 'qa',
      verifiedAt: new Date('2026-09-03T00:00:00Z'),
      verificationRunId: 'run-verify',
    });

    runs.push(
      makeRun({ id: 'run-c', startedAt: new Date('2026-09-10T00:00:00Z') }),
    );
    const report = await ctx.service.projectRuns();
    return { ...ctx, report };
  }

  it('moves a VERIFIED issue to RECURRED and audits it', async () => {
    const { state, report } = await verifiedIssueWithNewEvidence();

    expect(state.issues[0].workflowStatus).toBe('RECURRED');
    expect(state.issues[0].recurrenceCount).toBe(1);
    expect(report.recurrences).toBe(1);

    const recurred = state.events.find((e) => e.action === 'RECURRED');
    expect(recurred).toBeDefined();
    expect(recurred?.previousStatus).toBe('VERIFIED');
    expect(recurred?.newStatus).toBe('RECURRED');
    expect(recurred?.actor).toBe('system:sync');
    expect((recurred?.metadata as Record<string, unknown>).run_id).toBe(
      'run-c',
    );
  });

  it('preserves the decision, resolution and verification history', async () => {
    const { state } = await verifiedIssueWithNewEvidence();
    const issue = state.issues[0];

    expect(issue.resolution).toBe('BA đã chốt công thức.');
    expect(issue.resolutionType).toBe('SPEC_CLARIFIED');
    expect(issue.verificationNote).toBe('Rerun sạch.');
    expect(issue.verifiedBy).toBe('qa');
    expect(issue.verificationRunId).toBe('run-verify');
    // The old observation is still there next to the new one.
    expect(state.observations.map((o) => o.runId).sort()).toEqual([
      'run-a',
      'run-c',
    ]);
  });

  it('does not recur on a replay of evidence that predates the verification', async () => {
    const runs = [
      makeRun({ id: 'run-a', startedAt: new Date('2026-09-01T00:00:00Z') }),
    ];
    const { service, state } = makeService(runs);
    await service.projectRuns();
    Object.assign(state.issues[0], {
      workflowStatus: RESOLUTION_WORKFLOW_STATUS.VERIFIED,
      verifiedAt: new Date('2026-09-03T00:00:00Z'),
      verifiedBy: 'qa',
    });

    const report = await service.projectRuns();

    expect(report.recurrences).toBe(0);
    expect(state.issues[0].workflowStatus).toBe('VERIFIED');
  });
});

describe('ResolutionProjectionService — Redmine', () => {
  it('creates no Redmine link for an imported blocker', async () => {
    const { service, prisma } = makeService([makeRun()]);

    await service.projectRuns();

    // The projection has no Redmine dependency and no redmineLink delegate to call: an
    // unresolved blocker is not a confirmed defect, so nothing may be filed automatically.
    expect(
      (prisma as unknown as Record<string, unknown>).resolutionRedmineLink,
    ).toBeUndefined();
    expect(ResolutionProjectionService.prototype.constructor.length).toBe(2);
  });
});
