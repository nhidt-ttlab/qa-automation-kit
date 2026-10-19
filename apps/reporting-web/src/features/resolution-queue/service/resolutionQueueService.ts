import type {
  ListResolutionIssuesQueryDto,
  PaginatedResponse,
  ResolutionCommentResponseDto,
  ResolutionEventResponseDto,
  ResolutionIssueDetailResponseDto,
  ResolutionIssueSummaryResponseDto,
  ResolutionQueueSummaryResponseDto,
} from '@qakit/reporting-shared';
import type { ApiClient } from '../../../shared/api/client';

/** Thin typed pass-through over the shared ApiClient, like every other feature service. */
export class ResolutionQueueService {
  constructor(private readonly apiClient: ApiClient) {}

  listIssues(
    query: Partial<ListResolutionIssuesQueryDto>,
  ): Promise<PaginatedResponse<ResolutionIssueSummaryResponseDto>> {
    return this.apiClient.listResolutionIssues(query);
  }

  exportCsv(
    query: Partial<ListResolutionIssuesQueryDto>,
  ): Promise<{ blob: Blob; filename: string }> {
    return this.apiClient.exportResolutionIssues(query);
  }

  getSummary(): Promise<ResolutionQueueSummaryResponseDto> {
    return this.apiClient.getResolutionQueueSummary();
  }

  getIssue(id: string): Promise<ResolutionIssueDetailResponseDto> {
    return this.apiClient.getResolutionIssue(id);
  }

  updateIssue(id: string, body: Record<string, unknown>) {
    return this.apiClient.updateResolutionIssue(id, body);
  }

  changeStatus(id: string, body: Record<string, unknown>) {
    return this.apiClient.changeResolutionStatus(id, body);
  }

  listComments(id: string): Promise<ResolutionCommentResponseDto[]> {
    return this.apiClient.listResolutionComments(id);
  }

  addComment(id: string, body: Record<string, unknown>) {
    return this.apiClient.addResolutionComment(id, body);
  }

  recordDecision(id: string, body: Record<string, unknown>) {
    return this.apiClient.recordResolutionDecision(id, body);
  }

  recordResolution(id: string, body: Record<string, unknown>) {
    return this.apiClient.recordResolutionResolution(id, body);
  }

  verify(id: string, body: Record<string, unknown>) {
    return this.apiClient.verifyResolutionIssue(id, body);
  }

  reopen(id: string, body: Record<string, unknown>) {
    return this.apiClient.reopenResolutionIssue(id, body);
  }

  linkDefect(id: string, body: Record<string, unknown>) {
    return this.apiClient.linkResolutionDefect(id, body);
  }

  linkRedmine(id: string, body: Record<string, unknown>) {
    return this.apiClient.linkResolutionRedmine(id, body);
  }

  listEvents(id: string): Promise<ResolutionEventResponseDto[]> {
    return this.apiClient.listResolutionEvents(id);
  }
}
