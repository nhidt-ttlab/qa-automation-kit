import {
  emptyDiagnostics,
  extractCandidates,
  findBlockerCodes,
  normalizeReason,
  type ExtractableCheck,
  type ExtractableRun,
} from './resolution-extract.util';

/**
 * Fixtures are real strings from the runner database (the runner's db/regression.db),
 * not invented ones: the grouping rules only matter to the extent they hold against the Vietnamese
 * prose, backticked code references and mixed `BL-3`/`BL-03` spellings that scenarios actually
 * write. Counts are never asserted against the live database — only shapes and relationships.
 */

const STARTED = new Date('2026-09-04T06:48:30.631Z');

function makeRun(overrides: Partial<ExtractableRun> = {}): ExtractableRun {
  return {
    id: 'run-mtmleirb-n2fcjq',
    testCaseId: 'TC-KSDH-A05',
    scenarioKey: 'xpkg-excess-total-equals-qty-times-est-price',
    result: 'PARTIAL',
    module: 'excess-order',
    domain: 'kiem-soat-dat-hang-thua',
    startedAt: STARTED,
    blockedReason: null,
    errorSummary: null,
    defectStatement: null,
    reportModel: null,
    ...overrides,
  };
}

function makeCheck(
  overrides: Partial<ExtractableCheck> = {},
): ExtractableCheck {
  return {
    sequence: 1,
    testId: 'TC-KSDH-A05 / A1',
    label: 'A1 — S4: cột Tổng của gói bằng tổng KL dư thừa',
    expected: 'NOT_EVALUATED',
    actual: 'NOT_EVALUATED',
    // The harness computes passed as `expected === actual`, so a not-evaluated check is
    // trivially true. This default is the trap the whole module exists to avoid.
    passed: true,
    ...overrides,
  };
}

/** A real BL-03 reason, abridged in the middle but keeping its shape. */
const BL03_REASON =
  'NOT_EVALUATED — `BL-03` — mâu thuẫn công thức `Mất cost`, BA chưa chọn cách hoà và ' +
  'scenario KHÔNG được tự chọn: (1) cấp trường `KSDH-35`/`KSDH-67` — `Mất cost` được CỘNG; ' +
  '(2) cấp trường `KSDH-31`/`KSDH-63` — `Mất cost` bị TRỪ.';

describe('findBlockerCodes', () => {
  it('normalizes padded and unpadded BL spellings to one canonical code', () => {
    // Real corpus: boq-gop writes BL-1..BL-8, every other domain writes BL-01..BL-23.
    for (const raw of ['BL-3', 'BL-03', 'BL 3', 'BL_3', '`BL-3`', '(BL-03)']) {
      expect(
        findBlockerCodes(`blocked by ${raw} — see step doc`)[0]?.code,
      ).toBe('BL-03');
    }
  });

  it('leaves OPEN codes unpadded, the way the source writes them', () => {
    expect(
      findBlockerCodes('ĐIỂM TREO THỨ HAI — OPEN-5: luật làm tròn chưa chốt')[0]
        .code,
    ).toBe('OPEN-5');
    expect(findBlockerCodes('OPEN-05 same thing')[0].code).toBe('OPEN-5');
  });

  it('does not match a code embedded in a longer identifier', () => {
    // `KSDH-35` and `TBL-2` are rule ids and table names, not blockers.
    expect(findBlockerCodes('cấp trường `KSDH-35` và `TBL-2`')).toEqual([]);
  });

  it('does not let BL-1 swallow the leading digit of BL-12', () => {
    expect(findBlockerCodes('BL-12')[0].code).toBe('BL-12');
  });

  it('returns codes in order of appearance, deduplicated', () => {
    const codes = findBlockerCodes(
      'phụ thuộc `BL-03`, và thêm `BL-05`; `BL-03` lần nữa',
    ).map((c) => c.code);
    expect(codes).toEqual(['BL-03', 'BL-05']);
  });
});

