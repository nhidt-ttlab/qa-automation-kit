/**
 * Store tests. Service is a hand-stubbed object of vi.fn()s cast `as never`, the shape every other
 * store spec here uses — no vi.mock, no mocking library.
 *
 * The console tests are the important ones: sequence dedupe is what makes a reconnect lossless,
 * and the ring buffer is what keeps a 566-scenario batch from growing the DOM without bound.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegressionRunStore } from './RegressionRunStore';
import { MAX_CONSOLE_LINES } from '../types';

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    getOptions: vi.fn().mockResolvedValue({
      environments: ['qa'],
      module_tokens: ['kho'],
      scenarios: [],
      runner_available: true,
      runner_unavailable_reason: null,
    }),
    listJobs: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, has_more: false }),
    getJob: vi.fn().mockResolvedValue({ id: 1, status: 'SUCCEEDED' }),
    preview: vi.fn().mockResolvedValue({
      total: 3,
      items: [],
      label: 'kho',
      known_module_tokens: [],
      warnings: [],
    }),
    createJob: vi.fn().mockResolvedValue({ id: 42 }),
    cancelJob: vi.fn().mockResolvedValue({ id: 1, status: 'CANCELLED' }),
    getLog: vi.fn().mockResolvedValue({ job_id: 1, lines: [], next_seq: 0, total: 0, status: 'SUCCEEDED' }),
    streamUrl: vi.fn().mockReturnValue('http://api/stream'),
    getWorkspace: vi.fn().mockResolvedValue(workspaceStatus()),
    syncWorkspace: vi.fn().mockResolvedValue(syncResult()),
    ...overrides,
  };
}

function workspaceStatus(overrides: Record<string, unknown> = {}) {
  return {
    runner_root: '/srv/tests/runner',
    repo_root: '/srv',
    is_git_repo: true,
    branch: 'develop',
    upstream: 'origin/develop',
    head_sha: 'a3429e29ffffffff',
    head_short_sha: 'a3429e29',
    head_subject: 'Merge branch x',
    head_committed_at: '2026-10-08T05:14:07+00:00',
    dirty_file_count: 0,
    sync_in_progress: false,
    last_sync: null,
    ...overrides,
  };
}

function syncResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'updated',
    requested_by: 'tester',
    started_at: '2026-10-08T06:00:00.000Z',
    finished_at: '2026-10-08T06:00:04.000Z',
    duration_ms: 4000,
    branch: 'develop',
    before_sha: 'a3429e29ffffffff',
    after_sha: 'b1b1b1b1ffffffff',
    commits_pulled: 2,
    changed_files: ['src/suites/kho/api/new.scenario.ts'],
    changed_file_count: 1,
    scenario_files_changed: 1,
    dependencies_changed: false,
    dependencies_installed: false,
    catalog_refreshed: true,
    message: 'Pulled 2 commits, 1 file changed under the runner, 1 scenario script.',
    output: 'Updating a3429e29..b1b1b1b1',
    ...overrides,
  };
}

function makeStore(overrides: Record<string, unknown> = {}) {
  return new RegressionRunStore(makeService(overrides) as never);
}

/** The store batches lines onto a timer; tests flush by closing the stream. */
function flushConsole(store: RegressionRunStore) {
  store.closeStream();
}

function line(seq: number, text = `line ${seq}`) {
  return { seq, ts: '2026-09-07T00:00:00.000Z', stream: 'runner' as const, text };
}

beforeEach(() => {
  localStorage.clear();
});

describe('slice isolation', () => {
  it('a failed preview leaves the job list and its error untouched', () => {
    const store = makeStore({ preview: vi.fn().mockRejectedValue(new Error('boom')) });
    void store.openPreview();
    expect(store.jobs).toEqual([]);
    expect(store.jobsError).toBeNull();
  });
});

