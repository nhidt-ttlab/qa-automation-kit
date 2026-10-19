import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ResolutionIssueDetailResponseDto } from '@qakit/reporting-shared';
import { ResolutionObservations } from './ResolutionObservations';

/**
 * The rendering rule this whole feature exists to protect: a NOT_EVALUATED observation must never
 * read as a pass. Its underlying check has `passed: true` by construction — the harness sets
 * `expected === actual === 'NOT_EVALUATED …'` — so anything that renders from `passed` shows a
 * green tick on an assertion nobody ever scored.
 */

function makeIssue(
  overrides: Partial<ResolutionIssueDetailResponseDto> = {},
): ResolutionIssueDetailResponseDto {
  return {
    id: '7',
    import_key: 'kiem-soat-dat-hang-thua:BL-03',
    display_key: 'kiem-soat-dat-hang-thua:BL-03',
    title: 'BL-03 — mâu thuẫn công thức Mất cost',
    kind: 'UNCLASSIFIED',
    workflow_status: 'OPEN',
    owner: null,
    priority: null,
    module: 'excess-order',
    domain: 'kiem-soat-dat-hang-thua',
    affected_test_case_count: 1,
    observation_count: 1,
    recurrence_count: 0,
    first_seen_at: '2026-09-01T00:00:00.000Z',
    last_seen_at: '2026-09-05T00:00:00.000Z',
    defect_signature_id: null,
    redmine_issue_count: 0,
    updated_at: '2026-09-05T00:00:00.000Z',
    source_summary: 'mâu thuẫn công thức Mất cost',
    user_summary: null,
    decision: null,
    decision_by: null,
    decision_at: null,
    resolution: null,
    resolution_type: null,
    resolved_by: null,
    resolved_at: null,
    verification_note: null,
    verified_by: null,
    verified_at: null,
    verification_run_id: null,
    affected_test_cases: [
      {
        test_case_id: 'TC-KSDH-A05',
        scenario_key: 'xpkg-excess-total',
        title: 'Kiểm soát đặt hàng thừa — tổng gói',
        observation_count: 1,
      },
    ],
    affected_runs: [
      {
        run_id: 'run-mtmleirb-n2fcjq',
        result: 'PARTIAL',
        environment: 'qa',
        started_at: '2026-09-05T00:00:00.000Z',
        observation_count: 1,
      },
    ],
    observations: [
      {
        id: '1',
        resolution_issue_id: '7',
        run_id: 'run-mtmleirb-n2fcjq',
        test_case_id: 'TC-KSDH-A05',
        scenario_key: 'xpkg-excess-total',
        check_sequence: 4,
        check_test_id: 'TC-KSDH-A05 / A4',
        check_label: 'A4 — S6: cách hiểu đúng của Mất cost',
        observation_key: 'check:4',
        observed_result: 'NOT_EVALUATED',
        raw_reason: 'BA chưa chọn cách hoà và scenario KHÔNG được tự chọn.',
        observed_at: '2026-09-05T00:00:00.000Z',
        created_at: '2026-09-05T00:00:00.000Z',
        run_result: 'PARTIAL',
      },
    ],
    redmine_links: [],
    defect: null,
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderIssue(issue: ResolutionIssueDetailResponseDto) {
  return render(
    <MemoryRouter>
      <ResolutionObservations issue={issue} />
    </MemoryRouter>,
  );
}

describe('ResolutionObservations', () => {
  it('marks a NOT_EVALUATED observation as unscoreable, never as passed', () => {
    renderIssue(makeIssue());

    expect(
      screen.getByLabelText('Not evaluated — this assertion could not be scored'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Passed')).not.toBeInTheDocument();
  });

  it('shows the assertion id, the run and the verbatim reason', () => {
    renderIssue(makeIssue());

    expect(screen.getByText('TC-KSDH-A05 / A4')).toBeInTheDocument();
    expect(screen.getByText('run-mtmleirb-n2fcjq')).toBeInTheDocument();
    expect(
      screen.getByText('BA chưa chọn cách hoà và scenario KHÔNG được tự chọn.'),
    ).toBeInTheDocument();
  });

  it('labels a run-level blocker by its result rather than as a check', () => {
    const issue = makeIssue();
    issue.observations = [
      {
        ...issue.observations[0],
        check_sequence: null,
        check_test_id: null,
        check_label: null,
        observation_key: 'run:blocked',
        observed_result: 'BLOCKED',
      },
    ];

    renderIssue(issue);

    expect(screen.getByText('run-level')).toBeInTheDocument();
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
  });

  it('renders reason text as text, not as markup', () => {
    const issue = makeIssue();
    issue.observations[0].raw_reason = 'expected <b>bold</b> & "quoted"';

    const { container } = renderIssue(issue);

    expect(screen.getByText('expected <b>bold</b> & "quoted"')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('lists the affected test cases with their occurrence counts', () => {
    renderIssue(makeIssue());

    expect(screen.getByRole('link', { name: 'TC-KSDH-A05' })).toBeInTheDocument();
    expect(screen.getByText('xpkg-excess-total')).toBeInTheDocument();
    expect(screen.getByText(/1 run\(s\), 1 occurrence\(s\)/)).toBeInTheDocument();
  });
});
