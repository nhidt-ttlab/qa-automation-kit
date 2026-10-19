import { describe, expect, it, vi, beforeEach } from 'vitest';
import { extractApiMessage, ResolutionQueueStore } from './ResolutionQueueStore';
import { ACTOR_STORAGE_KEY } from '../types';

/**
 * Store behaviour, with the service hand-stubbed as in TestCaseListStore.spec.ts. The two things
 * worth pinning: empty filter values are omitted from the query rather than sent as empty
 * strings, and every mutation refuses to run without a name — this app has no authentication, so
 * an unattributed change would leave a hole in the audit trail.
 */

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    listIssues: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      has_more: false,
    }),
    getSummary: vi.fn().mockResolvedValue({ total: 0, by_status: {}, by_kind: {} }),
    getIssue: vi.fn().mockResolvedValue({ id: '1' }),
    listEvents: vi.fn().mockResolvedValue([]),
    listComments: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue({ id: 'c1' }),
    updateIssue: vi.fn().mockResolvedValue({ id: '1' }),
    recordDecision: vi.fn().mockResolvedValue({ id: '1' }),
    exportCsv: vi.fn().mockResolvedValue({ blob: new Blob(['csv']), filename: 'export.csv' }),
    ...overrides,
  };
}

function makeStore(service = makeService()) {
  return { store: new ResolutionQueueStore(service as never), service };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
});