describe('createJob', () => {
  it('returns the new id and closes the preview', async () => {
    const store = makeStore();
    store.setActor('tester');
    const id = await store.createJob();
    expect(id).toBe(42);
    expect(store.isPreviewOpen).toBe(false);
  });

  it('surfaces a 409 through actionError and keeps the active job id for "Watch it"', async () => {
    const store = makeStore({
      createJob: vi.fn().mockRejectedValue({
        response: {
          data: {
            error: {
              message: 'A regression run is already in progress.',
              details: { active_job_id: 17 },
            },
          },
        },
      }),
    });
    const id = await store.createJob();
    expect(id).toBeNull();
    expect(store.actionError).toBe('A regression run is already in progress.');
    expect(store.conflictJobId).toBe(17);
  });

  it('clears the conflict when the error is dismissed', async () => {
    const store = makeStore({
      createJob: vi.fn().mockRejectedValue({
        response: { data: { error: { message: 'x', details: { active_job_id: 5 } } } },
      }),
    });
    await store.createJob();
    store.clearActionError();
    expect(store.conflictJobId).toBeNull();
  });
});

describe('the console', () => {
  it('drops lines at or below lastSeq, so a replay overlap is idempotent', () => {
    const store = makeStore();
    const append = (n: number) =>
      (store as unknown as { appendLine: (l: unknown) => void }).appendLine(line(n));

    [1, 2, 3].forEach(append);
    // The reconnect replays from 2, overlapping two lines it already has.
    [2, 3, 4].forEach(append);
    flushConsole(store);

    expect(store.logLines.map((l) => l.seq)).toEqual([1, 2, 3, 4]);
  });

  it('caps the buffer and counts what it dropped, keeping the tail', () => {
    const store = makeStore();
    const append = (n: number) =>
      (store as unknown as { appendLine: (l: unknown) => void }).appendLine(line(n));

    for (let i = 1; i <= MAX_CONSOLE_LINES + 10; i++) append(i);
    flushConsole(store);

    expect(store.logLines).toHaveLength(MAX_CONSOLE_LINES);
    expect(store.droppedLineCount).toBe(10);
    // The tail is what anyone watches; the head is what the download is for.
    expect(store.logLines[0].seq).toBe(11);
    expect(store.logLines[store.logLines.length - 1].seq).toBe(MAX_CONSOLE_LINES + 10);
  });

  it('sets streamError instead of throwing where EventSource does not exist', () => {
    // jsdom has no EventSource, and neither does every browser.
    const store = makeStore();
    expect(() => store.openStream(1)).not.toThrow();
    expect(store.streamError).toMatch(/not available/i);
  });

  it('closeStream is safe to call twice', () => {
    const store = makeStore();
    store.closeStream();
    expect(() => store.closeStream()).not.toThrow();
    expect(store.streamStatus).toBe('closed');
  });
});

describe('clearJob vs reset', () => {
  it('clearJob keeps the form draft; reset discards it', () => {
    // The draft lives in the store precisely so it survives a trip to the detail page and back.
    const store = makeStore();
    store.patchDraft({ modules: ['kho'], grep: 'receipt' });

    store.clearJob();
    expect(store.draft.modules).toEqual(['kho']);
    expect(store.draft.grep).toBe('receipt');

    store.reset();
    expect(store.draft.modules).toEqual([]);
    expect(store.draft.grep).toBe('');
  });
});

describe('actor', () => {
  it('persists so the next run does not ask again', () => {
    makeStore().setActor('qa_user');
    expect(new RegressionRunStore(makeService() as never).actor).toBe('qa_user');
  });

  it('blocks submit until a name is given', () => {
    const store = makeStore();
    expect(store.canSubmit).toBe(false);
    store.setActor('qa_user');
    expect(store.canSubmit).toBe(true);
  });
});