describe('normalizeReason', () => {
  it('ignores run ids, GUIDs and timestamps so a rerun does not fork a new issue', () => {
    const a =
      'Không dò được dự án a4387a79-43e0-fc8f-eb25-3a22e30ec830 trong run-mtmleirb-n2fcjq lúc 2026-09-04T06:48:30.631Z (mất 1200 ms)';
    const b =
      'Không dò được dự án 11112222-3333-4444-5555-666677778888 trong run-mtomdrhj-41zqr3 lúc 2026-09-06T01:02:03.004Z (mất 87 ms)';
    expect(normalizeReason(a)).toBe(normalizeReason(b));
  });

  it('ignores generated fixture identifiers, which fork a new issue on every run', () => {
    // Real shape: `AUTO-<case>-<branch>-<epoch ms>-<random>` from a supply-contract fixture.
    const a =
      'BIM không xác nhận được combo vật tư tự tạo (comboA, model=AUTO-C09-A-1787788854055-774)';
    const b =
      'BIM không xác nhận được combo vật tư tự tạo (comboA, model=AUTO-C09-A-1787789000660-2749)';
    expect(normalizeReason(a)).toBe(normalizeReason(b));
  });

  it('keeps business numbers, which distinguish genuinely different conditions', () => {
    expect(normalizeReason('KL dư thừa = 0 ở cột `KSDH-60`')).not.toBe(
      normalizeReason('KL dư thừa = 12000000 ở cột `KSDH-60`'),
    );
  });
});

describe('extractCandidates — what becomes an unresolved observation', () => {
  it('turns a NOT_EVALUATED check into an observation even though passed is true', () => {
    const check = makeCheck({
      expected: BL03_REASON,
      actual: BL03_REASON,
      passed: true,
    });
    const [candidate, ...rest] = extractCandidates(makeRun(), [check]);

    expect(rest).toHaveLength(0);
    expect(candidate.observation.observedResult).toBe('NOT_EVALUATED');
    expect(candidate.observation.observationKey).toBe('check:1');
    expect(candidate.importKey).toBe('kiem-soat-dat-hang-thua:BL-03');
    // The marker itself is noise; the reason under it is the content.
    expect(candidate.sourceSummary.startsWith('NOT_EVALUATED')).toBe(false);
    expect(candidate.sourceSummary).toContain('mâu thuẫn công thức');
  });

  it('splits a PARTIAL run: failed assertions stay with the defect workflow', () => {
    const notEvaluated = makeCheck({
      sequence: 2,
      testId: 'TC-KSDH-A05 / A2',
      expected: BL03_REASON,
      actual: BL03_REASON,
      passed: true,
    });
    const failed = makeCheck({
      sequence: 3,
      testId: 'TC-KSDH-A05 / A3',
      label: 'A3 — tổng khớp',
      expected: 900000,
      actual: 0,
      passed: false,
    });
    const passed = makeCheck({
      sequence: 4,
      expected: 5,
      actual: 5,
      passed: true,
    });

    const candidates = extractCandidates(makeRun(), [
      notEvaluated,
      failed,
      passed,
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].observation.checkSequence).toBe(2);
  });

  it('produces a run-level observation for a BLOCKED run with no checks at all', () => {
    const run = makeRun({
      id: 'run-mtomdsjp-uclu7c',
      result: 'BLOCKED',
      blockedReason:
        'TC-CHVT-U01 chặn ở tầng HARNESS, KHÔNG phải lỗi sản phẩm: driver thiếu verb kéo-thả.',
      domain: 'cau-hinh-vat-tu',
      testCaseId: 'TC-CHVT-U01',
      scenarioKey: 'ui-chvt-bimgencode-dnd',
    });

    const [candidate, ...rest] = extractCandidates(run, []);

    expect(rest).toHaveLength(0);
    expect(candidate.observation.observationKey).toBe('run:blocked');
    expect(candidate.observation.observedResult).toBe('BLOCKED');
    expect(candidate.observation.checkSequence).toBeNull();
    // No named code in this reason, so it must fall back deterministically.
    expect(candidate.importKey).toMatch(/^auto:cau-hinh-vat-tu:[0-9a-f]{16}$/);
    expect(candidate.blockerCode).toBeUndefined();
  });

  it('classifies an ERROR run as a run-level observation with no blocker code', () => {
    const run = makeRun({
      result: 'ERROR',
      errorSummary:
        'Không dò được dự án để mở màn cấp dự án (Project selector must include at least one of: id, code, keyword).',
      domain: 'cau-hinh-vat-tu',
    });

    const [candidate] = extractCandidates(run, []);

    expect(candidate.observation.observationKey).toBe('run:error');
    expect(candidate.observation.observedResult).toBe('ERROR');
    expect(candidate.blockerCode).toBeUndefined();
    expect(candidate.importKey.startsWith('auto:')).toBe(true);
  });

  it('produces nothing for PASS and FAIL runs', () => {
    for (const result of ['PASS', 'FAIL']) {
      const run = makeRun({ result, blockedReason: null });
      const failed = makeCheck({ expected: 1, actual: 2, passed: false });
      expect(extractCandidates(run, [failed])).toEqual([]);
    }
  });
});

