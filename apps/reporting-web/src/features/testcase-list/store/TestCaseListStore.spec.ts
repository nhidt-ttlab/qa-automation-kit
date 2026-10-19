import { describe, it, expect, vi } from 'vitest';
import type { TestCaseListItemResponseDto } from '@qakit/reporting-shared';

import { TestCaseListStore } from './TestCaseListStore';

function makeTestCase(id: string): TestCaseListItemResponseDto {
  return {
    id,
    scenario_key: 'scenario-1',
    title: `Test Case ${id}`,
    status: 'active',
    run_type: 'api',
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    total_run_count: 0,
  };
}

describe('TestCaseListStore', () => {
  it('loads test cases and updates pagination state', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({
        items: [makeTestCase('tc-1'), makeTestCase('tc-2')],
        total: 2,
        page: 1,
        limit: 20,
        has_more: false,
      }),
    };
    const store = new TestCaseListStore(service as never);

    await store.loadTestCases();

    expect(store.testCases).toHaveLength(2);
    expect(store.totalTestCases).toBe(2);
    expect(store.currentPage).toBe(1);
    expect(store.isLoadingList).toBe(false);
    expect(store.listError).toBeNull();
  });

  it('sends domain only when set, and omits it once cleared', async () => {
    const listTestCases = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      has_more: false,
    });
    const store = new TestCaseListStore({ listTestCases } as never);

    await store.loadTestCases();
    expect(listTestCases.mock.calls[0]![0]).not.toHaveProperty('domain');
    // Module and feature_id are no longer offered by this list, so they must never be sent.
    expect(listTestCases.mock.calls[0]![0]).not.toHaveProperty('module');
    expect(listTestCases.mock.calls[0]![0]).not.toHaveProperty('feature_id');

    store.applyFilters({ domain: 'kho-bao-cao-kho' });
    await vi.waitFor(() => expect(listTestCases).toHaveBeenCalledTimes(2));
    expect(listTestCases.mock.calls[1]![0]).toMatchObject({
      domain: 'kho-bao-cao-kho',
      page: 1,
    });

    // The empty string is the "All" option, not a filter for the empty domain.
    store.applyFilters({ domain: '' });
    await vi.waitFor(() => expect(listTestCases).toHaveBeenCalledTimes(3));
    expect(listTestCases.mock.calls[2]![0]).not.toHaveProperty('domain');
  });

  it('sends csv_checklist_id and csv_testcase_id trimmed, only when set, and omits them once cleared', async () => {
    const listTestCases = vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      has_more: false,
    });
    const store = new TestCaseListStore({ listTestCases } as never);

    await store.loadTestCases();
    expect(listTestCases.mock.calls[0]![0]).not.toHaveProperty('csv_checklist_id');
    expect(listTestCases.mock.calls[0]![0]).not.toHaveProperty('csv_testcase_id');

    // Typed fields: surrounding whitespace is noise, not part of the id.
    store.applyFilters({ csvChecklistId: '  QLDN-VT-04 ', csvTestcaseId: ' TC_16  ' });
    await vi.waitFor(() => expect(listTestCases).toHaveBeenCalledTimes(2));
    expect(listTestCases.mock.calls[1]![0]).toMatchObject({
      csv_checklist_id: 'QLDN-VT-04',
      csv_testcase_id: 'TC_16',
      page: 1,
    });

    // Either half can stand alone: a checklist without a row lists every case answering the sheet.
    store.applyFilters({ csvTestcaseId: '' });
    await vi.waitFor(() => expect(listTestCases).toHaveBeenCalledTimes(3));
    expect(listTestCases.mock.calls[2]![0]).toMatchObject({ csv_checklist_id: 'QLDN-VT-04' });
    expect(listTestCases.mock.calls[2]![0]).not.toHaveProperty('csv_testcase_id');

    // A field cleared to whitespace is "no filter", not a search for blanks.
    store.applyFilters({ csvChecklistId: '   ' });
    await vi.waitFor(() => expect(listTestCases).toHaveBeenCalledTimes(4));
    expect(listTestCases.mock.calls[3]![0]).not.toHaveProperty('csv_checklist_id');
    expect(listTestCases.mock.calls[3]![0]).not.toHaveProperty('csv_testcase_id');
  });

  it('sets an error message when loading fails', async () => {
    const service = {
      listTestCases: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const store = new TestCaseListStore(service as never);

    await store.loadTestCases();

    expect(store.listError).toBe('network down');
    expect(store.testCases).toHaveLength(0);
    expect(store.isLoadingList).toBe(false);
  });

  it('setPage updates currentPage and reloads', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 2,
        limit: 20,
        has_more: false,
      }),
    };
    const store = new TestCaseListStore(service as never);

    store.setPage(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.listTestCases).toHaveBeenCalledWith({ page: 2, limit: 20, run_type: 'api' });
  });

  it('reset clears all state', () => {
    const service = { listTestCases: vi.fn() };
    const store = new TestCaseListStore(service as never);
    store.testCases = [makeTestCase('tc-1')];
    store.totalTestCases = 1;
    store.currentPage = 3;
    store.listError = 'oops';
    store.searchText = 'foo';
    store.latestRunResult = 'FAIL';
    store.domain = 'kho';
    store.csvChecklistId = 'QLDN-VT-04';
    store.csvTestcaseId = 'TC_16';

    store.reset();

    expect(store.testCases).toHaveLength(0);
    expect(store.totalTestCases).toBe(0);
    expect(store.currentPage).toBe(1);
    expect(store.listError).toBeNull();
    expect(store.searchText).toBe('');
    expect(store.latestRunResult).toBe('all');
    expect(store.domain).toBe('');
    expect(store.csvChecklistId).toBe('');
    expect(store.csvTestcaseId).toBe('');
  });

  it('setSearchText sends a trimmed q and resets to page 1', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);
    store.setPage(3);
    await Promise.resolve();
    await Promise.resolve();

    store.setSearchText('  login  ');
    await Promise.resolve();
    await Promise.resolve();

    expect(store.currentPage).toBe(1);
    expect(service.listTestCases).toHaveBeenLastCalledWith({ page: 1, limit: 20, run_type: 'api', q: 'login' });
  });

  it('setSearchText with a blank value omits q', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);

    store.setSearchText('   ');
    await Promise.resolve();
    await Promise.resolve();

    expect(service.listTestCases).toHaveBeenLastCalledWith({ page: 1, limit: 20, run_type: 'api' });
  });

  it('setLatestRunResult sends latest_run_result when not "all" and resets to page 1', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);
    store.setPage(2);
    await Promise.resolve();
    await Promise.resolve();

    store.setLatestRunResult('FAIL');
    await Promise.resolve();
    await Promise.resolve();

    expect(store.currentPage).toBe(1);
    expect(service.listTestCases).toHaveBeenLastCalledWith({ page: 1, limit: 20, run_type: 'api', latest_run_result: 'FAIL' });
  });

  it('setLatestRunResult("all") omits latest_run_result', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);

    store.setLatestRunResult('all');
    await Promise.resolve();
    await Promise.resolve();

    expect(service.listTestCases).toHaveBeenLastCalledWith({ page: 1, limit: 20, run_type: 'api' });
  });

  it('applyFilters merges searchText and latestRunResult without clobbering each other', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);

    store.applyFilters({ searchText: 'login' });
    await Promise.resolve();
    await Promise.resolve();
    store.applyFilters({ latestRunResult: 'FAIL' });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.listTestCases).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
      run_type: 'api',
      q: 'login',
      latest_run_result: 'FAIL',
    });
  });

  it('applyFilters triggers exactly one reload even when both fields change together', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);
    const callsBefore = service.listTestCases.mock.calls.length;

    store.applyFilters({ searchText: 'login', latestRunResult: 'FAIL' });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.listTestCases.mock.calls.length - callsBefore).toBe(1);
  });

  it('setPage preserves active filters', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 2, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);
    store.applyFilters({ searchText: 'login', latestRunResult: 'FAIL' });
    await Promise.resolve();
    await Promise.resolve();

    store.setPage(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.listTestCases).toHaveBeenLastCalledWith({
      page: 2,
      limit: 20,
      run_type: 'api',
      q: 'login',
      latest_run_result: 'FAIL',
    });
  });

  it('defaults to the API tab', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);
    await store.loadTestCases();

    expect(store.runType).toBe('api');
    expect(service.listTestCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ run_type: 'api' }),
    );
  });

  it('setRunType switches tab, resets to page 1 and reloads exactly once', async () => {
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);
    store.setPage(3);
    await Promise.resolve();
    await Promise.resolve();
    const callsBefore = service.listTestCases.mock.calls.length;

    store.setRunType('ui');
    await Promise.resolve();
    await Promise.resolve();

    expect(service.listTestCases.mock.calls.length - callsBefore).toBe(1);
    expect(service.listTestCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ run_type: 'ui', page: 1 }),
    );
  });

  it('setRunType is a no-op when the tab is already active', async () => {
    // The page mirrors the tab into the URL and reads it back through an effect, so this can
    // be called with an unchanged value on every render. It must not refetch.
    const service = {
      listTestCases: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    };
    const store = new TestCaseListStore(service as never);
    const callsBefore = service.listTestCases.mock.calls.length;

    store.setRunType('api');
    await Promise.resolve();
    await Promise.resolve();

    expect(service.listTestCases.mock.calls.length).toBe(callsBefore);
  });
});
