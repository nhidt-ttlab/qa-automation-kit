import type {
  ListTestCasesQueryDto,
  PaginatedResponse,
  TestCaseListItemResponseDto,
} from '@qakit/reporting-shared';

import type { ApiClient } from '@/shared/api/client';

export class TestCaseListService {
  constructor(private readonly apiClient: ApiClient) {}

  listTestCases(query: Partial<ListTestCasesQueryDto>): Promise<PaginatedResponse<TestCaseListItemResponseDto>> {
    return this.apiClient.listTestCases(query);
  }
}