describe('extractCandidates — canonical identity', () => {
  it('maps one blocker code across different scenarios and runs to one issue', () => {
    const first = extractCandidates(
      makeRun({
        id: 'run-a',
        scenarioKey: 'xpkg-total-value',
        testCaseId: 'TC-KSDH-A04',
      }),
      [makeCheck({ expected: BL03_REASON, actual: BL03_REASON })],
    );
    const second = extractCandidates(
      makeRun({
        id: 'run-b',
        scenarioKey: 'xpkg-tower-columns',
        testCaseId: 'TC-KSDH-A09',
      }),
      [makeCheck({ sequence: 7, expected: BL03_REASON, actual: BL03_REASON })],
    );

    expect(first[0].importKey).toBe(second[0].importKey);
    expect(first[0].observation.runId).not.toBe(second[0].observation.runId);
  });

  it('keeps the same code in different domains apart', () => {
    const ksdh = extractCandidates(
      makeRun({ domain: 'kiem-soat-dat-hang-thua' }),
      [makeCheck({ expected: BL03_REASON, actual: BL03_REASON })],
    );
    const nhanCong = extractCandidates(makeRun({ domain: 'nhan-cong' }), [
      makeCheck({ expected: BL03_REASON, actual: BL03_REASON }),
    ]);

    expect(ksdh[0].importKey).toBe('kiem-soat-dat-hang-thua:BL-03');
    expect(nhanCong[0].importKey).toBe('nhan-cong:BL-03');
  });

  it('recovers the domain from the test case id when the run row does not carry one', () => {
    // 603 runs in Postgres predate the module/domain columns and were never re-persisted.
    const [candidate] = extractCandidates(
      makeRun({
        domain: null,
        module: null,
        result: 'BLOCKED',
        blockedReason: 'chặn vì `BL-11` chưa chốt',
      }),
      [],
    );
    expect(candidate.domain).toBe('kiem-soat-dat-hang-thua');
    expect(candidate.importKey).toBe('kiem-soat-dat-hang-thua:BL-11');
  });

  it('prefers the joined test case domain over the id prefix', () => {
    const [candidate] = extractCandidates(
      makeRun({
        domain: null,
        module: null,
        testCase: { domain: 'quy-cach-dong-goi', module: 'packaging' },
        result: 'BLOCKED',
        blockedReason: 'probe failed',
      }),
      [],
    );
    expect(candidate.domain).toBe('quy-cach-dong-goi');
    expect(candidate.module).toBe('packaging');
  });

  it('treats a stored _unknown as no answer, not as an authoritative domain', () => {
    // The runner stamps the literal _unknown for a scenario missing from SCENARIO_GROUPS.
    const [candidate] = extractCandidates(
      makeRun({
        domain: '_unknown',
        module: '_unknown',
        testCaseId: 'TC-CHVT-U01',
        result: 'BLOCKED',
        blockedReason: 'BL-07 chua chot',
      }),
      [],
    );
    expect(candidate.domain).toBe('cau-hinh-vat-tu');
    expect(candidate.importKey).toBe('cau-hinh-vat-tu:BL-07');
  });

  it('falls back to _unknown only when nothing identifies the feature', () => {
    const [candidate] = extractCandidates(
      makeRun({
        domain: null,
        testCaseId: 'probe-role-lifecycle',
        result: 'BLOCKED',
        blockedReason: 'probe failed',
      }),
      [],
    );
    expect(candidate.domain).toBe('_unknown');
    expect(candidate.importKey.startsWith('auto:_unknown:')).toBe(true);
  });

  it('records secondary blocker codes as ambiguous instead of grouping on them', () => {
    const diagnostics = emptyDiagnostics();
    const reason =
      'NOT_EVALUATED — vế phải đi qua `excessQty` — đại lượng bị khoá. `BL-03` — mâu thuẫn công thức. Cộng thêm `BL-05`.';
    const [candidate] = extractCandidates(
      makeRun(),
      [makeCheck({ expected: reason, actual: reason })],
      diagnostics,
    );

    expect(candidate.importKey).toBe('kiem-soat-dat-hang-thua:BL-03');
    expect(candidate.ambiguousCodes).toEqual(['BL-05']);
    expect(diagnostics.ambiguous).toHaveLength(1);
  });
});

