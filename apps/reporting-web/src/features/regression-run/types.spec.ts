/**
 * `draftToRequest` is where the form's "empty means all" convention meets a backend that treats an
 * empty array as a real filter. Every test here protects a value that must be OMITTED rather than
 * sent — the difference between "run everything" and "run nothing", and between letting the runner
 * pick a cleanup default and overriding it.
 */
import { describe, expect, it } from 'vitest';
import {
  countChangedAdvanced,
  createEmptyDraft,
  customEnvFromDraft,
  draftFromSearchParams,
  draftToRequest,
  isLiveStatus,
  JOB_STATUS_TONE,
  rerunSearchParams,
  selectorLabel,
} from './types';
import type { RegressionJobSummaryResponseDto } from '@qakit/reporting-shared';

describe('createEmptyDraft', () => {
  it('defaults clean to "all", which is what makes the preview dialog non-skippable', () => {
    expect(createEmptyDraft().clean).toBe('all');
  });
});

describe('draftToRequest', () => {
  it('omits empty strings and empty arrays rather than sending them', () => {
    const request = draftToRequest(createEmptyDraft(), 'tester');
    expect(request.kind).toBeUndefined();
    expect(request.modules).toBeUndefined();
    expect(request.test_case_ids).toBeUndefined();
    expect(request.grep).toBeUndefined();
  });

  it('sends the selection when there is one', () => {
    const draft = { ...createEmptyDraft(), kind: 'ui' as const, modules: ['kho'], grep: ' x ' };
    const request = draftToRequest(draft, 'tester');
    expect(request).toMatchObject({ kind: 'ui', modules: ['kho'], grep: 'x' });
  });

  it('keeps cleanup tri-state: null is omitted, false is sent', () => {
    // Flattening null to false would emit --no-cleanup on every write run and leave unmarked rows
    // in shared UAT.
    expect(draftToRequest(createEmptyDraft(), 't').cleanup).toBeUndefined();
    expect(
      draftToRequest({ ...createEmptyDraft(), cleanup: false }, 't').cleanup,
    ).toBe(false);
    expect(draftToRequest({ ...createEmptyDraft(), cleanup: true }, 't').cleanup).toBe(true);
  });

  it('omits clean_scope for "none" and never confirms a clean-all it was not asked for', () => {
    const none = draftToRequest({ ...createEmptyDraft(), clean: 'none' }, 't');
    expect(none.clean_scope).toBeUndefined();
    expect(none.confirm_clean_all).toBeUndefined();

    const run = draftToRequest({ ...createEmptyDraft(), clean: 'run' }, 't');
    expect(run.clean_scope).toBe('run');
    expect(run.confirm_clean_all).toBeUndefined();

    const all = draftToRequest({ ...createEmptyDraft(), clean: 'all' }, 't');
    expect(all.clean_scope).toBe('all');
    expect(all.confirm_clean_all).toBe(true);
  });
});

describe('countChangedAdvanced', () => {
  it('is zero for a fresh draft and counts each non-default flag', () => {
    expect(countChangedAdvanced(createEmptyDraft())).toBe(0);
    expect(
      countChangedAdvanced({ ...createEmptyDraft(), writeMode: true, bail: true }),
    ).toBe(2);
  });
});

describe('the Rerun URL contract', () => {
  it('round-trips a selection through query params', () => {
    const query = rerunSearchParams(['TC-DH-L01', 'TC-DH-L02'], 'ui');
    const patch = draftFromSearchParams(new URLSearchParams(query));
    expect(patch.testCaseIds).toEqual(['TC-DH-L01', 'TC-DH-L02']);
    expect(patch.kind).toBe('ui');
  });

  it('uppercases ids and ignores a kind the runner would reject', () => {
    const patch = draftFromSearchParams(new URLSearchParams('tc=tc-dh-l01&kind=both'));
    expect(patch.testCaseIds).toEqual(['TC-DH-L01']);
    expect(patch.kind).toBeUndefined();
  });
});

describe('status presentation', () => {
  it('treats SYNCING as still in flight, not as success', () => {
    // The batch is over but the reporting database does not have it yet, so the user's next click
    // would come up empty. A green chip there would be a lie about where the data is.
    expect(isLiveStatus('SYNCING')).toBe(true);
    expect(JOB_STATUS_TONE.SYNCING).toBe('info');
  });

  it('distinguishes a cancelled run from a failed one', () => {
    expect(JOB_STATUS_TONE.CANCELLED).toBe('neutral');
    expect(JOB_STATUS_TONE.FAILED).toBe('error');
  });

  it('marks terminal statuses as not live', () => {
    expect(isLiveStatus('SUCCEEDED')).toBe(false);
    expect(isLiveStatus('ORPHANED')).toBe(false);
  });
});

describe('selectorLabel', () => {
  const job = (over: Partial<RegressionJobSummaryResponseDto> = {}) =>
    ({
      kind: null,
      modules: [],
      test_case_ids: [],
      grep: null,
      ...over,
    }) as RegressionJobSummaryResponseDto;

  it('reads "all" for an empty selector', () => {
    expect(selectorLabel(job())).toBe('all');
  });

  it('joins the facets that are set', () => {
    expect(selectorLabel(job({ kind: 'ui', modules: ['kho', 'don-hang'] }))).toBe(
      'ui · kho, don-hang',
    );
  });
});

describe('custom parameters', () => {
  it('omits the key entirely when no row has a name', () => {
    // Same convention as every other selector here: an empty value is not "no filter" to a
    // backend that receives it, so it is not sent at all.
    const draft = createEmptyDraft();
    expect(customEnvFromDraft(draft)).toBeUndefined();
    draft.customParams = [{ key: '  ', value: 'orphan' }];
    expect(customEnvFromDraft(draft)).toBeUndefined();
    expect(draftToRequest(draft, 'me').custom_env).toBeUndefined();
  });

  it('upper-cases names, trims them, and keeps a blank value', () => {
    const draft = createEmptyDraft();
    draft.customParams = [
      { key: ' replace_material_project_ids ', value: 'guid-1,guid-2' },
      { key: 'FIXTURE', value: '' },
    ];
    expect(customEnvFromDraft(draft)).toEqual({
      REPLACE_MATERIAL_PROJECT_IDS: 'guid-1,guid-2',
      FIXTURE: '',
    });
  });

  it('counts as one changed advanced flag however many rows there are', () => {
    const draft = createEmptyDraft();
    expect(countChangedAdvanced(draft)).toBe(0);
    draft.customParams = [
      { key: 'A_ONE', value: '1' },
      { key: 'B_TWO', value: '2' },
    ];
    expect(countChangedAdvanced(draft)).toBe(1);
  });

  it('reads repeated ?param= pairs, splitting on the first = only', () => {
    // A value routinely contains '=' - a URL with a query string, a connection fragment - and
    // splitting on the last one would silently truncate it.
    const patch = draftFromSearchParams(
      new URLSearchParams('param=FOO=1&param=BASE_URL=https://x/y?a=b&param=&param=BARE'),
    );
    expect(patch.customParams).toEqual([
      { key: 'FOO', value: '1' },
      { key: 'BASE_URL', value: 'https://x/y?a=b' },
      { key: 'BARE', value: '' },
    ]);
  });
});
