import { describe, it, expect, vi } from 'vitest';

import { FeatureDomainOptionsStore } from './FeatureDomainOptionsStore';

describe('FeatureDomainOptionsStore', () => {
  it('loads every domain when no run type is given', async () => {
    const listTestCaseDomains = vi.fn().mockResolvedValue({ domains: ['kho', '_unknown'] });
    const store = new FeatureDomainOptionsStore({ listTestCaseDomains });

    await store.ensureLoaded();

    expect(listTestCaseDomains).toHaveBeenCalledWith({});
    expect(store.optionsFor()).toEqual({ domains: ['kho', '_unknown'], isLoading: false, error: null });
  });

  it('scopes a load to the run type and keeps each layer separate', async () => {
    const listTestCaseDomains = vi
      .fn()
      .mockImplementation(({ run_type }) =>
        Promise.resolve({ domains: run_type === 'ui' ? ['quan-tri-doanh-nghiep'] : ['don-hang'] }),
      );
    const store = new FeatureDomainOptionsStore({ listTestCaseDomains });

    await store.ensureLoaded('api');
    await store.ensureLoaded('ui');

    expect(listTestCaseDomains).toHaveBeenCalledWith({ run_type: 'api' });
    expect(listTestCaseDomains).toHaveBeenCalledWith({ run_type: 'ui' });
    expect(store.optionsFor('api').domains).toEqual(['don-hang']);
    expect(store.optionsFor('ui').domains).toEqual(['quan-tri-doanh-nghiep']);
    expect(store.optionsFor().domains).toEqual([]);
  });

  it('does not refetch a layer that is loaded or already in flight', async () => {
    const listTestCaseDomains = vi.fn().mockResolvedValue({ domains: ['kho'] });
    const store = new FeatureDomainOptionsStore({ listTestCaseDomains });

    const first = store.ensureLoaded('api');
    expect(store.optionsFor('api').isLoading).toBe(true);
    await store.ensureLoaded('api');
    await first;
    await store.ensureLoaded('api');

    expect(listTestCaseDomains).toHaveBeenCalledTimes(1);
  });

  it('records a failure and retries it on the next call', async () => {
    const listTestCaseDomains = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ domains: ['kho'] });
    const store = new FeatureDomainOptionsStore({ listTestCaseDomains });

    await store.ensureLoaded();
    expect(store.optionsFor()).toEqual({ domains: [], isLoading: false, error: 'network down' });

    await store.ensureLoaded();
    expect(store.optionsFor()).toEqual({ domains: ['kho'], isLoading: false, error: null });
  });

  it('reset forgets every cached layer', async () => {
    const listTestCaseDomains = vi.fn().mockResolvedValue({ domains: ['kho'] });
    const store = new FeatureDomainOptionsStore({ listTestCaseDomains });
    await store.ensureLoaded('api');

    store.reset();

    expect(store.optionsFor('api').domains).toEqual([]);
  });
});
