import type { CreateRedmineIssueRequestDto } from '@qakit/reporting-shared';

/**
 * Tag every Autotest-created issue with this label so testers can filter for them in Redmine.
 */
export const AUTOTEST_TAG = 'Autotest';

/**
 * Marker mirrored into the issue subject as a filterable fallback — see buildAutotestTags().
 */
export const AUTOTEST_SUBJECT_MARKER = `[${AUTOTEST_TAG}]`;

const NOT_PROVIDED = '_Not provided_';

/**
 * Minimal shape of a TestRun (+ steps) needed to auto-fill bug report content.
 * Kept loose/structural so the mapper stays independent of the generated Prisma types.
 */
export interface RunEnrichmentSource {
  id?: string;
  testCaseId?: string;
  environment?: string | null;
  gitCommit?: string | null;
  gitBranch?: string | null;
  scenarioKey?: string;
  errorSummary?: string | null;
  defectStatement?: string | null;
  conclusion?: string | null;
  blockedReason?: string | null;
  businessScenario?: string | null;
  severity?: string | null;
  reproducibility?: string | null;
  steps?: Array<{ title: string; ok?: boolean }>;
}

/**
 * Fields rendered into the bug-report-template.md sections. All optional — anything left
 * unset renders as "Not provided" so the generated description stays deterministic and
 * reviewable in Redmine even when the caller only sends a subject.
 */
export interface BugReportContent {
  /** Traceability back to the run that produced the bug. Never caller-supplied. */
  run_id?: string;
  test_case_id?: string;
  scenario_key?: string;
  environment?: string;
  build_version?: string;
  device_os?: string;
  bug_type?: string;
  assigned_to?: string;
  sprint?: string;
  steps_to_reproduce?: string[];
  actual_result?: string;
  expected_result?: string;
  impact?: string;
  severity?: string;
  priority?: string;
  is_regression?: boolean;
  related_bugs?: string;
  frequency?: string;
  notes?: string;
}

/**
 * Merges the request payload with run data, letting the run fill in whatever the caller
 * omitted so the frontend doesn't have to resend everything the run already recorded.
 */
export function enrichBugReportContent(
  dto: CreateRedmineIssueRequestDto,
  run?: RunEnrichmentSource | null,
): BugReportContent {
  return {
    // Traceability comes from the run only — a caller cannot claim a run it did not
    // execute, and a wrong id here would point reviewers at the wrong evidence.
    run_id: run?.id ?? undefined,
    test_case_id: run?.testCaseId ?? undefined,
    // TestCase is keyed by (testCaseId, scenarioKey), so the test case id alone does not
    // identify a row — both are needed to find the case this run came from.
    scenario_key: run?.scenarioKey ?? undefined,
    environment: dto.environment ?? run?.environment ?? undefined,
    build_version:
      dto.build_version ?? run?.gitCommit ?? run?.gitBranch ?? undefined,
    device_os: dto.device_os,
    bug_type: dto.bug_type,
    assigned_to: dto.assigned_to,
    sprint: dto.sprint,
    steps_to_reproduce:
      dto.steps_to_reproduce ??
      (run?.steps?.length ? run.steps.map((step) => step.title) : undefined),
    actual_result:
      dto.actual_result ??
      dto.description ??
      run?.errorSummary ??
      run?.defectStatement ??
      undefined,
    expected_result: dto.expected_result ?? run?.conclusion ?? undefined,
    impact:
      dto.impact ?? run?.blockedReason ?? run?.businessScenario ?? undefined,
    severity: dto.severity ?? run?.severity ?? undefined,
    priority: dto.priority ?? undefined,
    is_regression: dto.is_regression,
    related_bugs: dto.related_bugs,
    frequency: dto.frequency ?? run?.reproducibility ?? undefined,
    notes: dto.notes,
  };
}

function line(label: string, value: string | undefined | null): string {
  return `- ${label}: ${value && value.trim() ? value : NOT_PROVIDED}`;
}

function block(value: string | undefined | null): string {
  return value && value.trim() ? value.trim() : NOT_PROVIDED;
}

function steps(values: string[] | undefined): string {
  if (!values || values.length === 0) {
    return NOT_PROVIDED;
  }
  return values.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

/**
 * Renders the Redmine issue description from the sections in bug-report-template.md:
 * Basic Info, Steps to Reproduce, Actual Result, Expected Result, Impact,
 * Severity & Priority, Notes. Deterministic output — same input always renders the
 * same Markdown, which keeps this testable and stable to review in Redmine.
 */
export function buildRedmineDescription(
  subject: string,
  content: BugReportContent,
  tags: string[],
): string {
  return [
    '## 1. Basic Info',
    line('Title', subject),
    line('Run ID', content.run_id),
    line('Test Case', content.test_case_id),
    line('Scenario', content.scenario_key),
    line('Environment', content.environment),
    line('Build Version', content.build_version),
    line('Device/OS', content.device_os),
    line('Type', content.bug_type),
    line('Assignee', content.assigned_to),
    line('Sprint', content.sprint),
    '',
    '## 2. Steps to Reproduce (Cách tái hiện)',
    steps(content.steps_to_reproduce),
    '',
    '## 3. Actual Result (Kết quả thực tế)',
    block(content.actual_result),
    '',
    '## 4. Expected Result (Kết quả mong đợi)',
    block(content.expected_result),
    '',
    '## 5. Impact (Ảnh hưởng)',
    block(content.impact),
    '',
    '## 6. Severity & Priority',
    line('Severity', content.severity),
    line('Priority', content.priority),
    '',
    '## 7. Notes',
    line(
      'Regression',
      content.is_regression === undefined
        ? undefined
        : content.is_regression
          ? 'Yes'
          : 'No',
    ),
    line('Related bugs', content.related_bugs),
    line('Frequency', content.frequency),
    block(content.notes),
    '',
    '---',
    `Tags: ${tags.join(', ')}`,
  ].join('\n');
}

/**
 * Always includes AUTOTEST_TAG, de-duplicated against any caller-supplied tags.
 */
export function buildAutotestTags(extraTags?: string[]): string[] {
  return Array.from(new Set([...(extraTags ?? []), AUTOTEST_TAG]));
}

/**
 * Tag-support fallback strategy:
 *
 * Redmine's core REST API has no native "tags" field on issues — only the optional
 * "Issue Tags" plugin adds one (as a comma-separated `tags` string on the issue payload).
 * We can't tell at request time whether a given Redmine instance has that plugin
 * installed without an extra round trip, so RedmineService always sends the best-effort
 * native `tags` param (harmless no-op if the plugin isn't installed — Rails strong
 * parameters silently drop unknown attributes) AND applies this subject marker
 * unconditionally as the guaranteed fallback. Redmine's built-in issue list ships a
 * "Subject contains" filter on every installation with no plugin or configuration
 * required, so `[Autotest]` in the subject is always filterable even when the tags
 * plugin is absent.
 */
export function applyAutotestSubjectMarker(subject: string): string {
  return subject.includes(AUTOTEST_SUBJECT_MARKER)
    ? subject
    : `${AUTOTEST_SUBJECT_MARKER} ${subject}`;
}
