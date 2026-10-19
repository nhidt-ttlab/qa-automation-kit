/**
 * MobX Root Store
 * Composes all feature-level stores
 */

import { makeAutoObservable } from 'mobx';
import { ApiClient } from '../../shared/api/client';
import { API_BASE_URL } from '../../shared/api/apiUrl';
import { FeatureDomainOptionsStore } from '../../shared/store/FeatureDomainOptionsStore';
import { RedmineService, RedmineStore } from '../../features/create-redmine-issue';
import { DashboardSummaryService, DashboardStore } from '../../features/dashboard-summary';
import { DefectService, DefectStore } from '../../features/defect-signature-list';
import { RegressionRunService, RegressionRunStore } from '../../features/regression-run';
import { ResolutionQueueService, ResolutionQueueStore } from '../../features/resolution-queue';
import { ReviewService, ReviewStore } from '../../features/review-run';
import { SearchService, SearchStore } from '../../features/search-related-entities';
import { RunDetailService, RunDetailStore } from '../../features/run-detail';
import { TestCaseListService, TestCaseListStore } from '../../features/testcase-list';
import { TestCaseDetailService, TestCaseDetailStore } from '../../features/testcase-detail';

export class RootStore {
  // Services
  apiClient: ApiClient;

  // Feature stores
  runDetailStore: RunDetailStore;
  testCaseListStore: TestCaseListStore;
  testCaseDetailStore: TestCaseDetailStore;
  defectStore: DefectStore;
  resolutionQueueStore: ResolutionQueueStore;
  reviewStore: ReviewStore;
  dashboardStore: DashboardStore;
  searchStore: SearchStore;
  redmineStore: RedmineStore;
  regressionRunStore: RegressionRunStore;

  // Shared stores (used across feature pages)
  featureDomainOptionsStore: FeatureDomainOptionsStore;

  // Global state
  isLoading = false;
  error: string | null = null;

  constructor() {
    // Initialize API client
    this.apiClient = new ApiClient({
      baseURL: API_BASE_URL,
    });

    // Initialize feature stores
    this.runDetailStore = new RunDetailStore(new RunDetailService(this.apiClient));
    this.testCaseListStore = new TestCaseListStore(new TestCaseListService(this.apiClient));
    this.testCaseDetailStore = new TestCaseDetailStore(new TestCaseDetailService(this.apiClient));
    this.defectStore = new DefectStore(new DefectService(this.apiClient));
    this.resolutionQueueStore = new ResolutionQueueStore(
      new ResolutionQueueService(this.apiClient),
    );
    this.reviewStore = new ReviewStore(new ReviewService(this.apiClient));
    this.dashboardStore = new DashboardStore(new DashboardSummaryService(this.apiClient));
    this.searchStore = new SearchStore(new SearchService(this.apiClient));
    this.redmineStore = new RedmineStore(new RedmineService(this.apiClient));
    this.regressionRunStore = new RegressionRunStore(new RegressionRunService(this.apiClient));
    this.featureDomainOptionsStore = new FeatureDomainOptionsStore(this.apiClient);

    makeAutoObservable(this, {
      apiClient: false, // Don't observe services
    });
  }

  setLoading(isLoading: boolean) {
    this.isLoading = isLoading;
  }

  setError(error: string | null) {
    this.error = error;
  }

  clearError() {
    this.error = null;
  }

  reset() {
    this.isLoading = false;
    this.error = null;
    this.runDetailStore.reset();
    this.testCaseListStore.reset();
    this.testCaseDetailStore.reset();
    this.defectStore.reset();
    this.resolutionQueueStore.reset();
    this.reviewStore.reset();
    this.dashboardStore.reset();
    this.searchStore.reset();
    this.redmineStore.reset();
    this.regressionRunStore.reset();
    this.featureDomainOptionsStore.reset();
  }
}

// Singleton instance
let rootStore: RootStore | null = null;

export function getRootStore(): RootStore {
  if (!rootStore) {
    rootStore = new RootStore();
  }
  return rootStore;
}

export function resetRootStore() {
  if (rootStore) {
    rootStore.reset();
  }
  rootStore = null;
}
