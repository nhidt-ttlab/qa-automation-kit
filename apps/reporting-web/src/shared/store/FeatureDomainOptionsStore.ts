import { makeAutoObservable, runInAction } from 'mobx';
import type {
  ListTestCaseDomainsQueryDto,
  RunType,
  TestCaseDomainListResponseDto,
} from '@qakit/reporting-shared';

/** The one call this store needs; ApiClient satisfies it directly. */
export interface FeatureDomainOptionsSource {
  listTestCaseDomains(query: ListTestCaseDomainsQueryDto): Promise<TestCaseDomainListResponseDto>;
}

export interface FeatureDomainOptions {
  domains: string[];
  isLoading: boolean;
  error: string | null;
}

type OptionsKey = RunType | 'all';

const IDLE: FeatureDomainOptions = { domains: [], isLoading: false, error: null };

/**
 * Feature filter options, read from the domains the DB actually holds instead of the shared
 * constants. Shared by every filter bar and cached per layer (`api`, `ui`, or `all`), so switching
 * tab or page does not refetch. A page reload picks up domains added since.
 */
export class FeatureDomainOptionsStore {
  entries = new Map<OptionsKey, FeatureDomainOptions>();

  constructor(private readonly source: FeatureDomainOptionsSource) {
    makeAutoObservable(this);
  }

  optionsFor(runType?: RunType): FeatureDomainOptions {
    return this.entries.get(runType ?? 'all') ?? IDLE;
  }

  async ensureLoaded(runType?: RunType) {
    const key: OptionsKey = runType ?? 'all';
    const existing = this.entries.get(key);
    // Loaded or in flight: nothing to do. A failed load is retried on the next mount.
    if (existing && !existing.error) return;

    this.entries.set(key, { domains: [], isLoading: true, error: null });
    try {
      const result = await this.source.listTestCaseDomains(runType ? { run_type: runType } : {});
      runInAction(() => {
        this.entries.set(key, { domains: result.domains, isLoading: false, error: null });
      });
    } catch (error) {
      runInAction(() => {
        this.entries.set(key, {
          domains: [],
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load features',
        });
      });
    }
  }

  reset() {
    this.entries.clear();
  }
}
