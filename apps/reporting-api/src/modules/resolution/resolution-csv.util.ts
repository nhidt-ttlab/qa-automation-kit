import { FEATURE_DOMAIN_LABEL } from '@qakit/reporting-shared';
import type { FeatureDomain } from '@qakit/reporting-shared';
import { escapeCsvValue, toCsv } from '../../common/csv.util';

/**
 * CSV export of Resolution Queue issues, for taking answers back into the spec documents and
 * testcases they came from.
 *
 * One row per **affected test case**, not per issue: the point of the export is to walk a list of
 * testcases and edit each one, so every row has to be directly actionable. An issue that blocks
 * five testcases produces five rows, with its decision and resolution repeated on each — that
 * repetition is the feature, not redundancy.
 *
 * Pure: no Prisma, no filesystem, no clock. Both the HTTP endpoint and the CLI script format
 * through here so a column can never mean two different things depending on how you exported.
 */

/** Columns, in the order a doc author reads them: what and where first, then why, then history. */
export const RESOLUTION_CSV_COLUMNS = [
  'display_key',
  'test_case_id',
  'scenario_key',
  'check_test_ids',
  'kind',
  'workflow_status',
  'priority',
  'owner',
  'feature',
  'module',
  'title',
  'decision',
  'decision_by',
  'decision_at',
  'resolution',
  'resolution_type',
  'resolved_by',
  'resolved_at',
  'user_summary',
  'comments',
  'comment_count',
  'latest_reason',
  'latest_run_id',
  'observation_count',
  'verification_note',
  'verified_by',
  'verified_at',
  'verification_run_id',
  'first_seen_at',
  'last_seen_at',
  'recurrence_count',
  'defect_signature_id',
  'redmine_issue_ids',
  'import_key',
] as const;

export type ResolutionCsvColumn = (typeof RESOLUTION_CSV_COLUMNS)[number];

/** The subset of an issue the exporter needs. Kept structural so tests need no Prisma types. */
export interface ExportableIssue {
  importKey: string;
  displayKey: string;
  title: string;
  kind: string;
  workflowStatus: string;
  priority: string | null;
  owner: string | null;
  module: string | null;
  domain: string | null;
  userSummary: string | null;
  decision: string | null;
  decisionBy: string | null;
  decisionAt: Date | null;
  resolution: string | null;
  resolutionType: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  verificationNote: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  verificationRunId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  recurrenceCount: number;
  defectSignatureId: number | null;
  observations: ExportableObservation[];
  comments: ExportableComment[];
  redmineLinks: Array<{ redmineIssueId: number }>;
}

export interface ExportableObservation {
  testCaseId: string;
  scenarioKey: string;
  checkTestId: string | null;
  checkSequence: number | null;
  rawReason: string;
  runId: string;
  observedAt: Date;
}

