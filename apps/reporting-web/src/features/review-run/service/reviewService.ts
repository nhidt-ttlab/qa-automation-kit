import type { CreateReviewRequestDto, ReviewRecordResponseDto } from '@qakit/reporting-shared';

import type { ApiClient } from '@/shared/api/client';

export class ReviewService {
  constructor(private readonly apiClient: ApiClient) {}

  createReview(dto: CreateReviewRequestDto): Promise<ReviewRecordResponseDto> {
    return this.apiClient.createReview(dto);
  }

  exportReviews(
    query: Record<string, unknown> = {},
  ): Promise<{ blob: Blob; filename: string }> {
    return this.apiClient.exportReviews(query);
  }
}
