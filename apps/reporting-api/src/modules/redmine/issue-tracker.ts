/**
 * The seam between the reporting API and an issue tracker. Redmine (`RedmineService`) is the first
 * implementation; another tracker implements this interface and is bound to `ISSUE_TRACKER` in its
 * own module, leaving runs, defects and the resolution queue unchanged.
 */
export interface IssueTracker<CreateRequest, Issue> {
  /** Stable tracker id, e.g. `redmine`. */
  readonly name: string;
  /** Whether credentials are configured; without them creating an issue fails fast. */
  isConfigured(): boolean;
  /** Files an issue for a test run and records the link on the run's defect signature. */
  createIssueForRun(runId: string, request: CreateRequest): Promise<Issue>;
}

export const ISSUE_TRACKER = Symbol('ISSUE_TRACKER');
