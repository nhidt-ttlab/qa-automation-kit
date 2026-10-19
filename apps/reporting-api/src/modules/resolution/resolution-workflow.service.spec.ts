import { NotFoundError, ValidationError } from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import {
  assertTransitionAllowed,
  ResolutionWorkflowService,
} from './resolution-workflow.service';

/**
 * The workflow service is the only place an issue changes state, so these tests are the contract
 * for "what a human is allowed to do next" — including the two rules that are easy to erode:
 * recording a resolution is a claim (READY_FOR_RERUN), not a verification, and verification needs
 * evidence from a *later* execution or an explicitly audited override.
 */

interface FakeIssueState {
  id: number;
  workflowStatus: string;
  kind: string;
  owner: string | null;
  priority: string | null;
  resolvedAt: Date | null;
  verifiedAt: Date | null;
  recurrenceCount: number;
  [key: string]: unknown;
}

function makeService(overrides: Partial<FakeIssueState> = {}) {
  const issue: FakeIssueState = {
    id: 1,
    workflowStatus: 'OPEN',
    kind: 'UNCLASSIFIED',
    owner: null,
    priority: null,
    resolvedAt: null,
    verifiedAt: null,
    recurrenceCount: 0,
    ...overrides,
  };
  const events: Array<Record<string, unknown>> = [];

  const prisma = {
    resolutionIssue: {
      findUnique: jest.fn(async (args: { where: { id: number } }) =>
        args.where.id === issue.id ? { ...issue } : null,
      ),
      update: jest.fn(
        async (args: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          Object.assign(issue, args.data);
          return { ...issue };
        },
      ),
    },
    resolutionEvent: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        events.push(args.data);
        return { id: events.length, ...args.data };
      }),
    },
  } as unknown as PrismaService;

  return {
    service: new ResolutionWorkflowService(prisma),
    issue,
    events,
    prisma,
  };
}

const RUN = {
  id: 'run-verify',
  startedAt: new Date('2026-09-10T00:00:00Z'),
  scenarioKey: 'xpkg-excess-total',
};

function verifyDeps(
  overrides: Partial<{ run: typeof RUN | null; scenarioKeys: string[] }> = {},
) {
  const run = overrides.run === undefined ? RUN : overrides.run;
  return {
    findRun: jest.fn(async () => run),
    affectedScenarioKeys: jest.fn(
      async () => overrides.scenarioKeys ?? ['xpkg-excess-total'],
    ),
  };
}

describe('assertTransitionAllowed', () => {
  it('accepts the documented transitions', () => {
    const allowed: Array<[string, string]> = [
      ['OPEN', 'WAITING_FOR_DECISION'],
      ['OPEN', 'DECIDED'],
      ['WAITING_FOR_DECISION', 'DECIDED'],
      ['DECIDED', 'READY_FOR_RERUN'],
      ['READY_FOR_RERUN', 'VERIFIED'],
      ['VERIFIED', 'RECURRED'],
      ['RECURRED', 'READY_FOR_RERUN'],
      ['OPEN', 'WONT_RESOLVE'],
      ['DECIDED', 'WONT_RESOLVE'],
      ['VERIFIED', 'OPEN'],
      ['WONT_RESOLVE', 'OPEN'],
    ];
    for (const [from, to] of allowed) {
      expect(() => assertTransitionAllowed(from, to as never)).not.toThrow();
    }
  });

  it('rejects shortcuts that would skip the evidence', () => {
    const rejected: Array<[string, string]> = [
      ['OPEN', 'VERIFIED'],
      ['OPEN', 'READY_FOR_RERUN'],
      ['DECIDED', 'VERIFIED'],
      ['WONT_RESOLVE', 'VERIFIED'],
      ['VERIFIED', 'READY_FOR_RERUN'],
    ];
    for (const [from, to] of rejected) {
      expect(() => assertTransitionAllowed(from, to as never)).toThrow(
        ValidationError,
      );
    }
  });

  it('rejects a self-transition, which is nearly always a double submit', () => {
    expect(() => assertTransitionAllowed('OPEN', 'OPEN')).toThrow(
      ValidationError,
    );
  });
});

