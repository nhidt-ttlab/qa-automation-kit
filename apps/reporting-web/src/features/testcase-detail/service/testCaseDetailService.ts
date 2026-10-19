import type {
  ListTestRunsQueryDto,
  PaginatedResponse,
  TestCaseDetailResponseDto,
  TestRunListItemResponseDto,
} from '@qakit/reporting-shared';

import type { ApiClient } from '@/shared/api/client';

export class TestCaseDetailService {
  constructor(private readonly apiClient: ApiClient) {}

  getTestCase(id: string): Promise<TestCaseDetailResponseDto> {
    return this.apiClient.getTestCase(id);
  }

  getTestCaseRuns(
    id: string,
    query: Partial<ListTestRunsQueryDto>,
  ): Promise<PaginatedResponse<TestRunListItemResponseDto>> {
    return this.apiClient.getTestCaseRuns(id, query);
  }
}
