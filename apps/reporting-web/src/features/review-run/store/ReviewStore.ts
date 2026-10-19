import { makeAutoObservable, runInAction } from 'mobx';
import type { CreateReviewRequestDto } from '@qakit/reporting-shared';

import { readApiErrorBlob } from '../../resolution-queue/store/ResolutionQueueStore';

import { ReviewService } from '../service/reviewService';

export class ReviewStore {
  isSubmittingReview = false;
  reviewError: string | null = null;

  isExportingReviews = false;
  exportError: string | null = null;
  /** `YYYY-MM-DD` from the date input; empty exports every review. Shared by both export buttons. */
  exportReviewedFrom = '';

  constructor(private readonly reviewService: ReviewService) {
    makeAutoObservable(this);
  }

  async submitReview(dto: CreateReviewRequestDto) {
    this.isSubmittingReview = true;
    this.reviewError = null;

    try {
      return await this.reviewService.createReview(dto);
    } catch (error) {
      runInAction(() => {
        this.reviewError = error instanceof Error ? error.message : 'Failed to submit review';
      });
      throw error;
    } finally {
      runInAction(() => {
        this.isSubmittingReview = false;
      });
    }
  }

  /**
   * Every reviewed run as CSV. Returns null on failure, having recorded the message: the caller
   * is a button that must not save a file when the export was rejected.
   */
  async exportReviews(): Promise<{ blob: Blob; filename: string } | null> {
    this.isExportingReviews = true;
    this.exportError = null;

    // Local midnight, not `new Date('YYYY-MM-DD')`: that parses as UTC midnight, which in UTC+7
    // would silently drop everything reviewed between 00:00 and 07:00 on the chosen day.
    const query = this.exportReviewedFrom
      ? { reviewed_from: new Date(`${this.exportReviewedFrom}T00:00:00`).toISOString() }
      : {};

    try {
      return await this.reviewService.exportReviews(query);
    } catch (error) {
      const message = await readApiErrorBlob(error);
      runInAction(() => {
        this.exportError = message ?? (error instanceof Error ? error.message : 'Failed to export reviews');
      });
      return null;
    } finally {
      runInAction(() => {
        this.isExportingReviews = false;
      });
    }
  }

  setExportReviewedFrom(value: string) {
    this.exportReviewedFrom = value;
  }

  clearExportError() {
    this.exportError = null;
  }

  reset() {
    this.isSubmittingReview = false;
    this.reviewError = null;
    this.isExportingReviews = false;
    this.exportError = null;
    this.exportReviewedFrom = '';
  }
}
