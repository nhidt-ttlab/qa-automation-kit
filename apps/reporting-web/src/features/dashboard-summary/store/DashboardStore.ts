import { makeAutoObservable, runInAction } from 'mobx';
import type { DashboardQueryDto, DashboardSummaryResponseDto } from '@qakit/reporting-shared';

import { DashboardSummaryService } from '../service/dashboardSummaryService';

export class DashboardStore {
  dashboardData: DashboardSummaryResponseDto | null = null;
  isLoading = false;
  error: string | null = null;

  constructor(private readonly dashboardSummaryService: DashboardSummaryService) {
    makeAutoObservable(this);
  }

  async loadSummary(query: Partial<DashboardQueryDto> = {}) {
    this.isLoading = true;
    this.error = null;

    try {
      const result = await this.dashboardSummaryService.getSummary(query);
      runInAction(() => {
        this.dashboardData = result;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to load dashboard';
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  reset() {
    this.dashboardData = null;
    this.isLoading = false;
    this.error = null;
  }
}
