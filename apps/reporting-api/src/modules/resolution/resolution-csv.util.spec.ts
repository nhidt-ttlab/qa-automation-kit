import {
  buildExportFilename,
  buildIssueRows,
  buildResolutionCsv,
  escapeCsvValue,
  formatComments,
  RESOLUTION_CSV_COLUMNS,
  toCsv,
  type ExportableIssue,
} from './resolution-csv.util';

/**
 * The export exists so an answer recorded in the queue can be carried back into the spec document
 * and the testcase it came from. That makes two things load-bearing: the Vietnamese must survive
 * the trip into Excel, and a comment must not be able to execute when someone opens the file.
 */

function makeIssue(overrides: Partial<ExportableIssue> = {}): ExportableIssue {
  return {
    importKey: 'kiem-soat-dat-hang-thua:BL-03',
    displayKey: 'kiem-soat-dat-hang-thua:BL-03',
    title: 'BL-03 — mâu thuẫn công thức Mất cost',
    kind: 'SPEC_DECISION',
    workflowStatus: 'VERIFIED',
    priority: 'High',
    owner: 'ba_linh',
    module: 'excess-order',
    domain: 'kiem-soat-dat-hang-thua',
    userSummary: 'Chốt theo cách hiểu (2).',
    decision: 'Mất cost bị TRỪ khỏi Tổng KL.',
    decisionBy: 'ba_linh',
    decisionAt: new Date('2026-09-02T00:00:00.000Z'),
    resolution: 'Cập nhật step doc và assertion.',
    resolutionType: 'SPEC_CLARIFIED',
    resolvedBy: 'dev_hai',
    resolvedAt: new Date('2026-09-03T00:00:00.000Z'),
    verificationNote: 'Rerun sạch.',
    verifiedBy: 'qa_minh',
    verifiedAt: new Date('2026-09-04T00:00:00.000Z'),
    verificationRunId: 'run-verify',
    firstSeenAt: new Date('2026-09-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-09-05T00:00:00.000Z'),
    recurrenceCount: 0,
    defectSignatureId: null,
    observations: [
      {
        testCaseId: 'TC-KSDH-A05',
        scenarioKey: 'xpkg-excess-total',
        checkTestId: 'TC-KSDH-A05 / A4',
        checkSequence: 4,
        rawReason: 'BA chưa chọn cách hoà.',
        runId: 'run-a',
        observedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
    comments: [],
    redmineLinks: [],
    ...overrides,
  };
}

/** Column index by name, so assertions do not depend on column order. */
function cell(
  row: string[],
  column: (typeof RESOLUTION_CSV_COLUMNS)[number],
): string {
  return row[RESOLUTION_CSV_COLUMNS.indexOf(column)];
}

describe('escapeCsvValue', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeCsvValue('BL-03')).toBe('BL-03');
    expect(escapeCsvValue('mâu thuẫn công thức')).toBe('mâu thuẫn công thức');
  });

  it('quotes delimiters, quotes and newlines', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
    // 0 and false are real values and must survive.
    expect(escapeCsvValue(0)).toBe('0');
    expect(escapeCsvValue(false)).toBe('false');
  });

  it('neutralises a cell that a spreadsheet would run as a formula', () => {
    // A comment is free text written by a person; opening the export must not execute it.
    expect(escapeCsvValue('=1+1')).toBe("'=1+1");
    expect(escapeCsvValue('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
    expect(escapeCsvValue('+44 123')).toBe("'+44 123");
    expect(escapeCsvValue('@user')).toBe("'@user");
    expect(escapeCsvValue('-5')).toBe("'-5");
  });

  it('does not neutralise a minus sign inside the value', () => {
    expect(escapeCsvValue('BL-03 — a-b')).toBe('BL-03 — a-b');
  });
});