describe('extractCandidates — fallback keys', () => {
  const unstructured =
    'NOT_EVALUATED — mọi đơn "Chưa nhập kho" thoả tổng KL đã giao = 0 (chưa có đơn nào ở trạng thái này trên môi trường quan sát)';

  it('is deterministic for the same evidence', () => {
    const run = makeRun({ result: 'PARTIAL' });
    const check = makeCheck({ expected: unstructured, actual: unstructured });
    const a = extractCandidates(run, [check])[0];
    const b = extractCandidates(run, [check])[0];

    expect(a.importKey).toBe(b.importKey);
    expect(a.displayKey).toBe(b.displayKey);
  });

  it('is stable across runs that differ only in volatile values', () => {
    const withRunA = extractCandidates(
      makeRun({
        id: 'run-mtmleirb-n2fcjq',
        startedAt: new Date('2026-09-01T00:00:00Z'),
      }),
      [
        makeCheck({
          expected: `${unstructured} — quan sát lúc 2026-09-01T00:00:00.000Z trong run-mtmleirb-n2fcjq`,
          actual: `${unstructured} — quan sát lúc 2026-09-01T00:00:00.000Z trong run-mtmleirb-n2fcjq`,
        }),
      ],
    );
    const withRunB = extractCandidates(
      makeRun({
        id: 'run-mtomdrhj-41zqr3',
        startedAt: new Date('2026-09-06T00:00:00Z'),
      }),
      [
        makeCheck({
          expected: `${unstructured} — quan sát lúc 2026-09-06T00:00:00.000Z trong run-mtomdrhj-41zqr3`,
          actual: `${unstructured} — quan sát lúc 2026-09-06T00:00:00.000Z trong run-mtomdrhj-41zqr3`,
        }),
      ],
    );

    expect(withRunA[0].importKey).toBe(withRunB[0].importKey);
  });

  it('does not merge two different unresolved reasons in the same scenario', () => {
    const first = extractCandidates(makeRun(), [
      makeCheck({
        sequence: 1,
        testId: 'TC-DH-U31 / A1',
        expected: unstructured,
        actual: unstructured,
      }),
    ]);
    const other =
      'NOT_EVALUATED — Số liệu 5 đơn cũ khớp bản chụp baseline trước ngày deploy — KHÔNG có baseline nào trong repo';
    const second = extractCandidates(makeRun(), [
      makeCheck({
        sequence: 2,
        testId: 'TC-DH-U31 / A2',
        expected: other,
        actual: other,
      }),
    ]);

    expect(first[0].importKey).not.toBe(second[0].importKey);
  });

  it('separates two assertions of one scenario that share a reason', () => {
    const a = extractCandidates(makeRun(), [
      makeCheck({
        sequence: 1,
        testId: 'TC-DH-U31 / A1',
        expected: unstructured,
        actual: unstructured,
      }),
      makeCheck({
        sequence: 2,
        testId: 'TC-DH-U31 / A2',
        expected: unstructured,
        actual: unstructured,
      }),
    ]);

    expect(a).toHaveLength(2);
    expect(a[0].importKey).not.toBe(a[1].importKey);
  });

  it('falls back to the check sequence when the scenario supplied no assertion id', () => {
    const [candidate] = extractCandidates(makeRun(), [
      makeCheck({
        sequence: 9,
        testId: null,
        expected: unstructured,
        actual: unstructured,
      }),
    ]);
    expect(candidate.displayKey).toContain('#9.');
  });
});

describe('extractCandidates — run-level de-duplication', () => {
  it('suppresses a run reason whose blocker code a check already reported', () => {
    const diagnostics = emptyDiagnostics();
    const candidates = extractCandidates(
      makeRun({
        result: 'BLOCKED',
        blockedReason: `Cả 4 assertion của §7 đều đi qua excessQty. ${BL03_REASON}`,
      }),
      [makeCheck({ expected: BL03_REASON, actual: BL03_REASON })],
      diagnostics,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].observation.observationKey).toBe('check:1');
    expect(diagnostics.suppressedRunLevel).toHaveLength(1);
  });

  it('keeps a run reason that says something the checks do not', () => {
    const candidates = extractCandidates(
      makeRun({
        result: 'PARTIAL',
        blockedReason:
          'Ngoài các assertion trên, phân bổ chi tiết trả 0 dòng sau 5 lượt poll (job phân bổ ở Failed).',
      }),
      [makeCheck({ expected: BL03_REASON, actual: BL03_REASON })],
    );

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.observation.observationKey)).toEqual([
      'check:1',
      'run:blocked',
    ]);
    expect(candidates[1].observation.observedResult).toBe('PARTIAL');
  });
});
