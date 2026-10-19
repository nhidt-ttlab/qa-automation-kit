import {
  initialDefectFields,
  runnerOwnedDefectFields,
  type SqliteDefectSignatureRow,
} from './defect-sync.util';

/**
 * The regression this guards against is silent and slow: `db:sync` used to import the whole
 * SQLite record into both `create` and `update`, so a defect a human had marked `resolved` was
 * quietly reset to `draft` on the next sync — the triage disappeared with no error and no log
 * line. These tests exist to make that behaviour impossible to reintroduce by "tidying up" the
 * two objects back into one.
 */

function makeRow(
  overrides: Partial<SqliteDefectSignatureRow> = {},
): SqliteDefectSignatureRow {
  return {
    signature_hash: 'a'.repeat(64),
    scenario_key: 'po-excess-qty-double-use',
    title: 'po-excess-qty-double-use — PARTIAL',
    severity: null,
    probable_failing_rule: 'TC-KSDH-U01 / A3c',
    suspected_component: null,
    regression_note: 'Chặn ở tầng harness.',
    // The runner has no concept of triage: every signature it writes is 'draft', for ever.
    status: 'draft',
    first_observed_run_id: 'run-first',
    last_observed_run_id: 'run-last',
    ...overrides,
  };
}

describe('runnerOwnedDefectFields', () => {
  it('carries only the diagnostics the runner recomputes', () => {
    expect(Object.keys(runnerOwnedDefectFields(makeRow())).sort()).toEqual([
      'probableFailingRule',
      'regressionNote',
      'severity',
      'suspectedComponent',
      'title',
    ]);
  });

  it('never includes status — a resolved defect must survive every future sync', () => {
    const update = runnerOwnedDefectFields(makeRow({ status: 'draft' }));
    expect(update).not.toHaveProperty('status');
  });

  it('never includes the observed-run pointers, which the database trigger maintains', () => {
    // trg_defect_observations_touch_signature derives them from this database's own observations
    // by started_at chronology. Re-copying them would overwrite that with a stale answer whenever
    // the runner has purged a run Postgres still holds — and `--clean` does purge runs.
    const update = runnerOwnedDefectFields(makeRow());
    expect(update).not.toHaveProperty('firstObservedRunId');
    expect(update).not.toHaveProperty('lastObservedRunId');
  });

  it('does refresh the diagnostics, which are genuinely runner-owned', () => {
    const update = runnerOwnedDefectFields(
      makeRow({ probable_failing_rule: 'TC-KSDH-U02 / A1', severity: 'High' }),
    );
    expect(update.probableFailingRule).toBe('TC-KSDH-U02 / A1');
    expect(update.severity).toBe('High');
  });
});

describe('initialDefectFields', () => {
  it('seeds identity, status and the observed-run pointers on a brand new row', () => {
    const create = initialDefectFields(makeRow({ status: 'submitted' }));
    expect(create.signatureHash).toBe('a'.repeat(64));
    expect(create.scenarioKey).toBe('po-excess-qty-double-use');
    expect(create.status).toBe('submitted');
    expect(create.firstObservedRunId).toBe('run-first');
    expect(create.lastObservedRunId).toBe('run-last');
    expect(create.title).toBe('po-excess-qty-double-use — PARTIAL');
  });

  it('is a strict superset of the update payload', () => {
    const row = makeRow();
    for (const [key, value] of Object.entries(runnerOwnedDefectFields(row))) {
      expect(initialDefectFields(row)).toHaveProperty(key, value);
    }
  });
});

describe('the ownership boundary as the sync applies it', () => {
  /** Stands in for one `defectSignature.upsert` against a row that already exists. */
  function applyUpsert(
    existing: Record<string, unknown>,
    row: SqliteDefectSignatureRow,
  ): Record<string, unknown> {
    return { ...existing, ...runnerOwnedDefectFields(row) };
  }

  it('leaves a resolved defect resolved after re-importing the same draft record', () => {
    const existing = {
      signatureHash: 'a'.repeat(64),
      status: 'resolved',
      title: 'old title',
      severity: 'Medium',
    };

    const after = applyUpsert(
      existing,
      makeRow({ title: 'new title', status: 'draft' }),
    );

    expect(after.status).toBe('resolved');
    expect(after.title).toBe('new title');
  });

  it('survives repeated syncs', () => {
    let state: Record<string, unknown> = { status: 'submitted', title: 't0' };
    for (let i = 0; i < 5; i += 1) {
      state = applyUpsert(state, makeRow({ status: 'draft' }));
    }
    expect(state.status).toBe('submitted');
  });
});
