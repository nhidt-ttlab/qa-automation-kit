import { makeAutoObservable, runInAction } from 'mobx';
import type { DefectSignatureSummaryResponseDto, ListDefectSignaturesQueryDto } from '@qakit/reporting-shared';

import { DefectService } from '../service/defectService';

const DEFAULT_LIMIT = 20;

export class DefectStore {
  defects: DefectSignatureSummaryResponseDto[] = [];
  totalDefects = 0;
  currentPage = 1;
  pageSize = DEFAULT_LIMIT;
  isLoadingList = false;
  error: string | null = null;

  filters: Partial<ListDefectSignaturesQueryDto> = {
    page: 1,
    limit: DEFAULT_LIMIT,
  };

  constructor(private readonly defectService: DefectService) {
    makeAutoObservable(this);
  }

  async loadDefects() {
    this.isLoadingList = true;
    this.error = null;

    try {
      const result = await this.defectService.listDefects(this.filters);
      runInAction(() => {
        this.defects = result.items;
        this.totalDefects = result.total;
        this.currentPage = result.page;
        this.pageSize = result.limit;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : 'Failed to load defects';
      });
    } finally {
      runInAction(() => {
        this.isLoadingList = false;
      });
    }
  }

  applyFilters(filters: Partial<ListDefectSignaturesQueryDto>) {
    this.filters = { ...filters, page: 1, limit: this.filters.limit || DEFAULT_LIMIT };
    void this.loadDefects();
  }

  setPage(page: number) {
    this.filters = { ...this.filters, page };
    void this.loadDefects();
  }

  reset() {
    this.defects = [];
    this.totalDefects = 0;
    this.currentPage = 1;
    this.pageSize = DEFAULT_LIMIT;
    this.filters = { page: 1, limit: DEFAULT_LIMIT };
    this.isLoadingList = false;
    this.error = null;
  }
}
