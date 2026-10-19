import { makeAutoObservable, runInAction } from 'mobx';
import type { TestCaseDetailResponseDto, TestRunListItemResponseDto } from '@qakit/reporting-shared';

import { TestCaseDetailService } from '../service/testCaseDetailService';

const DEFAULT_LIMIT = 20;

export class TestCaseDetailStore {
  selectedTestCase: TestCaseDetailResponseDto | null = null;
  isLoading = false;
  error: string | null = null;

  runs: TestRunListItemResponseDto[] = [];
  totalRuns = 0;
  currentPage = 1;
  pageSize = DEFAULT_LIMIT;
  isLoadingRuns = false;
  runsError: string | null = null;

  private testCaseId: string | null = null;

  constructor(private readonly testCaseDetailService: TestCaseDetailService) {
    makeAutoObservable(this);
  }

  async loadTestCase(id: string) {
    this.isLoading = true;
    this.error = null;

    try {
      const result = await this.testCaseDetailService.getTestCase(id);
      runInAction(() => {
        this.selectedTestCase = result;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to load test case';
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async loadRunHistory(id: string, page: number) {
    this.testCaseId = id;
    this.isLoadingRuns = true;
    this.runsError = null;

    try {
      const result = await this.testCaseDetailService.getTestCaseRuns(id, { page, limit: this.pageSize });
      runInAction(() => {
        this.runs = result.items;
        this.totalRuns = result.total;
        this.currentPage = result.page;
        this.pageSize = result.limit;
      });
    } catch (error) {
      runInAction(() => {
        this.runsError = error instanceof Error ? error.message : 'Failed to load run history';
      });
    } finally {
      runInAction(() => {
        this.isLoadingRuns = false;
      });
    }
  }

  setPage(page: number) {
    if (!this.testCaseId) return;
    void this.loadRunHistory(this.testCaseId, page);
  }

  reset() {
    this.selectedTestCase = null;
    this.isLoading = false;
    this.error = null;
    this.runs = [];
    this.totalRuns = 0;
    this.currentPage = 1;
    this.pageSize = DEFAULT_LIMIT;
    this.isLoadingRuns = false;
    this.runsError = null;
    this.testCaseId = null;
  }
}
