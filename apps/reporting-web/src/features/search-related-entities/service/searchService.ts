import type { SearchQueryDto } from '@qakit/reporting-shared';

import type { ApiClient } from '@/shared/api/client';

export class SearchService {
  constructor(private readonly apiClient: ApiClient) {}

  search(queryText: string, query: Partial<Omit<SearchQueryDto, 'q'>> = {}) {
    return this.apiClient.search(queryText, query);
  }
}
