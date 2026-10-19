import { makeAutoObservable, runInAction } from 'mobx';
import type { RedmineIssueResponseDto } from '@qakit/reporting-shared';

import { RedmineService } from '../service/redmineService';

export class RedmineStore {
  isCreatingIssue = false;
  issueCreationError: string | null = null;
  lastCreatedIssue: RedmineIssueResponseDto | null = null;

  constructor(private readonly redmineService: RedmineService) {
    makeAutoObservable(this);
  }

  async createRedmineIssue(runId: string, payload: Record<string, unknown>) {
    this.isCreatingIssue = true;
    this.issueCreationError = null;

    try {
      const issue = await this.redmineService.createIssue(runId, payload);
      runInAction(() => {
        this.lastCreatedIssue = issue;
      });
      return issue;
    } catch (error) {
      runInAction(() => {
        this.issueCreationError = error instanceof Error ? error.message : 'Failed to create issue';
      });
      throw error;
    } finally {
      runInAction(() => {
        this.isCreatingIssue = false;
      });
    }
  }

  reset() {
    this.isCreatingIssue = false;
    this.issueCreationError = null;
    this.lastCreatedIssue = null;
  }
}
