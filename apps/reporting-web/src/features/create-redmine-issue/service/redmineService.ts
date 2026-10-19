import type { RedmineIssueResponseDto } from '@qakit/reporting-shared';

import type { ApiClient } from '@/shared/api/client';

export class RedmineService {
  constructor(private readonly apiClient: ApiClient) {}

  async createIssue(runId: string, payload: Record<string, unknown>): Promise<RedmineIssueResponseDto> {
    return this.apiClient.request<RedmineIssueResponseDto>({
      method: 'POST',
      url: `/api/runs/${runId}/redmine`,
      data: payload,
    });
  }
}