export interface ExportableComment {
  author: string;
  body: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// CSV encoding
// ---------------------------------------------------------------------------

/**
 * The encoding primitives moved to common/csv.util.ts once a second export needed them.
 * Re-exported here so this module stays the single import for anything formatting resolution
 * rows, and so existing callers did not have to change.
 */
export { escapeCsvValue, toCsv };

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

/** ISO-8601, or empty. Dates stay machine-readable; the spreadsheet can reformat them. */
function iso(date: Date | null | undefined): string {
  return date ? date.toISOString() : '';
}

/**
 * `qa_minh (2026-09-06T09:00:00.000Z): body` per comment, oldest first, one per line.
 *
 * Joined with a newline rather than a separator character: comment bodies routinely contain
 * semicolons and pipes, and a delimiter that appears inside the data is not a delimiter. The
 * cell is quoted, so embedded newlines survive the round trip.
 */
export function formatComments(
  comments: ReadonlyArray<ExportableComment>,
): string {
  return [...comments]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((c) => `${c.author} (${iso(c.createdAt)}): ${c.body}`)
    .join('\n');
}

/** Groups an issue's observations by test case, preserving first-seen order. */
function groupByTestCase(
  observations: ReadonlyArray<ExportableObservation>,
): Array<{
  testCaseId: string;
  scenarioKey: string;
  items: ExportableObservation[];
}> {
  const groups = new Map<
    string,
    { testCaseId: string; scenarioKey: string; items: ExportableObservation[] }
  >();
  for (const o of observations) {
    const existing = groups.get(o.testCaseId);
    if (existing) existing.items.push(o);
    else
      groups.set(o.testCaseId, {
        testCaseId: o.testCaseId,
        scenarioKey: o.scenarioKey,
        items: [o],
      });
  }
  return [...groups.values()];
}

/** Assertion ids for one test case, deduplicated, in sequence order. Falls back to `check N`. */
function formatCheckIds(items: ReadonlyArray<ExportableObservation>): string {
  const ids = [...items]
    .sort((a, b) => (a.checkSequence ?? 0) - (b.checkSequence ?? 0))
    .map(
      (o) =>
        o.checkTestId ??
        (o.checkSequence != null ? `check ${o.checkSequence}` : 'run-level'),
    );
  return [...new Set(ids)].join('; ');
}

/**
 * One issue to its rows — one per affected test case.
 *
 * An issue with no observations still produces a single row. That is deliberate: a run purged
 * from the runner can leave an issue whose evidence is gone, and dropping it from the export
 * would silently lose a decision someone recorded.
 */
export function buildIssueRows(issue: ExportableIssue): string[][] {
  const comments = formatComments(issue.comments);
  const redmine = issue.redmineLinks.map((l) => l.redmineIssueId).join('; ');
  const feature = issue.domain
    ? (FEATURE_DOMAIN_LABEL[issue.domain as FeatureDomain] ?? issue.domain)
    : '';

  const shared = {
    kind: issue.kind,
    workflowStatus: issue.workflowStatus,
    priority: issue.priority ?? '',
    owner: issue.owner ?? '',
    feature,
    module: issue.module ?? '',
    title: issue.title,
    decision: issue.decision ?? '',
    decisionBy: issue.decisionBy ?? '',
    decisionAt: iso(issue.decisionAt),
    resolution: issue.resolution ?? '',
    resolutionType: issue.resolutionType ?? '',
    resolvedBy: issue.resolvedBy ?? '',
    resolvedAt: iso(issue.resolvedAt),
    userSummary: issue.userSummary ?? '',
    comments,
    commentCount: issue.comments.length,
    verificationNote: issue.verificationNote ?? '',
    verifiedBy: issue.verifiedBy ?? '',
    verifiedAt: iso(issue.verifiedAt),
    verificationRunId: issue.verificationRunId ?? '',
    firstSeenAt: iso(issue.firstSeenAt),
    lastSeenAt: iso(issue.lastSeenAt),
    recurrenceCount: issue.recurrenceCount,
    defectSignatureId: issue.defectSignatureId ?? '',
    redmine,
    importKey: issue.importKey,
  };

  const row = (perTestCase: {
    testCaseId: string;
    scenarioKey: string;
    checkIds: string;
    latestReason: string;
    latestRunId: string;
    observationCount: number;
  }): string[] =>
    [
      issue.displayKey,
      perTestCase.testCaseId,
      perTestCase.scenarioKey,
      perTestCase.checkIds,
      shared.kind,
      shared.workflowStatus,
      shared.priority,
      shared.owner,
      shared.feature,
      shared.module,
      shared.title,
      shared.decision,
      shared.decisionBy,
      shared.decisionAt,
      shared.resolution,
      shared.resolutionType,
      shared.resolvedBy,
      shared.resolvedAt,
      shared.userSummary,
      shared.comments,
      shared.commentCount,
      perTestCase.latestReason,
      perTestCase.latestRunId,
      perTestCase.observationCount,
      shared.verificationNote,
      shared.verifiedBy,
      shared.verifiedAt,
      shared.verificationRunId,
      shared.firstSeenAt,
      shared.lastSeenAt,
      shared.recurrenceCount,
      shared.defectSignatureId,
      shared.redmine,
      shared.importKey,
    ].map((v) => (v === null || v === undefined ? '' : String(v)));

  const groups = groupByTestCase(issue.observations);
  if (groups.length === 0) {
    return [
      row({
        testCaseId: '',
        scenarioKey: '',
        checkIds: '',
        latestReason: '',
        latestRunId: '',
        observationCount: 0,
      }),
    ];
  }

  return groups.map((group) => {
    // The newest occurrence is the one worth quoting: earlier runs may describe a state the
    // environment has since moved on from.
    const latest = group.items.reduce((newest, o) =>
      o.observedAt > newest.observedAt ? o : newest,
    );
    return row({
      testCaseId: group.testCaseId,
      scenarioKey: group.scenarioKey,
      checkIds: formatCheckIds(group.items),
      latestReason: latest.rawReason,
      latestRunId: latest.runId,
      observationCount: group.items.length,
    });
  });
}

/** Full document: header plus every issue's rows, in the order given. */
export function buildResolutionCsv(
  issues: ReadonlyArray<ExportableIssue>,
  options: { bom?: boolean } = {},
): string {
  const rows: unknown[][] = [[...RESOLUTION_CSV_COLUMNS]];
  for (const issue of issues) rows.push(...buildIssueRows(issue));
  return toCsv(rows, options);
}

/** `resolution-issues-2026-09-06.csv` — dated so successive exports do not overwrite. */
export function buildExportFilename(now: Date): string {
  return `resolution-issues-${now.toISOString().slice(0, 10)}.csv`;
}
