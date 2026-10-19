import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CHECK_STATUS, UI_EVIDENCE_KIND } from '@qakit/reporting-shared';
import { UiCheckpointsTable } from './UiCheckpointsTable';
import type { RunChecks, UiEvidence } from './types';

/**
 * The checklist snapshot exists so a QA reviewer can tie an assertion back to the row of the sheet
 * it answers, read the rule that row checks, and triage by its priority — without losing sight of
 * what the assertion itself is called. Four rules carry that, and all four are easy to break
 * without noticing:
 *
 *   · priority must be readable in the table itself — a value you have to hover to discover is a
 *     value nobody sorts or triages by;
 *   · the sheet's `Business Rule / Checklist` sentence holds a column of its own, prefixed by the
 *     sheet row id, and does not overwrite the harness-generated name in `Checkpoint`;
 *   · an assertion that answers no checklist row reads as an em dash there, rather than borrowing
 *     its neighbour's row;
 *   · the runtime Expected/Actual values stay visibly distinct from the sheet's wording.
 */

type Check = RunChecks[number];

const CHECK_NAME = 'Mã sinh ra khớp công thức';

function makeCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: '1',
    name: CHECK_NAME,
    passed: true,
    status: CHECK_STATUS.PASSED,
    expected: 'VT-ONG',
    actual: 'VT-ONG',
    test_id: 'TC-CHVT-U16 / A1',
    ...overrides,
  };
}

const BUSINESS_RULE = 'Mã vật tư sinh tự động theo công thức đã cấu hình, không cho sửa tay';
const CSV_EXPECTED = 'Mã sinh ra bắt đầu bằng "VT-" và có dạng VT-ONG';

const MAPPED: Partial<Check> = {
  csv_checklist_id: 'QLDN-VT-04',
  csv_testcase_id: 'TC_16',
  csv_business_rule: BUSINESS_RULE,
  csv_expected: CSV_EXPECTED,
  csv_priority: 'P1',
};

const evidence = (): UiEvidence => ({
  scenario: 'ui-chvt-gencode-preview-and-formula',
  generated_at: '2026-09-09T00:00:00.000Z',
  web_base_url: 'https://example.test',
  browser: { name: 'chromium', version: '1' },
  diagnostics: { page_errors: 0, console_errors: 0, failed_requests: 0, blocked_requests: 0 },
  items: [],
});

const bodyOf = () => within(screen.getByRole('table')).getAllByRole('rowgroup')[1]!;