describe('recordDecision', () => {
  it('moves OPEN to DECIDED and writes an audit event', async () => {
    const { service, issue, events } = makeService();

    await service.recordDecision(1, {
      actor: 'ba_linh',
      decision: 'Mất cost bị TRỪ.',
    });

    expect(issue.workflowStatus).toBe('DECIDED');
    expect(issue.decision).toBe('Mất cost bị TRỪ.');
    expect(issue.decisionBy).toBe('ba_linh');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'DECISION_RECORDED',
      previousStatus: 'OPEN',
      newStatus: 'DECIDED',
      actor: 'ba_linh',
    });
  });

  it('also accepts WAITING_FOR_DECISION as the starting point', async () => {
    const { service, issue } = makeService({
      workflowStatus: 'WAITING_FOR_DECISION',
    });
    await service.recordDecision(1, { actor: 'ba_linh', decision: 'Chốt.' });
    expect(issue.workflowStatus).toBe('DECIDED');
  });

  it('requires an actor and a non-empty decision', async () => {
    const { service } = makeService();
    await expect(
      service.recordDecision(1, { actor: '', decision: 'x' }),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.recordDecision(1, { actor: 'qa', decision: '   ' }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a decision on a verified issue', async () => {
    const { service } = makeService({ workflowStatus: 'VERIFIED' });
    await expect(
      service.recordDecision(1, { actor: 'qa', decision: 'again?' }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('recordResolution', () => {
  it('stops at READY_FOR_RERUN — never VERIFIED', async () => {
    const { service, issue, events } = makeService({
      workflowStatus: 'DECIDED',
    });

    await service.recordResolution(1, {
      actor: 'dev_hai',
      resolution: 'Sửa công thức trong report service.',
      resolution_type: 'PRODUCT_FIXED',
    });

    expect(issue.workflowStatus).toBe('READY_FOR_RERUN');
    expect(issue.resolutionType).toBe('PRODUCT_FIXED');
    expect(issue.resolvedBy).toBe('dev_hai');
    expect(issue.resolvedAt).toBeInstanceOf(Date);
    expect(issue.verifiedAt).toBeNull();
    expect(events[0]).toMatchObject({
      action: 'RESOLUTION_RECORDED',
      newStatus: 'READY_FOR_RERUN',
    });
  });

  it('requires a resolution type from the closed vocabulary', async () => {
    const { service } = makeService({ workflowStatus: 'DECIDED' });
    await expect(
      service.recordResolution(1, {
        actor: 'qa',
        resolution: 'done',
        resolution_type: 'FIXED_IT',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot be recorded before a decision exists', async () => {
    const { service } = makeService({ workflowStatus: 'OPEN' });
    await expect(
      service.recordResolution(1, {
        actor: 'qa',
        resolution: 'done',
        resolution_type: 'DATA_PREPARED',
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('verify', () => {
  const resolved = {
    workflowStatus: 'READY_FOR_RERUN',
    resolvedAt: new Date('2026-09-05T00:00:00Z'),
  };

  it('accepts a rerun that started after the resolution and exercises an affected scenario', async () => {
    const { service, issue, events } = makeService(resolved);

    await service.verify(
      1,
      {
        actor: 'qa',
        verification_note: 'Rerun sạch.',
        verification_run_id: 'run-verify',
      },
      verifyDeps(),
    );

    expect(issue.workflowStatus).toBe('VERIFIED');
    expect(issue.verificationRunId).toBe('run-verify');
    expect(issue.verifiedBy).toBe('qa');
    expect(events[0]).toMatchObject({
      action: 'VERIFIED',
      newStatus: 'VERIFIED',
    });
  });

  it('refuses a rerun that predates the resolution', async () => {
    const { service, issue } = makeService(resolved);

    await expect(
      service.verify(
        1,
        {
          actor: 'qa',
          verification_note: 'ok',
          verification_run_id: 'run-old',
        },
        verifyDeps({
          run: { ...RUN, startedAt: new Date('2026-09-01T00:00:00Z') },
        }),
      ),
    ).rejects.toThrow(/started before the resolution/);
    expect(issue.workflowStatus).toBe('READY_FOR_RERUN');
  });

  it('refuses a rerun of an unrelated scenario', async () => {
    const { service } = makeService(resolved);

    await expect(
      service.verify(
        1,
        {
          actor: 'qa',
          verification_note: 'ok',
          verification_run_id: 'run-verify',
        },
        verifyDeps({ scenarioKeys: ['some-other-scenario'] }),
      ),
    ).rejects.toThrow(/does not exercise any scenario/);
  });

  it('refuses a missing rerun', async () => {
    const { service } = makeService(resolved);
    await expect(
      service.verify(
        1,
        { actor: 'qa', verification_note: 'ok', verification_run_id: 'nope' },
        verifyDeps({ run: null }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('refuses to verify on nothing at all', async () => {
    const { service } = makeService(resolved);
    await expect(
      service.verify(
        1,
        { actor: 'qa', verification_note: 'trust me' },
        verifyDeps(),
      ),
    ).rejects.toThrow(/requires verification_run_id/);
  });

  it('allows a manual override, but demands a reason and audits it separately', async () => {
    const { service, issue, events } = makeService(resolved);

    await expect(
      service.verify(
        1,
        { actor: 'qa', verification_note: 'ok', override: true },
        verifyDeps(),
      ),
    ).rejects.toThrow(ValidationError);

    await service.verify(
      1,
      {
        actor: 'qa',
        verification_note: 'Xác nhận thủ công trên môi trường QA.',
        override: true,
        override_reason: 'Scenario đã bị gỡ khỏi suite, không còn rerun được.',
      },
      verifyDeps(),
    );

    expect(issue.workflowStatus).toBe('VERIFIED');
    expect(issue.verificationRunId).toBeNull();
    // A different action, so an override is never mistaken for evidence-backed verification.
    expect(events.at(-1)).toMatchObject({ action: 'VERIFIED_WITHOUT_RUN' });
  });

  it('can verify a RECURRED issue on fresh evidence', async () => {
    const { service, issue } = makeService({
      workflowStatus: 'RECURRED',
      resolvedAt: new Date('2026-09-05T00:00:00Z'),
    });

    await service.verify(
      1,
      {
        actor: 'qa',
        verification_note: 'Lần này sạch.',
        verification_run_id: 'run-verify',
      },
      verifyDeps(),
    );

    expect(issue.workflowStatus).toBe('VERIFIED');
  });
});

describe('reopen', () => {
  it('requires a reason and preserves the prior resolution and verification', async () => {
    const { service, issue, events } = makeService({
      workflowStatus: 'VERIFIED',
      resolution: 'Đã sửa.',
      resolutionType: 'PRODUCT_FIXED',
      verificationNote: 'Rerun sạch.',
      verifiedBy: 'qa',
      verifiedAt: new Date('2026-09-08T00:00:00Z'),
    });

    await expect(
      service.reopen(1, { actor: 'qa', reason: 'x' }),
    ).rejects.toThrow(ValidationError);

    await service.reopen(1, {
      actor: 'qa',
      reason: 'Khách báo lỗi lại trên UAT.',
    });

    expect(issue.workflowStatus).toBe('OPEN');
    expect(issue.resolution).toBe('Đã sửa.');
    expect(issue.verificationNote).toBe('Rerun sạch.');
    expect(events.at(-1)).toMatchObject({
      action: 'REOPENED',
      previousStatus: 'VERIFIED',
      newStatus: 'OPEN',
    });
  });
});

describe('changeStatus', () => {
  it('handles the payload-free transitions', async () => {
    const { service, issue } = makeService();
    await service.changeStatus(1, {
      actor: 'qa',
      target_status: 'WAITING_FOR_DECISION',
    });
    expect(issue.workflowStatus).toBe('WAITING_FOR_DECISION');
  });

  it('refuses to reopen a final state without going through /reopen', async () => {
    const { service } = makeService({ workflowStatus: 'VERIFIED' });
    await expect(
      service.changeStatus(1, { actor: 'qa', target_status: 'OPEN' }),
    ).rejects.toThrow(/requires POST \/reopen/);
  });

  it('refuses a target outside the direct set', async () => {
    const { service } = makeService();
    await expect(
      service.changeStatus(1, { actor: 'qa', target_status: 'VERIFIED' }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('updateUserFields', () => {
  it('audits classification, assignment and priority separately', async () => {
    const { service, issue, events } = makeService();

    await service.updateUserFields(1, {
      actor: 'qa',
      kind: 'TEST_DATA',
      owner: 'qa_user',
      priority: 'High',
    });

    expect(issue.kind).toBe('TEST_DATA');
    expect(issue.owner).toBe('qa_user');
    expect(issue.priority).toBe('High');
    expect(events.map((e) => e.action)).toEqual([
      'CLASSIFIED',
      'ASSIGNED',
      'PRIORITY_CHANGED',
    ]);
    // Classification is not a state change.
    expect(issue.workflowStatus).toBe('OPEN');
    expect(events.every((e) => e.newStatus === null)).toBe(true);
  });

  it('treats null as "clear this field"', async () => {
    const { service, issue } = makeService({
      owner: 'qa_user',
      priority: 'High',
    });
    await service.updateUserFields(1, {
      actor: 'qa',
      owner: null,
      priority: null,
    });
    expect(issue.owner).toBeNull();
    expect(issue.priority).toBeNull();
  });

  it('rejects an unknown kind and an over-long summary', async () => {
    const { service } = makeService();
    await expect(
      service.updateUserFields(1, { actor: 'qa', kind: 'WHATEVER' }),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.updateUserFields(1, {
        actor: 'qa',
        user_summary: 'x'.repeat(5000),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a request that changes nothing', async () => {
    const { service } = makeService();
    await expect(service.updateUserFields(1, { actor: 'qa' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('rejects control characters smuggled into free text', async () => {
    const { service } = makeService();
    await expect(
      service.updateUserFields(1, { actor: 'qa', user_summary: 'ok‮evil' }),
    ).rejects.toThrow(/control characters/);
  });
});
