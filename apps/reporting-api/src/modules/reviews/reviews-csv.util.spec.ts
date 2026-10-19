import { normalizeReviewRecord } from '@qakit/reporting-shared';

import type { ExportableReview } from './reviews-csv.util';
import {
  REVIEW_CSV_COLUMNS,
  buildReviewExportFilename,
  buildReviewRows,
  buildReviewsCsv,
  scenarioScriptPath,
} from './reviews-csv.util';

function makeEntry(
  overrides: Partial<ExportableReview> = {},
  review: Record<string, unknown> = {},
): ExportableReview {
  return {
    review: normalizeReviewRecord({
      id: 'review-1',
      test_run_id: 'run-1',
      verdict: 'rejected',
      reviewer: 'qa-reviewer',
      reviewed_at: '2026-09-10T02:00:00.000Z',
      ...review,
    }),
    runId: 'run-1',
    testCaseId: 'TC-BOQT-B03',
    testCaseTitle: 'GT nhân công — trần hạn mức',
    scenarioKey: 'inv-labor-value-cap-limit',
    runType: 'api',
    module: 'boq-acceptance',
    domain: 'boq-nghiem-thu-thanh-toan',
    featureId: 'QLDN-VT-04',
    result: 'fail',
    startedAt: new Date('2026-09-09T10:00:00.000Z'),
    ...overrides,
  };
}

describe('scenarioScriptPath', () => {
  it('builds the suite path from module, run type and scenario key', () => {
    expect(
      scenarioScriptPath('boq-acceptance', 'api', 'inv-labor-value-cap-limit'),
    ).toBe(
      'src/suites/boq-acceptance/api/inv-labor-value-cap-limit.scenario.ts',
    );
    expect(scenarioScriptPath('platform', 'ui', 'ui-login-happy-path')).toBe(
      'src/suites/platform/ui/ui-login-happy-path.scenario.ts',
    );
  });

  it('returns empty rather than inventing a path when the run has no module', () => {
    expect(scenarioScriptPath(null, 'api', 'some-probe')).toBe('');
  });
});

describe('buildReviewRows', () => {
  it('emits one row per suggestion item, grouped by type in reading order', () => {
    const rows = buildReviewRows([
      makeEntry(
        {},
        {
          missing_coverage: ['zero quantity'],
          suggested_steps: ['Submit PO with qty 0', 'Reload the list'],
          suggested_assertions: ['Response status is 400'],
          suggested_test_data: ['qty: 0'],
        },
      ),
    ]);

    const typeIndex = REVIEW_CSV_COLUMNS.indexOf('suggestion_type');
    const orderIndex = REVIEW_CSV_COLUMNS.indexOf('suggestion_index');
    const textIndex = REVIEW_CSV_COLUMNS.indexOf('suggestion_text');

    expect(rows).toHaveLength(5);
    expect(
      rows.map((r) => [r[typeIndex], r[orderIndex], r[textIndex]]),
    ).toEqual([
      ['missing_coverage', 1, 'zero quantity'],
      ['suggested_step', 1, 'Submit PO with qty 0'],
      ['suggested_step', 2, 'Reload the list'],
      ['suggested_assertion', 1, 'Response status is 400'],
      ['suggested_test_data', 1, 'qty: 0'],
    ]);
  });

  it('repeats the run context on every row so each is actionable alone', () => {
    const rows = buildReviewRows([
      makeEntry({}, { suggested_steps: ['one', 'two'] }),
    ]);
    const scriptIndex = REVIEW_CSV_COLUMNS.indexOf('scenario_script');

    expect(rows[0][scriptIndex]).toBe(
      'src/suites/boq-acceptance/api/inv-labor-value-cap-limit.scenario.ts',
    );
    expect(rows[0][scriptIndex]).toBe(rows[1][scriptIndex]);
    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('run_id')]).toBe('run-1');
    expect(rows[1][REVIEW_CSV_COLUMNS.indexOf('feature_id')]).toBe(
      'QLDN-VT-04',
    );
  });

  it('keeps a review with no suggestions as exactly one review_only row', () => {
    const rows = buildReviewRows([
      makeEntry({}, { improvement_summary: 'Looks fine' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('suggestion_type')]).toBe(
      'review_only',
    );
    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('suggestion_text')]).toBe('');
    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('improvement_summary')]).toBe(
      'Looks fine',
    );
  });

  it('renders absent optional fields as empty cells', () => {
    const rows = buildReviewRows([
      makeEntry({
        module: null,
        testCaseTitle: null,
        featureId: null,
        startedAt: null,
      }),
    ]);

    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('module')]).toBe('');
    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('test_case_title')]).toBe('');
    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('feature_id')]).toBe('');
    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('started_at')]).toBe('');
    expect(rows[0][REVIEW_CSV_COLUMNS.indexOf('scenario_script')]).toBe('');
  });
});

describe('buildReviewsCsv', () => {
  it('starts with the header row and a BOM, and uses CRLF', () => {
    const csv = buildReviewsCsv([makeEntry()]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1).split('\r\n')[0]).toBe(REVIEW_CSV_COLUMNS.join(','));
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('neutralises a suggestion that would otherwise be read as a formula', () => {
    const csv = buildReviewsCsv(
      [
        makeEntry(
          {},
          { suggested_steps: ['=HYPERLINK("http://evil","click")'] },
        ),
      ],
      { bom: false },
    );

    expect(csv).toContain('"\'=HYPERLINK(""http://evil"",""click"")"');
  });

  it('keeps Vietnamese review text intact', () => {
    const csv = buildReviewsCsv(
      [makeEntry({}, { improvement_summary: 'Thiếu kiểm tra hạn mức' })],
      { bom: false },
    );

    expect(csv).toContain('Thiếu kiểm tra hạn mức');
  });

  it('emits only the header when nothing was reviewed', () => {
    const csv = buildReviewsCsv([], { bom: false });
    expect(csv).toBe(`${REVIEW_CSV_COLUMNS.join(',')}\r\n`);
  });
});

describe('buildReviewExportFilename', () => {
  it('timestamps the file in UTC, without colons, so successive exports do not overwrite', () => {
    expect(
      buildReviewExportFilename(new Date('2026-09-10T08:30:05.123Z')),
    ).toBe('run-reviews-2026-09-10T08-30-05Z.csv');
  });
});