describe('toCsv', () => {
  it('uses CRLF line endings and a UTF-8 BOM by default', () => {
    const csv = toCsv([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    // Without the BOM, Excel on Windows renders the Vietnamese in these exports as mojibake.
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿a,b\r\nc,d\r\n');
  });

  it('can omit the BOM for machine consumers', () => {
    expect(toCsv([['a']], { bom: false })).toBe('a\r\n');
  });

  it('returns just the BOM for no rows rather than a stray newline', () => {
    expect(toCsv([])).toBe('﻿');
  });
});

describe('formatComments', () => {
  it('renders oldest first, one per line, with author and timestamp', () => {
    const text = formatComments([
      {
        author: 'ba_linh',
        body: 'Đã chốt.',
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
      },
      {
        author: 'qa_minh',
        body: 'Đã hỏi BA.',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);

    expect(text).toBe(
      'qa_minh (2026-09-01T00:00:00.000Z): Đã hỏi BA.\n' +
        'ba_linh (2026-09-02T00:00:00.000Z): Đã chốt.',
    );
  });

  it('survives a comment containing the separators it might have used', () => {
    const text = formatComments([
      {
        author: 'qa',
        body: 'a; b | c',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);
    expect(text).toContain('a; b | c');
  });
});

describe('buildIssueRows — one row per affected test case', () => {
  it('repeats the decision and resolution on every affected test case', () => {
    const issue = makeIssue({
      observations: [
        {
          testCaseId: 'TC-KSDH-A05',
          scenarioKey: 'xpkg-excess-total',
          checkTestId: 'TC-KSDH-A05 / A4',
          checkSequence: 4,
          rawReason: 'reason A',
          runId: 'run-a',
          observedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          testCaseId: 'TC-KSDH-A04',
          scenarioKey: 'xpkg-tower-columns',
          checkTestId: 'TC-KSDH-A04 / A2',
          checkSequence: 2,
          rawReason: 'reason B',
          runId: 'run-b',
          observedAt: new Date('2026-09-02T00:00:00.000Z'),
        },
      ],
    });

    const rows = buildIssueRows(issue);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => cell(r, 'test_case_id'))).toEqual([
      'TC-KSDH-A05',
      'TC-KSDH-A04',
    ]);
    for (const row of rows) {
      expect(cell(row, 'display_key')).toBe('kiem-soat-dat-hang-thua:BL-03');
      expect(cell(row, 'decision')).toBe('Mất cost bị TRỪ khỏi Tổng KL.');
      expect(cell(row, 'resolution_type')).toBe('SPEC_CLARIFIED');
    }
  });

  it('joins several assertions of one test case into a single row', () => {
    const base = makeIssue().observations[0];
    const issue = makeIssue({
      observations: [
        { ...base, checkTestId: 'TC-KSDH-A05 / A4', checkSequence: 4 },
        { ...base, checkTestId: 'TC-KSDH-A05 / A1', checkSequence: 1 },
        { ...base, checkTestId: 'TC-KSDH-A05 / A4', checkSequence: 4 },
      ],
    });

    const rows = buildIssueRows(issue);

    expect(rows).toHaveLength(1);
    // Sequence order, deduplicated.
    expect(cell(rows[0], 'check_test_ids')).toBe(
      'TC-KSDH-A05 / A1; TC-KSDH-A05 / A4',
    );
    expect(cell(rows[0], 'observation_count')).toBe('3');
  });

  it('labels a run-level blocker rather than leaving the assertion column blank', () => {
    const issue = makeIssue({
      observations: [
        {
          testCaseId: 'TC-CHVT-U01',
          scenarioKey: 'ui-chvt-dnd',
          checkTestId: null,
          checkSequence: null,
          rawReason: 'driver thiếu verb kéo-thả',
          runId: 'run-x',
          observedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });

    expect(cell(buildIssueRows(issue)[0], 'check_test_ids')).toBe('run-level');
  });

  it('quotes the newest reason, not an arbitrary one', () => {
    const base = makeIssue().observations[0];
    const issue = makeIssue({
      observations: [
        {
          ...base,
          rawReason: 'old',
          runId: 'run-old',
          observedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          ...base,
          rawReason: 'new',
          runId: 'run-new',
          observedAt: new Date('2026-09-09T00:00:00.000Z'),
        },
      ],
    });

    const row = buildIssueRows(issue)[0];
    expect(cell(row, 'latest_reason')).toBe('new');
    expect(cell(row, 'latest_run_id')).toBe('run-new');
  });

  it('still emits a row for an issue whose evidence the runner has purged', () => {
    // Losing a recorded decision because its runs were cleaned would defeat the export.
    const rows = buildIssueRows(makeIssue({ observations: [] }));

    expect(rows).toHaveLength(1);
    expect(cell(rows[0], 'test_case_id')).toBe('');
    expect(cell(rows[0], 'decision')).toBe('Mất cost bị TRỪ khỏi Tổng KL.');
  });

  it('translates the domain to the Vietnamese feature name doc authors use', () => {
    expect(cell(buildIssueRows(makeIssue())[0], 'feature')).toBe(
      'Kiểm soát đặt hàng thừa',
    );
  });

  it('falls back to the raw domain when the label is unknown', () => {
    const row = buildIssueRows(makeIssue({ domain: 'brand-new-module' }))[0];
    expect(cell(row, 'feature')).toBe('brand-new-module');
  });

  it('carries comments and Redmine ids onto every row', () => {
    const issue = makeIssue({
      comments: [
        {
          author: 'qa_minh',
          body: 'Đã hỏi BA.',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
      redmineLinks: [{ redmineIssueId: 4321 }, { redmineIssueId: 4322 }],
    });

    const row = buildIssueRows(issue)[0];
    expect(cell(row, 'comments')).toContain('qa_minh');
    expect(cell(row, 'comments')).toContain('Đã hỏi BA.');
    expect(cell(row, 'comment_count')).toBe('1');
    expect(cell(row, 'redmine_issue_ids')).toBe('4321; 4322');
  });

  it('leaves unanswered fields empty rather than writing null', () => {
    const row = buildIssueRows(
      makeIssue({
        decision: null,
        decisionBy: null,
        decisionAt: null,
        resolution: null,
        resolutionType: null,
        resolvedBy: null,
        resolvedAt: null,
        owner: null,
        priority: null,
        defectSignatureId: null,
      }),
    )[0];

    for (const column of [
      'decision',
      'resolution',
      'owner',
      'priority',
      'defect_signature_id',
    ] as const) {
      expect(cell(row, column)).toBe('');
    }
  });
});

describe('buildResolutionCsv', () => {
  it('starts with the header row', () => {
    const csv = buildResolutionCsv([makeIssue()], { bom: false });
    expect(csv.split('\r\n')[0]).toBe(RESOLUTION_CSV_COLUMNS.join(','));
  });

  it('emits a header even when nothing matched the filters', () => {
    const csv = buildResolutionCsv([], { bom: false });
    expect(csv).toBe(`${RESOLUTION_CSV_COLUMNS.join(',')}\r\n`);
  });

  it('round-trips a comment containing commas, quotes and newlines', () => {
    const issue = makeIssue({
      comments: [
        {
          author: 'qa_minh',
          body: 'Dòng 1, có dấu phẩy\nDòng 2 có "ngoặc kép"',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });

    const csv = buildResolutionCsv([issue], { bom: false });

    expect(csv).toContain('""ngoặc kép""');
    // The whole comments cell is quoted, so its newline does not start a new record.
    expect(csv).toContain(
      '"qa_minh (2026-09-01T00:00:00.000Z): Dòng 1, có dấu phẩy\n',
    );
  });

  it('keeps one row per test case across several issues', () => {
    const a = makeIssue({ displayKey: 'a:BL-01', importKey: 'a:BL-01' });
    const b = makeIssue({
      displayKey: 'b:BL-02',
      importKey: 'b:BL-02',
      observations: [
        { ...makeIssue().observations[0], testCaseId: 'TC-X' },
        { ...makeIssue().observations[0], testCaseId: 'TC-Y' },
      ],
    });

    const lines = buildResolutionCsv([a, b], { bom: false })
      .trimEnd()
      .split('\r\n');
    // header + 1 + 2
    expect(lines).toHaveLength(4);
  });
});

describe('buildExportFilename', () => {
  it('dates the file so successive exports do not overwrite each other', () => {
    expect(buildExportFilename(new Date('2026-09-06T21:40:00.000Z'))).toBe(
      'resolution-issues-2026-09-06.csv',
    );
  });
});
