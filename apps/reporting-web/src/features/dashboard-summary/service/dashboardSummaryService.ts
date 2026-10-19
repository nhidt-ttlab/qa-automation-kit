import type { DashboardQueryDto, DashboardSummaryResponseDto } from '@qakit/reporting-shared';

import type { ApiClient } from '@/shared/api/client';

export class DashboardSummaryService {
  constructor(private readonly apiClient: ApiClient) {}

  getSummary(query: Partial<DashboardQueryDto> = {}): Promise<DashboardSummaryResponseDto> {
    return this.apiClient.getDashboardSummary(query);
  }
}
