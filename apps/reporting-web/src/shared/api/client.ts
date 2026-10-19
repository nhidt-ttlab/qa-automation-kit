/**
 * API Client adapter
 * Wraps axios with error handling and serialization
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type {
  PaginatedResponse,
  TestRunDetailResponseDto,
  TestRunListItemResponseDto,
  ListTestRunsQueryDto,
  TestCaseListItemResponseDto,
  TestCaseDetailResponseDto,
  ListTestCasesQueryDto,
  ListTestCaseDomainsQueryDto,
  TestCaseDomainListResponseDto,
  CreateReviewRequestDto,
  ReviewRecordResponseDto,
  DashboardSummaryResponseDto,
  DashboardQueryDto,
  DefectSignatureSummaryResponseDto,
  DefectSignatureDetailResponseDto,
  ListDefectSignaturesQueryDto,
  LinkRedmineRequestDto,
  SearchResultResponseDto,
  SearchQueryDto,
  ListResolutionIssuesQueryDto,
  ResolutionIssueSummaryResponseDto,
  ResolutionIssueDetailResponseDto,
  ResolutionQueueSummaryResponseDto,
  ResolutionCommentResponseDto,
  ResolutionEventResponseDto,
  PreviewRegressionJobRequestDto,
  CreateRegressionJobRequestDto,
  CancelRegressionJobRequestDto,
  RegressionPreviewResponseDto,
  RegressionJobOptionsResponseDto,
  RegressionJobSummaryResponseDto,
  RegressionJobDetailResponseDto,
  RegressionJobLogTailResponseDto,
  RegressionWorkspaceStatusResponseDto,
  RegressionWorkspaceSyncResponseDto,
  SyncRegressionWorkspaceRequestDto,
} from '@qakit/reporting-shared';

export interface ApiClientConfig {
  baseURL: string;
  timeout?: number;
}

export class ApiClient {
  private client: AxiosInstance;

  constructor(config: ApiClientConfig) {
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        return Promise.reject(error);
      },
    );
  }

  // Runs API
  async listRuns(query: Partial<ListTestRunsQueryDto>): Promise<PaginatedResponse<TestRunListItemResponseDto>> {
    const response = await this.client.get<PaginatedResponse<TestRunListItemResponseDto>>('/api/runs', {
      params: query,
    });
    return response.data;
  }

  async getRun(id: string): Promise<TestRunDetailResponseDto> {
    const response = await this.client.get<TestRunDetailResponseDto>(`/api/runs/${id}`);
    return response.data;
  }

  async getRunReport(id: string): Promise<Record<string, unknown>> {
    const response = await this.client.get<Record<string, unknown>>(`/api/runs/${id}/report`);
    return response.data;
  }

  async getRunReview(id: string): Promise<ReviewRecordResponseDto> {
    const response = await this.client.get<ReviewRecordResponseDto>(`/api/runs/${id}/review`);
    return response.data;
  }

  // Test Cases API
  async listTestCases(query: Partial<ListTestCasesQueryDto>): Promise<PaginatedResponse<TestCaseListItemResponseDto>> {
    const response = await this.client.get<PaginatedResponse<TestCaseListItemResponseDto>>('/api/testcases', {
      params: query,
    });
    return response.data;
  }

  async listTestCaseDomains(query: ListTestCaseDomainsQueryDto): Promise<TestCaseDomainListResponseDto> {
    const response = await this.client.get<TestCaseDomainListResponseDto>('/api/testcases/domains', {
      params: query,
    });
    return response.data;
  }

  async getTestCase(id: string): Promise<TestCaseDetailResponseDto> {
    const response = await this.client.get<TestCaseDetailResponseDto>(`/api/testcases/${id}`);
    return response.data;
  }

  async getTestCaseRuns(
    id: string,
    query: Partial<ListTestRunsQueryDto>,
  ): Promise<PaginatedResponse<TestRunListItemResponseDto>> {
    const response = await this.client.get<PaginatedResponse<TestRunListItemResponseDto>>(
      `/api/testcases/${id}/runs`,
      { params: query },
    );
    return response.data;
  }

  // Reviews API
  async createReview(dto: CreateReviewRequestDto): Promise<ReviewRecordResponseDto> {
    const response = await this.client.post<ReviewRecordResponseDto>('/api/reviews', dto);
    return response.data;
  }

  /**
   * CSV of every reviewed run, one row per suggestion.
   *
   * Fetched as a blob rather than navigated to, for the same reason as the resolution export:
   * a rejected export surfaces through the app error handling instead of replacing the page
   * with a JSON body. The trade-off is that errors arrive as blobs too -- see readApiErrorBlob.
   */
  async exportReviews(
    query: Record<string, unknown> = {},
  ): Promise<{ blob: Blob; filename: string }> {
    const response = await this.client.get<Blob>('/api/reviews/export', {
      params: query,
      responseType: 'blob',
    });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    return {
      blob: response.data,
      // Same shape as the server's name, should the header ever be missing or unreadable.
      filename:
        match?.[1] ?? `run-reviews-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}Z.csv`,
    };
  }
  // Defects API
  async listDefects(
    query: Partial<ListDefectSignaturesQueryDto>,
  ): Promise<PaginatedResponse<DefectSignatureSummaryResponseDto>> {
    const response = await this.client.get<PaginatedResponse<DefectSignatureSummaryResponseDto>>('/api/defects', {
      params: query,
    });
    return response.data;
  }

  async getDefect(id: string): Promise<DefectSignatureDetailResponseDto> {
    const response = await this.client.get<DefectSignatureDetailResponseDto>(`/api/defects/${id}`);
    return response.data;
  }

  async createDefectFromRun(runId: string): Promise<DefectSignatureDetailResponseDto> {
    const response = await this.client.post<DefectSignatureDetailResponseDto>(`/api/defects/from-run/${runId}`);
    return response.data;
  }

  async linkRedmine(defectId: string, dto: LinkRedmineRequestDto): Promise<DefectSignatureDetailResponseDto> {
    const response = await this.client.post<DefectSignatureDetailResponseDto>(
      `/api/defects/${defectId}/link-redmine`,
      dto,
    );
    return response.data;
  }

  // Dashboard API
  async getDashboardSummary(query?: Partial<DashboardQueryDto>): Promise<DashboardSummaryResponseDto> {
    const response = await this.client.get<DashboardSummaryResponseDto>('/api/dashboard/summary', {
      params: query,
    });
    return response.data;
  }

  // Search API
  async search(
    q: string,
    query?: Partial<Omit<SearchQueryDto, 'q'>>,
  ): Promise<PaginatedResponse<SearchResultResponseDto>> {
    const response = await this.client.get<PaginatedResponse<SearchResultResponseDto>>('/api/search', {
      params: { q, ...query },
    });
    return response.data;
  }

  // Resolution Queue API
  //
  // Every mutating call carries an `actor` in its body: this application has no authentication,
  // so identity is self-asserted. The web app remembers a name in localStorage and sends it.

  async listResolutionIssues(
    query: Partial<ListResolutionIssuesQueryDto>,
  ): Promise<PaginatedResponse<ResolutionIssueSummaryResponseDto>> {
    const response = await this.client.get<PaginatedResponse<ResolutionIssueSummaryResponseDto>>(
      '/api/resolution-issues',
      { params: query },
    );
    return response.data;
  }

  /**
   * CSV of everything the given filters select.
   *
   * Fetched as a blob rather than navigated to, so a rejected export (bad filter, too many rows)
   * surfaces through the app's own error handling instead of replacing the page with a JSON body.
   * The trade-off is that an error response arrives as a blob too — see `readApiErrorBlob`.
   */
  async exportResolutionIssues(
    query: Partial<ListResolutionIssuesQueryDto>,
  ): Promise<{ blob: Blob; filename: string }> {
    const response = await this.client.get<Blob>('/api/resolution-issues/export', {
      params: query,
      responseType: 'blob',
    });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    return {
      blob: response.data,
      filename: match?.[1] ?? 'resolution-issues.csv',
    };
  }

  async getResolutionQueueSummary(): Promise<ResolutionQueueSummaryResponseDto> {
    const response = await this.client.get<ResolutionQueueSummaryResponseDto>(
      '/api/resolution-issues/summary',
    );
    return response.data;
  }

  async getResolutionIssue(id: string): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.get<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}`,
    );
    return response.data;
  }

  async updateResolutionIssue(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.patch<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}`,
      body,
    );
    return response.data;
  }

  async changeResolutionStatus(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.post<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}/status`,
      body,
    );
    return response.data;
  }

  async listResolutionComments(id: string): Promise<ResolutionCommentResponseDto[]> {
    const response = await this.client.get<ResolutionCommentResponseDto[]>(
      `/api/resolution-issues/${id}/comments`,
    );
    return response.data;
  }

  async addResolutionComment(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionCommentResponseDto> {
    const response = await this.client.post<ResolutionCommentResponseDto>(
      `/api/resolution-issues/${id}/comments`,
      body,
    );
    return response.data;
  }

  async recordResolutionDecision(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.patch<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}/decision`,
      body,
    );
    return response.data;
  }

  async recordResolutionResolution(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.patch<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}/resolution`,
      body,
    );
    return response.data;
  }

  async verifyResolutionIssue(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.post<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}/verify`,
      body,
    );
    return response.data;
  }

  async reopenResolutionIssue(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.post<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}/reopen`,
      body,
    );
    return response.data;
  }

  async linkResolutionDefect(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.post<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}/link-defect`,
      body,
    );
    return response.data;
  }

  async linkResolutionRedmine(
    id: string,
    body: Record<string, unknown>,
  ): Promise<ResolutionIssueDetailResponseDto> {
    const response = await this.client.post<ResolutionIssueDetailResponseDto>(
      `/api/resolution-issues/${id}/link-redmine`,
      body,
    );
    return response.data;
  }

  async listResolutionEvents(id: string): Promise<ResolutionEventResponseDto[]> {
    const response = await this.client.get<ResolutionEventResponseDto[]>(
      `/api/resolution-issues/${id}/events`,
    );
    return response.data;
  }

  // Regression Jobs API
  async previewRegressionJob(
    body: PreviewRegressionJobRequestDto,
  ): Promise<RegressionPreviewResponseDto> {
    const response = await this.client.post<RegressionPreviewResponseDto>(
      '/api/regression-jobs/preview',
      body,
    );
    return response.data;
  }

  async getRegressionJobOptions(): Promise<RegressionJobOptionsResponseDto> {
    const response = await this.client.get<RegressionJobOptionsResponseDto>(
      '/api/regression-jobs/options',
    );
    return response.data;
  }

  async createRegressionJob(
    body: CreateRegressionJobRequestDto,
  ): Promise<RegressionJobDetailResponseDto> {
    const response = await this.client.post<RegressionJobDetailResponseDto>(
      '/api/regression-jobs',
      body,
    );
    return response.data;
  }

  async listRegressionJobs(
    query: { page: number; limit: number },
  ): Promise<PaginatedResponse<RegressionJobSummaryResponseDto>> {
    const response = await this.client.get<PaginatedResponse<RegressionJobSummaryResponseDto>>(
      '/api/regression-jobs',
      { params: query },
    );
    return response.data;
  }

  async getRegressionJob(id: number): Promise<RegressionJobDetailResponseDto> {
    const response = await this.client.get<RegressionJobDetailResponseDto>(
      `/api/regression-jobs/${id}`,
    );
    return response.data;
  }

  async cancelRegressionJob(
    id: number,
    body: CancelRegressionJobRequestDto,
  ): Promise<RegressionJobDetailResponseDto> {
    const response = await this.client.post<RegressionJobDetailResponseDto>(
      `/api/regression-jobs/${id}/cancel`,
      body,
    );
    return response.data;
  }

  async getRegressionJobLog(
    id: number,
    fromSeq: number,
    limit?: number,
  ): Promise<RegressionJobLogTailResponseDto> {
    const response = await this.client.get<RegressionJobLogTailResponseDto>(
      `/api/regression-jobs/${id}/logs`,
      { params: { from_seq: fromSeq, ...(limit ? { limit } : {}) } },
    );
    return response.data;
  }

  async getRegressionWorkspace(): Promise<RegressionWorkspaceStatusResponseDto> {
    const response = await this.client.get<RegressionWorkspaceStatusResponseDto>(
      '/api/regression-jobs/workspace',
    );
    return response.data;
  }

  async syncRegressionWorkspace(
    body: SyncRegressionWorkspaceRequestDto,
  ): Promise<RegressionWorkspaceSyncResponseDto> {
    // A pull plus a possible `npm install` can outlast the client's 30s default by minutes; the
    // API's own timeouts (3 min for git, 10 min for npm) bound the wait, so this just stays out
    // of the way.
    const response = await this.client.post<RegressionWorkspaceSyncResponseDto>(
      '/api/regression-jobs/workspace/sync',
      body,
      { timeout: 15 * 60 * 1000 },
    );
    return response.data;
  }

  // Health API
  async checkHealth(): Promise<{ status: string; timestamp: string }> {
    const response = await this.client.get<{ status: string; timestamp: string }>('/health');
    return response.data;
  }

  // Generic request method for extensibility
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    const response = await this.client.request<T>(config);
    return response.data;
  }
}
