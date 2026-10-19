import { makeAutoObservable, runInAction } from 'mobx';
import { RUN_TYPE } from '@qakit/reporting-shared';
import type {
  ListTestCasesQueryDto,
  RunType,
  TestCaseListItemResponseDto,
  TestRunResult,
} from '@qakit/reporting-shared';

import { TestCaseListService } from '../service/testCaseListService';

const DEFAULT_LIMIT = 20;

export class TestCaseListStore {
  testCases: TestCaseListItemResponseDto[] = [];
  totalTestCases = 0;
  currentPage = 1;
  pageSize = DEFAULT_LIMIT;
  searchText = '';
  latestRunResult: TestRunResult | 'all' = 'all';
  /** Documentation module ("feature"). Empty string = no filter. */
  domain = '';
  /**
   * Hardening-checklist row filters, typed by the user and resolved by the API through each
   * case's run checks as case-insensitive substrings. Empty = no filter.
   */
  csvChecklistId = '';
  csvTestcaseId = '';
  /** Which tab is active. API is the default because it is the bulk of the suite. */
  runType: RunType = RUN_TYPE.API;
  isLoadingList = false;
  listError: string | null = null;

  constructor(private readonly testCaseListService: TestCaseListService) {
    makeAutoObservable(this);
  }

  async loadTestCases() {
    this.isLoadingList = true;
    this.listError = null;

    try {
      const query: Partial<ListTestCasesQueryDto> = {
        page: this.currentPage,
        limit: this.pageSize,
        run_type: this.runType,
      };
      const q = this.searchText.trim();
      if (q) query.q = q;
      if (this.latestRunResult !== 'all') query.latest_run_result = this.latestRunResult;
      if (this.domain) query.domain = this.domain;
      const csvChecklistId = this.csvChecklistId.trim();
      if (csvChecklistId) query.csv_checklist_id = csvChecklistId;
      const csvTestcaseId = this.csvTestcaseId.trim();
      if (csvTestcaseId) query.csv_testcase_id = csvTestcaseId;

      const result = await this.testCaseListService.listTestCases(query);
      runInAction(() => {
        this.testCases = result.items;
        this.totalTestCases = result.total;
        this.currentPage = result.page;
        this.pageSize = result.limit;
      });
    } catch (error) {
      runInAction(() => {
        this.listError = error instanceof Error ? error.message : 'Failed to load test cases';
      });
    } finally {
      runInAction(() => {
        this.isLoadingList = false;
      });
    }
  }

  setPage(page: number) {
    this.currentPage = page;
    void this.loadTestCases();
  }

  /**
   * Single funnel for filter changes: apply one or more fields, reset to page 1,
   * and reload exactly once. Call this with all changed fields together rather
   * than calling setSearchText/setLatestRunResult back-to-back, to avoid a
   * double reload.
   */
  applyFilters(filters: {
    searchText?: string;
    latestRunResult?: TestRunResult | 'all';
    runType?: RunType;
    domain?: string;
    csvChecklistId?: string;
    csvTestcaseId?: string;
  }) {
    if (filters.searchText !== undefined) this.searchText = filters.searchText;
    if (filters.latestRunResult !== undefined) this.latestRunResult = filters.latestRunResult;
    if (filters.runType !== undefined) this.runType = filters.runType;
    if (filters.domain !== undefined) this.domain = filters.domain;
    if (filters.csvChecklistId !== undefined) this.csvChecklistId = filters.csvChecklistId;
    if (filters.csvTestcaseId !== undefined) this.csvTestcaseId = filters.csvTestcaseId;
    this.currentPage = 1;
    void this.loadTestCases();
  }

  setSearchText(text: string) {
    this.applyFilters({ searchText: text });
  }

  setLatestRunResult(result: TestRunResult | 'all') {
    this.applyFilters({ latestRunResult: result });
  }

  /** Switching tab is a filter change, so it goes through the same single funnel. */
  setRunType(runType: RunType) {
    if (this.runType === runType) return;
    this.applyFilters({ runType });
  }

  reset() {
    this.testCases = [];
    this.totalTestCases = 0;
    this.currentPage = 1;
    this.pageSize = DEFAULT_LIMIT;
    this.searchText = '';
    this.latestRunResult = 'all';
    this.domain = '';
    this.csvChecklistId = '';
    this.csvTestcaseId = '';
    this.runType = RUN_TYPE.API;
    this.isLoadingList = false;
    this.listError = null;
  }
}