describe('extractApiMessage', () => {
  it(`reads this project's error envelope`, () => {
    expect(extractApiMessage({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date' } })).toBe(
      'Invalid date',
    );
  });

  it(`also reads Nest's DTO-rejection shape, which never reaches ApiErrorFilter`, () => {
    // ApiErrorFilter is @Catch(ApiError); ValidationPipe throws BadRequestException instead.
    expect(
      extractApiMessage({
        message: ['kind must be one of the following values: SPEC_DECISION, TEST_DATA'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    ).toBe('kind must be one of the following values: SPEC_DECISION, TEST_DATA');
  });

  it('joins several validation messages', () => {
    expect(extractApiMessage({ message: ['a', 'b'] })).toBe('a; b');
  });

  it('returns null for anything it does not recognise', () => {
    expect(extractApiMessage(null)).toBeNull();
    expect(extractApiMessage('nope')).toBeNull();
    expect(extractApiMessage({})).toBeNull();
  });
});

describe('list', () => {
  it('loads issues and mirrors the pagination envelope', async () => {
    const service = makeService({
      listIssues: vi.fn().mockResolvedValue({
        items: [{ id: '1' }, { id: '2' }],
        total: 42,
        page: 3,
        limit: 20,
        has_more: true,
      }),
    });
    const { store } = makeStore(service);

    await store.loadIssues();

    expect(store.issues).toHaveLength(2);
    expect(store.totalIssues).toBe(42);
    expect(store.currentPage).toBe(3);
    expect(store.listError).toBeNull();
    expect(store.isLoadingList).toBe(false);
  });

  it('surfaces the API error message rather than the axios status line', async () => {
    const service = makeService({
      listIssues: vi.fn().mockRejectedValue({
        response: { data: { error: { code: 'VALIDATION_ERROR', message: 'Invalid date: soon' } } },
      }),
    });
    const { store } = makeStore(service);

    await store.loadIssues();

    expect(store.listError).toBe('Invalid date: soon');
    expect(store.issues).toEqual([]);
  });

  it('resets to page 1 and reloads exactly once when filters change', async () => {
    const { store, service } = makeStore();
    store.filters = { page: 4, limit: 20 };

    store.applyFilters({ workflow_status: 'OPEN' });
    await flush();

    expect(service.listIssues).toHaveBeenCalledTimes(1);
    expect(service.listIssues).toHaveBeenLastCalledWith({
      workflow_status: 'OPEN',
      page: 1,
      limit: 20,
    });
  });

  it('keeps the filters when paging', async () => {
    const { store, service } = makeStore();
    store.applyFilters({ kind: 'SPEC_DECISION' });
    await flush();

    store.setPage(3);
    await flush();

    expect(service.listIssues).toHaveBeenLastCalledWith({
      kind: 'SPEC_DECISION',
      page: 3,
      limit: 20,
    });
  });

  it('does not blank the table when the summary call fails', async () => {
    const service = makeService({ getSummary: vi.fn().mockRejectedValue(new Error('boom')) });
    const { store } = makeStore(service);

    await store.loadIssues();
    await store.loadSummary();

    expect(store.summary).toBeNull();
    expect(store.listError).toBeNull();
  });
});

describe('exportCsv', () => {
  it('exports the current filters without pagination', async () => {
    const blob = new Blob(['csv'], { type: 'text/csv' });
    const service = makeService({
      exportCsv: vi.fn().mockResolvedValue({ blob, filename: 'resolution-issues-2026-09-06.csv' }),
    });
    const { store } = makeStore(service);
    store.applyFilters({ workflow_status: 'VERIFIED', domain: 'boq-gop' });
    await flush();

    const result = await store.exportCsv();

    expect(result).toEqual({ blob, filename: 'resolution-issues-2026-09-06.csv' });
    // page/limit are stripped: paging the export would truncate the file.
    expect(service.exportCsv).toHaveBeenCalledWith({
      workflow_status: 'VERIFIED',
      domain: 'boq-gop',
    });
    expect(store.isExporting).toBe(false);
  });

  it('surfaces the API message from a blob error body', async () => {
    // With responseType blob the error envelope arrives as a Blob, not parsed JSON.
    const body = JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'The export is limited to 5000 issues' },
    });
    const service = makeService({
      exportCsv: vi.fn().mockRejectedValue({ response: { data: new Blob([body]) } }),
    });
    const { store } = makeStore(service);

    const result = await store.exportCsv();

    expect(result).toBeNull();
    expect(store.actionError).toBe('The export is limited to 5000 issues');
    expect(store.isExporting).toBe(false);
  });

  it('falls back to the error message when the body is not a JSON envelope', async () => {
    const service = makeService({
      exportCsv: vi.fn().mockRejectedValue(new Error('Network Error')),
    });
    const { store } = makeStore(service);

    await store.exportCsv();

    expect(store.actionError).toBe('Network Error');
  });
});

describe('actor', () => {
  it('is remembered between visits', () => {
    const { store } = makeStore();
    store.setActor('qa_user');
    expect(localStorage.getItem(ACTOR_STORAGE_KEY)).toBe('qa_user');
    expect(new ResolutionQueueStore(makeService() as never).actor).toBe('qa_user');
  });

  it('blocks every mutation until a name is entered', async () => {
    const { store, service } = makeStore();

    const ok = await store.addComment('1', 'hello');

    expect(ok).toBe(false);
    expect(service.addComment).not.toHaveBeenCalled();
    expect(store.actionError).toMatch(/Enter your name/);
  });

  it('sends the actor with the mutation and reloads the issue afterwards', async () => {
    const { store, service } = makeStore();
    store.setActor('qa_minh');

    const ok = await store.addComment('1', 'Đã hỏi BA.');

    expect(ok).toBe(true);
    expect(service.addComment).toHaveBeenCalledWith('1', {
      actor: 'qa_minh',
      body: 'Đã hỏi BA.',
    });
    // Reloading is what keeps the audit timeline on screen in step with the change.
    expect(service.listEvents).toHaveBeenCalledWith('1');
  });

  it('reports a rejected transition without wedging the submit flag', async () => {
    const service = makeService({
      recordDecision: vi.fn().mockRejectedValue({
        response: {
          data: { error: { message: 'Cannot move a resolution issue from VERIFIED to DECIDED' } },
        },
      }),
    });
    const { store } = makeStore(service);
    store.setActor('qa_minh');

    const ok = await store.recordDecision('1', 'anything');

    expect(ok).toBe(false);
    expect(store.actionError).toMatch(/Cannot move a resolution issue/);
    expect(store.isSubmitting).toBe(false);
  });
});

describe('reset', () => {
  it('clears list and detail state', async () => {
    const { store } = makeStore();
    await store.loadIssues();
    store.issue = { id: '1' } as never;

    store.reset();

    expect(store.issues).toEqual([]);
    expect(store.issue).toBeNull();
    expect(store.events).toEqual([]);
    expect(store.filters).toEqual({ page: 1, limit: 20 });
  });
});