describe('loadOptions', () => {
  it('falls back to an environment the runner actually offers', async () => {
    const store = makeStore({
      getOptions: vi.fn().mockResolvedValue({
        environments: ['uat'],
        module_tokens: [],
        scenarios: [],
        runner_available: true,
        runner_unavailable_reason: null,
      }),
    });
    await store.loadOptions();
    expect(store.draft.environment).toBe('uat');
  });

  it('keeps reset, rerun and link patches on an offered environment', async () => {
    const store = makeStore({
      getOptions: vi.fn().mockResolvedValue({
        environments: ['local'],
        module_tokens: [],
        scenarios: [],
        runner_available: true,
        runner_unavailable_reason: null,
      }),
    });
    await store.loadOptions();
    store.resetDraft();
    expect(store.draft.environment).toBe('local');
    store.patchDraft({ environment: 'qa', grep: 'orders' });
    expect(store.draft).toMatchObject({ environment: 'local', grep: 'orders' });
    expect(store.defaultEnvironment).toBe('local');
  });

  it('reloads options before a preview when they were fetched while the runner was unavailable', async () => {
    const getOptions = vi
      .fn()
      .mockResolvedValueOnce({
        environments: [],
        module_tokens: [],
        scenarios: [],
        runner_available: false,
        runner_unavailable_reason: 'run-suite.ts not found',
      })
      .mockResolvedValue({
        environments: ['local'],
        module_tokens: [],
        scenarios: [],
        runner_available: true,
        runner_unavailable_reason: null,
      });
    const store = makeStore({ getOptions });
    await store.loadOptions();
    expect(store.draft.environment).toBe('qa');

    await store.openPreview();
    expect(getOptions).toHaveBeenCalledTimes(2);
    expect(store.draft.environment).toBe('local');
    store.setActor('tester');
    await store.createJob();
  });

  it('disables submit when the runner checkout is missing', async () => {
    const store = makeStore({
      getOptions: vi.fn().mockResolvedValue({
        environments: [],
        module_tokens: [],
        scenarios: [],
        runner_available: false,
        runner_unavailable_reason: 'not found',
      }),
    });
    await store.loadOptions();
    store.setActor('tester');
    expect(store.canSubmit).toBe(false);
  });
});

describe('workspace sync', () => {
  it('needs a name, a tracked git checkout and no live job', async () => {
    const store = makeStore();
    await store.loadWorkspace();
    expect(store.canSync).toBe(false);
    store.setActor('tester');
    expect(store.canSync).toBe(true);
  });

  it('is blocked when the branch has no upstream', async () => {
    const store = makeStore({
      getWorkspace: vi.fn().mockResolvedValue(workspaceStatus({ upstream: null })),
    });
    store.setActor('tester');
    await store.loadWorkspace();
    expect(store.canSync).toBe(false);
  });

  it('is blocked while a run is live', async () => {
    const store = makeStore({
      listJobs: vi.fn().mockResolvedValue({
        items: [{ id: 1, status: 'RUNNING' }],
        total: 1,
        page: 1,
        limit: 20,
        has_more: false,
      }),
    });
    store.setActor('tester');
    await store.loadWorkspace();
    await store.loadJobs();
    expect(store.canSync).toBe(false);
  });

  it('shows the last sync the API remembered', async () => {
    const remembered = syncResult({ requested_by: 'someone-else' });
    const store = makeStore({
      getWorkspace: vi.fn().mockResolvedValue(workspaceStatus({ last_sync: remembered })),
    });
    await store.loadWorkspace();
    expect(store.syncResult?.requested_by).toBe('someone-else');
  });

  it('records the result and reloads both the checkout and the catalog', async () => {
    const service = makeService();
    const store = new RegressionRunStore(service as never);
    store.setActor('tester');
    const result = await store.syncWorkspace();
    expect(result?.status).toBe('updated');
    expect(store.syncResult?.commits_pulled).toBe(2);
    expect(service.syncWorkspace).toHaveBeenCalledWith({ requested_by: 'tester' });
    // The catalog must be re-read so the new scenario is selectable.
    expect(service.getOptions).toHaveBeenCalledTimes(1);
    expect(service.getWorkspace).toHaveBeenCalledTimes(1);
    expect(store.isSyncing).toBe(false);
  });

  it('surfaces a refused sync as an action error and keeps the previous result', async () => {
    const store = makeStore({
      syncWorkspace: vi.fn().mockRejectedValue({
        response: { data: { error: { message: 'A regression run is in progress' } } },
      }),
    });
    store.setActor('tester');
    const result = await store.syncWorkspace();
    expect(result).toBeNull();
    expect(store.actionError).toMatch(/in progress/);
    expect(store.syncResult).toBeNull();
  });

  it('a failed pull is still a result, not an error', async () => {
    const store = makeStore({
      syncWorkspace: vi.fn().mockResolvedValue(
        syncResult({ status: 'failed', message: 'Not possible to fast-forward, aborting.' }),
      ),
    });
    store.setActor('tester');
    await store.syncWorkspace();
    expect(store.syncResult?.status).toBe('failed');
    expect(store.actionError).toBeNull();
  });
});
