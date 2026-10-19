import { makeAutoObservable, runInAction } from 'mobx';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';

import { RunDetailService } from '../service/runDetailService';

export class RunDetailStore {
  selectedRun: TestRunDetailResponseDto | null = null;
  isLoading = false;
  error: string | null = null;

  constructor(private readonly runDetailService: RunDetailService) {
    makeAutoObservable(this);
  }

  async loadRun(runId: string) {
    this.isLoading = true;
    this.error = null;

    try {
      const result = await this.runDetailService.getRun(runId);
      runInAction(() => {
        this.selectedRun = result;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to load run';
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  setReview(review: TestRunDetailResponseDto['review']) {
    if (this.selectedRun) {
      this.selectedRun = { ...this.selectedRun, review };
    }
  }

  reset() {
    this.selectedRun = null;
    this.isLoading = false;
    this.error = null;
  }
}
