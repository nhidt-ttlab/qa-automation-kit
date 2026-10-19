import type {
  DefectSignatureDetailResponseDto,
  DefectSignatureSummaryResponseDto,
  ListDefectSignaturesQueryDto,
  PaginatedResponse,
} from '@qakit/reporting-shared';

import type { ApiClient } from '@/shared/api/client';

export class DefectService {
  constructor(private readonly apiClient: ApiClient) {}

  listDefects(
    query: Partial<ListDefectSignaturesQueryDto>,
  ): Promise<PaginatedResponse<DefectSignatureSummaryResponseDto>> {
    return this.apiClient.listDefects(query);
  }

  getDefect(defectId: string): Promise<DefectSignatureDetailResponseDto> {
    return this.apiClient.getDefect(defectId);
  }
}