describe('UiCheckpointsTable checklist snapshot', () => {
  /**
   * The regression guard for the whole layout: two vocabularies, two cells. The sheet's row id and
   * rule belong to the checklist; the assertion id and name are the harness's own, and neither may
   * displace the other.
   */
  it('states the sheet rule and the assertion name in separate cells', () => {
    render(<UiCheckpointsTable checks={[makeCheck(MAPPED)]} evidence={evidence()} />);
    const body = within(bodyOf());

    const ruleCell = body.getByText(BUSINESS_RULE).closest('td')!;
    expect(within(ruleCell).getByText('TC_16')).toBeInTheDocument();

    const checkpointCell = body.getByText(CHECK_NAME).closest('td')!;
    // `TC-CHVT-U16 / A1` identifies the assertion, and links its screenshot.
    expect(within(checkpointCell).getByText('TC-CHVT-U16 / A1')).toBeInTheDocument();

    expect(checkpointCell).not.toBe(ruleCell);
    // The sheet row id stays out of the checkpoint cell, where it used to be appended to the
    // assertion id.
    expect(within(checkpointCell).queryByText('TC_16')).toBeNull();
  });

  /**
   * The rule the row checks, not the outcome one invented data set should produce under it. Both
   * are stored; only the rule earns the line, because it is what a reviewer scanning the run reads.
   */
  it('does not display the CSV expected-result cell in place of the business rule', () => {
    render(<UiCheckpointsTable checks={[makeCheck(MAPPED)]} evidence={evidence()} />);
    expect(within(bodyOf()).queryByText(CSV_EXPECTED)).toBeNull();
  });

  it('falls back to the CSV expected cell for a run stored before the business rule column existed', () => {
    const { csv_business_rule: _omitted, ...withoutRule } = MAPPED;
    render(<UiCheckpointsTable checks={[makeCheck(withoutRule)]} evidence={evidence()} />);

    // The fallback lands in the business-rule cell, beside its row id — not merely somewhere in
    // the row.
    const cell = within(bodyOf()).getByText(CSV_EXPECTED).closest('td')!;
    expect(within(cell).getByText('TC_16')).toBeInTheDocument();
  });

  /** The explicit requirement: priority is a column, not a tooltip. */
  it('renders priority as visible text in the table body, not only in a title attribute', () => {
    render(<UiCheckpointsTable checks={[makeCheck(MAPPED)]} evidence={evidence()} />);

    const priority = within(bodyOf()).getByText('P1');
    // Guards against a regression to `title="P1"` on some other cell, which would satisfy a naive
    // text query against the document but leave the value invisible until hover.
    expect(priority.textContent).toBe('P1');
    expect(priority.closest('td')).not.toBeNull();
  });

  /**
   * An assertion answering several rows stores `P3 | P1 | —` so the joined columns stay aligned;
   * the cell shows the one a reviewer triages by, not the joined string.
   */
  it('shows only the highest priority when the assertion answers several checklist rows', () => {
    render(
      <UiCheckpointsTable
        checks={[
          makeCheck({ ...MAPPED, csv_priority: 'P3 | P1 | —' }),
          makeCheck({ ...MAPPED, id: '2', test_id: 'TC-CHVT-U16 / A2', csv_priority: '— | P2' }),
        ]}
        evidence={evidence()}
      />,
    );

    const [first, second] = within(bodyOf()).getAllByRole('row');
    expect(within(first!).getByText('P1')).toBeInTheDocument();
    expect(within(first!).queryByText('P3')).toBeNull();
    expect(within(first!).queryByText(/P3 \| P1/)).toBeNull();
    expect(within(second!).getByText('P2')).toBeInTheDocument();
  });

  it('reads an unanswered checklist row as an em dash, and still names its assertion', () => {
    render(
      <UiCheckpointsTable
        checks={[makeCheck(MAPPED), makeCheck({ id: '2', test_id: 'TC-CHVT-U16 / A2' })]}
        evidence={evidence()}
      />,
    );

    const rows = within(bodyOf()).getAllByRole('row');
    expect(rows).toHaveLength(2);
    // Both rows carry the same assertion name now that it is no longer displaced, so every query
    // has to stay scoped to one row.
    const unmapped = within(rows[1]!);
    // The unmapped row borrows neither the mapped row's rule, its row id, nor its priority…
    expect(unmapped.queryByText(BUSINESS_RULE)).toBeNull();
    expect(unmapped.queryByText('TC_16')).toBeNull();
    expect(unmapped.queryByText('P1')).toBeNull();
    // …and still identifies itself.
    expect(unmapped.getByText('TC-CHVT-U16 / A2')).toBeInTheDocument();
    expect(unmapped.getByText(CHECK_NAME)).toBeInTheDocument();
    // Em dash in the priority cell, the business-rule cell and the empty Proof cell, rather than
    // three blanks.
    expect(unmapped.getAllByText('—')).toHaveLength(3);
  });

  it('keeps the runtime Expected/Actual values distinct from the sheet wording', () => {
    render(<UiCheckpointsTable checks={[makeCheck(MAPPED)]} evidence={evidence()} />);
    // The run measured "VT-ONG"; the sheet describes invented data. Both must be present and they
    // are deliberately different strings — collapsing them would hide what was actually asserted.
    expect(screen.getAllByText('VT-ONG')).toHaveLength(2);
    expect(screen.getByText(BUSINESS_RULE)).toBeInTheDocument();
  });

  it('still links a screenshot to its checkpoint when the checklist snapshot is present', () => {
    const withShot = evidence();
    withShot.items = [
      {
        id: 'E-UI-01',
        kind: UI_EVIDENCE_KIND.SCREENSHOT,
        label: 'preview',
        url: '/api/runs/r1/ui-evidence/E-UI-01',
        size_bytes: 10,
        content_hash: 'abc',
        captured_at: '2026-09-09T00:00:00.000Z',
        check_test_id: 'TC-CHVT-U16 / A1',
      },
    ];
    render(<UiCheckpointsTable checks={[makeCheck(MAPPED)]} evidence={withShot} />);
    // The join key is `test_id` alone, which the checklist changes deliberately left untouched.
    expect(screen.getByTitle('preview')).toBeInTheDocument();
  });
});
