import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ResolutionIssueSummaryResponseDto } from '@qakit/reporting-shared';
import { StoreProvider } from '../../../app/store/provider';
import type { RootStore } from '../../../app/store/RootStore';
import { FeatureDomainOptionsStore } from '../../../shared/store/FeatureDomainOptionsStore';
import { ResolutionQueueStore } from '../store/ResolutionQueueStore';
import { ResolutionQueuePage } from './ResolutionQueuePage';

/**
 * The four states a list page has to get right — loading, error, empty and populated — driven
 * through the real store rather than a mocked component, so the wiring between store flags and
 * `AsyncSection` is what is actually under test.
 *
 * `StoreProvider` takes a `store` prop precisely for this; it had no callers until now.
 */

function makeIssue(
  overrides: Partial<ResolutionIssueSummaryResponseDto> = {},
): ResolutionIssueSummaryResponseDto {
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
    affected_test_case_count: 50,
    observation_count: 224,
    recurrence_count: 0,
    first_seen_at: '2026-09-01T00:00:00.000Z',
    last_seen_at: '2026-09-05T00:00:00.000Z',
    defect_signature_id: null,
    redmine_issue_count: 0,
    updated_at: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(service: Record<string, unknown>) {
  const store = new ResolutionQueueStore(service as never);
  // The filter bar's Feature select reads its options from the shared store.
  const featureDomainOptionsStore = new FeatureDomainOptionsStore({
    listTestCaseDomains: vi.fn().mockResolvedValue({ domains: [] }),
  });
  const root = { resolutionQueueStore: store, featureDomainOptionsStore } as unknown as RootStore;
  const result = render(
    <MemoryRouter>
      <StoreProvider store={root}>
        <ResolutionQueuePage />
      </StoreProvider>
    </MemoryRouter>,
  );
  return { ...result, store };
}

const emptyPage = { items: [], total: 0, page: 1, limit: 20, has_more: false };
const summary = {
  total: 0,
  by_status: {
    OPEN: 0,
    WAITING_FOR_DECISION: 0,
    DECIDED: 0,
    READY_FOR_RERUN: 0,
    VERIFIED: 0,
    RECURRED: 0,
    WONT_RESOLVE: 0,
  },
  by_kind: {
    SPEC_DECISION: 0,
    TEST_DATA: 0,
    ENVIRONMENT: 0,
    AUTOMATION: 0,
    MISSING_IMPLEMENTATION: 0,
    PRODUCT_DEFECT: 0,
    UNCLASSIFIED: 0,
  },
  by_domain: [],
  by_owner: [],
  oldest_unresolved: [],
};

describe('ResolutionQueuePage', () => {
  it('shows a spinner while the first page is in flight', async () => {
    const { store } = renderPage({
      listIssues: vi.fn(() => new Promise(() => {})),
      getSummary: vi.fn().mockResolvedValue(summary),
    });

    expect(store.isLoadingList).toBe(true);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the server error with a retry action', async () => {
    const listIssues = vi.fn().mockRejectedValue({
      response: { data: { error: { message: 'Invalid date: soon' } } },
    });
    renderPage({ listIssues, getSummary: vi.fn().mockResolvedValue(summary) });

    expect(await screen.findByText('Invalid date: soon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('explains the empty state instead of showing a bare table', async () => {
    renderPage({
      listIssues: vi.fn().mockResolvedValue(emptyPage),
      getSummary: vi.fn().mockResolvedValue(summary),
    });

    expect(await screen.findByText('No issues match these filters')).toBeInTheDocument();
  });

  it('renders a populated row with its key, counts and status', async () => {
    renderPage({
      listIssues: vi.fn().mockResolvedValue({ ...emptyPage, items: [makeIssue()], total: 1 }),
      getSummary: vi.fn().mockResolvedValue(summary),
    });

    expect(await screen.findByText('kiem-soat-dat-hang-thua:BL-03')).toBeInTheDocument();
    expect(screen.getByText('224')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    // Both also appear in the summary chip row above the table, so scope to the row.
    const row = screen.getByText('kiem-soat-dat-hang-thua:BL-03').closest('tr') as HTMLElement;
    expect(within(row).getByText('Open')).toBeInTheDocument();
    expect(within(row).getByText('Unclassified')).toBeInTheDocument();
  });

  it('flags an issue that came back after verification', async () => {
    renderPage({
      listIssues: vi.fn().mockResolvedValue({
        ...emptyPage,
        items: [makeIssue({ workflow_status: 'RECURRED', recurrence_count: 2 })],
        total: 1,
      }),
      getSummary: vi.fn().mockResolvedValue(summary),
    });

    expect(await screen.findByLabelText('Recurred')).toBeInTheDocument();
    expect(screen.getByText('Recurred')).toBeInTheDocument();
  });

  it('offers a CSV export of whatever the filters select', async () => {
    renderPage({
      listIssues: vi.fn().mockResolvedValue(emptyPage),
      getSummary: vi.fn().mockResolvedValue(summary),
    });

    const button = screen.getByRole('button', { name: 'Export CSV' });
    expect(button).toBeEnabled();
  });

  it('disables the export while one is already running', async () => {
    const { store } = renderPage({
      listIssues: vi.fn().mockResolvedValue(emptyPage),
      getSummary: vi.fn().mockResolvedValue(summary),
      exportCsv: vi.fn(() => new Promise(() => {})),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(store.isExporting).toBe(true);
    expect(await screen.findByRole('button', { name: 'Exporting…' })).toBeDisabled();
  });

  it('shows why an export was refused instead of failing silently', async () => {
    renderPage({
      listIssues: vi.fn().mockResolvedValue(emptyPage),
      getSummary: vi.fn().mockResolvedValue(summary),
      exportCsv: vi
        .fn()
        .mockRejectedValue(new Error('The export is limited to 5000 issues')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('The export is limited to 5000 issues')).toBeInTheDocument();
  });

  it('says plainly that these are not confirmed product defects', async () => {
    renderPage({
      listIssues: vi.fn().mockResolvedValue(emptyPage),
      getSummary: vi.fn().mockResolvedValue(summary),
    });

    expect(screen.getByText(/not confirmed product defects/i)).toBeInTheDocument();
  });
});
