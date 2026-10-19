import { csvColumnsFromSqliteCheck, testcaseIdFromTestId } from './checklist-backfill.util';

/**
 * The backfill's whole claim to safety is that it only fills mappings that were *recorded*, not
 * mappings that look plausible. That claim reduces almost entirely to this one parser: it decides
 * which historical rows are candidates at all.
 */
describe('testcaseIdFromTestId', () => {
  it('recovers the row id from the pre-migration three-segment form', () => {
    expect(testcaseIdFromTestId('TC-CHVT-U16 / A1 / TC_16')).toBe('TC_16');
  });

  /**
   * The load-bearing negative case. Assertions written after the migration carry two segments and
   * genuinely map to nothing; reading a row out of them would be invention, and would also let a
   * rerun overwrite rows a real run had deliberately left empty.
   */
  it('returns nothing for the current two-segment form', () => {
    expect(testcaseIdFromTestId('TC-CHVT-U16 / A1')).toBeUndefined();
  });

  it('returns nothing for a missing or empty test id', () => {
    expect(testcaseIdFromTestId(null)).toBeUndefined();
    expect(testcaseIdFromTestId('')).toBeUndefined();
    expect(testcaseIdFromTestId('TC-CHVT-U16 / A1 / ')).toBeUndefined();
  });

  it('does not treat a four-segment id as a mapping', () => {
    // Not a shape the trace ever produced, so it carries no recorded mapping to recover.
    expect(testcaseIdFromTestId('a / b / c / d')).toBeUndefined();
  });

  it('tolerates the spacing variations the trace has used', () => {
    expect(testcaseIdFromTestId('TC-X-U01/A2/TC_7')).toBe('TC_7');
    expect(testcaseIdFromTestId('TC-X-U01  /  A2  /  TC_7')).toBe('TC_7');
  });

  it('keeps a non-TC_ row id, since not every sheet numbers rows that way', () => {
    // `Danh mục thuộc tính.csv` and the refactor sheet use bare ordinals in their id column.
    expect(testcaseIdFromTestId('TC-X-U01 / A1 / 19')).toBe('19');
  });
});

describe('csvColumnsFromSqliteCheck', () => {
  it('carries a mapped assertion across unchanged', () => {
    expect(
      csvColumnsFromSqliteCheck({
        csv_checklist_id: 'QLDN-VT-04',
        csv_testcase_id: 'TC_16',
        csv_expected: 'Mã sinh ra bắt đầu bằng "VT-" và có dạng VT-ONG',
        csv_business_rule: 'Mã vật tư sinh tự động theo công thức đã cấu hình',
        csv_priority: 'P1',
      }),
    ).toEqual({
      csvChecklistId: 'QLDN-VT-04',
      csvTestcaseId: 'TC_16',
      csvExpected: 'Mã sinh ra bắt đầu bằng "VT-" và có dạng VT-ONG',
      csvBusinessRule: 'Mã vật tư sinh tự động theo công thức đã cấu hình',
      csvPriority: 'P1',
    });
  });

  it('maps an unmapped assertion to explicit NULLs', () => {
    expect(
      csvColumnsFromSqliteCheck({
        csv_checklist_id: null,
        csv_testcase_id: null,
        csv_expected: null,
        csv_business_rule: null,
        csv_priority: null,
      }),
    ).toEqual({
      csvChecklistId: null,
      csvTestcaseId: null,
      csvExpected: null,
      csvBusinessRule: null,
      csvPriority: null,
    });
  });

  /**
   * A runner database created before these columns existed hands back rows without the properties
   * at all. Left undefined, Prisma omits the field rather than writing NULL — which for a `create`
   * is harmless but for anything else silently preserves a stale value.
   */
  it('turns absent properties from an older runner DB into NULLs, not undefined', () => {
    const mapped = csvColumnsFromSqliteCheck({});
    expect(mapped).toEqual({
      csvChecklistId: null,
      csvTestcaseId: null,
      csvExpected: null,
      csvBusinessRule: null,
      csvPriority: null,
    });
    for (const value of Object.values(mapped)) expect(value).not.toBeUndefined();
  });

  /**
   * `csv_business_rule` landed after the other four, so "an older runner DB" is not only the
   * all-or-nothing case above: a database written between the two changes carries the four and not
   * the fifth, and that one missing column must still reach Postgres as NULL.
   */
  it('nulls the business rule alone when the runner DB predates only that column', () => {
    const mapped = csvColumnsFromSqliteCheck({
      csv_checklist_id: 'QLDN-VT-04',
      csv_testcase_id: 'TC_16',
      csv_expected: 'Mã sinh ra bắt đầu bằng "VT-"',
      csv_priority: 'P1',
    });
    expect(mapped.csvBusinessRule).toBeNull();
    expect(mapped.csvExpected).toBe('Mã sinh ra bắt đầu bằng "VT-"');
  });

  it('keeps a joined multi-row value intact rather than re-splitting it', () => {
    const mapped = csvColumnsFromSqliteCheck({
      csv_checklist_id: 'QLDN-VT-04',
      csv_testcase_id: 'TC_16 | TC_17',
      csv_expected: 'first | second',
      csv_business_rule: 'rule one | rule two',
      csv_priority: 'P1 | —',
    });
    expect(mapped.csvTestcaseId).toBe('TC_16 | TC_17');
    expect(mapped.csvBusinessRule).toBe('rule one | rule two');
    expect(mapped.csvPriority).toBe('P1 | —');
  });
});
