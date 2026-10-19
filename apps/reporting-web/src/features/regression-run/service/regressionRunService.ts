import type {
  CancelRegressionJobRequestDto,
  CreateRegressionJobRequestDto,
  PaginatedResponse,
  PreviewRegressionJobRequestDto,
  RegressionJobDetailResponseDto,
  RegressionJobLogTailResponseDto,
  RegressionJobOptionsResponseDto,
  RegressionJobSummaryResponseDto,
  RegressionPreviewResponseDto,
  RegressionWorkspaceStatusResponseDto,
  RegressionWorkspaceSyncResponseDto,
  SyncRegressionWorkspaceRequestDto,
} from '@qakit/reporting-shared';
import type { ApiClient } from '../../../shared/api/client';
import { apiUrl } from '../../../shared/api/apiUrl';

/** Thin typed pass-through over the shared ApiClient, like every other feature service. */
export class RegressionRunService {
  constructor(private readonly apiClient: ApiClient) {}

  preview(body: PreviewRegressionJobRequestDto): Promise<RegressionPreviewResponseDto> {
    return this.apiClient.previewRegressionJob(body);
  }

  getOptions(): Promise<RegressionJobOptionsResponseDto> {
    return this.apiClient.getRegressionJobOptions();
  }

  createJob(body: CreateRegressionJobRequestDto): Promise<RegressionJobDetailResponseDto> {
    return this.apiClient.createRegressionJob(body);
  }

  listJobs(query: {
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<RegressionJobSummaryResponseDto>> {
    return this.apiClient.listRegressionJobs(query);
  }

  getJob(id: number): Promise<RegressionJobDetailResponseDto> {
    return this.apiClient.getRegressionJob(id);
  }

  cancelJob(
    id: number,
    body: CancelRegressionJobRequestDto,
  ): Promise<RegressionJobDetailResponseDto> {
    return this.apiClient.cancelRegressionJob(id, body);
  }

  getLog(id: number, fromSeq: number, limit?: number): Promise<RegressionJobLogTailResponseDto> {
    return this.apiClient.getRegressionJobLog(id, fromSeq, limit);
  }

  getWorkspace(): Promise<RegressionWorkspaceStatusResponseDto> {
    return this.apiClient.getRegressionWorkspace();
  }

  syncWorkspace(
    body: SyncRegressionWorkspaceRequestDto,
  ): Promise<RegressionWorkspaceSyncResponseDto> {
    return this.apiClient.syncRegressionWorkspace(body);
  }

  /**
   * The one method that is not an ApiClient delegate, and why.
   *
   * SSE cannot go through axios: it has no browser streaming response API at all, and the shared
   * client's 30s timeout would abort every connection long before a batch finished. `apiUrl` gives
   * the absolute origin a relative path would not resolve to under the Vite dev proxy - the same
   * reason `<img src>` and `<video src>` use it.
   */
  streamUrl(id: number, fromSeq: number): string {
    return apiUrl(`/api/regression-jobs/${id}/logs/stream?from_seq=${fromSeq}`);
  }
}
