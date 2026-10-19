import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';

import type { ApiClient } from '@/shared/api/client';

export class RunDetailService {
  constructor(private readonly apiClient: ApiClient) {}

  getRun(runId: string): Promise<TestRunDetailResponseDto> {
    return this.apiClient.getRun(runId);
  }
}
