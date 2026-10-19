import { describe, it, expect, vi } from 'vitest';
import type { TestCaseDetailResponseDto, TestRunListItemResponseDto } from '@qakit/reporting-shared';

import { TestCaseDetailStore } from './TestCaseDetailStore';

function makeTestCase(): TestCaseDetailResponseDto {
  return {
    id: 'tc-1',
    scenario_key: 'scenario-1',
    title: 'Test Case 1',
    status: 'active',
    run_type: 'api',
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    total_run_count: 1,
  };
}

function makeRun(): TestRunListItemResponseDto {
  return {
    id: 'run-1',
    test_case_id: 'tc-1',
    scenario_key: 'scenario-1',
    environment: 'staging',
    dry_run: false,
    result: 'PASS',
    run_type: 'api',
    started_at: '2026-01-02T00:00:00Z',
    overview_key_data: [],
    overview_highlights: [],
    payloads: [],
    tags: [],
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  };
}

describe('TestCaseDetailStore', () => {
  it('loadTestCase populates selectedTestCase', async () => {
    const service = {
      getTestCase: vi.fn().mockResolvedValue(makeTestCase()),
      getTestCaseRuns: vi.fn(),
    };
    const store = new TestCaseDetailStore(service as never);

    await store.loadTestCase('tc-1');

    expect(store.selectedTestCase?.id).toBe('tc-1');
    expect(store.isLoading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('loadTestCase sets an error message on failure', async () => {
    const service = {
      getTestCase: vi.fn().mockRejectedValue(new Error('not found')),
      getTestCaseRuns: vi.fn(),
    };
    const store = new TestCaseDetailStore(service as never);

    await store.loadTestCase('tc-1');

    expect(store.error).toBe('not found');
    expect(store.selectedTestCase).toBeNull();
  });

  it('loadRunHistory populates runs and pagination', async () => {
    const service = {
      getTestCase: vi.fn(),
      getTestCaseRuns: vi.fn().mockResolvedValue({
        items: [makeRun()],
        total: 1,
        page: 1,
        limit: 20,
        has_more: false,
      }),
    };
    const store = new TestCaseDetailStore(service as never);

    await store.loadRunHistory('tc-1', 1);

    expect(store.runs).toHaveLength(1);
    expect(store.totalRuns).toBe(1);
    expect(store.isLoadingRuns).toBe(false);
    expect(store.runsError).toBeNull();
  });

  it('setPage re-fetches run history for the currently loaded test case', async () => {
    const service = {
      getTestCase: vi.fn(),
      getTestCaseRuns: vi.fn().mockResolvedValue({ items: [], total: 0, page: 2, limit: 20, has_more: false }),
    };
    const store = new TestCaseDetailStore(service as never);

    await store.loadRunHistory('tc-1', 1);
    store.setPage(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getTestCaseRuns).toHaveBeenLastCalledWith('tc-1', { page: 2, limit: 20 });
  });

  it('reset clears both detail and run-history state', () => {
    const service = { getTestCase: vi.fn(), getTestCaseRuns: vi.fn() };
    const store = new TestCaseDetailStore(service as never);
    store.selectedTestCase = makeTestCase();
    store.runs = [makeRun()];
    store.totalRuns = 1;
    store.error = 'x';
    store.runsError = 'y';

    store.reset();

    expect(store.selectedTestCase).toBeNull();
    expect(store.runs).toHaveLength(0);
    expect(store.totalRuns).toBe(0);
    expect(store.error).toBeNull();
    expect(store.runsError).toBeNull();
  });
});
