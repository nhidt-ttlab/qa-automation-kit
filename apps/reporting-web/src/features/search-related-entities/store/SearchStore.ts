import { makeAutoObservable, runInAction } from 'mobx';
import type { SearchQueryDto, SearchResultResponseDto } from '@qakit/reporting-shared';

import { SearchService } from '../service/searchService';

export class SearchStore {
  results: SearchResultResponseDto[] = [];
  isSearching = false;
  searchError: string | null = null;

  constructor(private readonly searchService: SearchService) {
    makeAutoObservable(this);
  }

  async search(queryText: string, query: Partial<Omit<SearchQueryDto, 'q'>> = {}) {
    this.isSearching = true;
    this.searchError = null;

    try {
      const result = await this.searchService.search(queryText, query);
      runInAction(() => {
        this.results = result.items;
      });
    } catch (error) {
      runInAction(() => {
        this.searchError = error instanceof Error ? error.message : 'Search failed';
      });
    } finally {
      runInAction(() => {
        this.isSearching = false;
      });
    }
  }

  reset() {
    this.results = [];
    this.isSearching = false;
    this.searchError = null;
  }
}
