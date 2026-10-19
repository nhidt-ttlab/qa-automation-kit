/**
 * Parsers for the lines a running batch emits, so a job row can show progress without waiting for
 * the process to exit.
 *
 * Two shapes reach stdout, and the prefix is optional in both directions:
 *
 *   [<ISO>] [<LEVEL>] <message>                                    every logger call
 *   [<n>/<total>] <VERDICT> <TC-ID> <scenario> (<s>s)              wrapped in the above
 *   Batch [all] — 566 run in 41.2s                                 bare console.log, no prefix
 *     PASS 500   BLOCKED 40   FAIL 26                              bare console.log, no prefix
 *   Summary: <absolute path>                                       bare console.log, no prefix
 *
 * Everything here is pure and total: an unrecognised line returns null rather than throwing, so a
 * stray line from npm or a scenario's own output can never fail a job.
 */

const LOGGER_PREFIX = /^\[\d{4}-\d{2}-\d{2}T[^\]]*\]\s+\[(?:DEBUG|INFO|WARN|ERROR)\]\s+/;

/** `[12/566] PASS     TC-DH-L01        po-list-keyword-search (3.4s)` */
const PROGRESS = /^\[(\d+)\/(\d+)\]\s+(PASS|BLOCKED|FAIL)\s+(\S+)\s+(.*?)\s+\(([\d.]+)s\)/;

/** `Batch [all]: 566 scenario(s) against "qa"` */
const BATCH_HEADER = /^Batch \[(.*)\]:\s+(\d+)\s+scenario\(s\)\s+against\s+"(.*)"/;

/** `  PASS 500   BLOCKED 40   FAIL 26` */
const COUNTS = /^\s*PASS\s+(\d+)\s+BLOCKED\s+(\d+)\s+FAIL\s+(\d+)\s*$/;

/** `Summary: C:\...\reports\_batches\....md` */
const SUMMARY_PATH = /^Summary:\s+(.+?)\s*$/;

export type RegressionVerdict = 'PASS' | 'BLOCKED' | 'FAIL';

export interface ScenarioProgress {
  index: number;
  total: number;
  verdict: RegressionVerdict;
  testCaseId: string;
  scenario: string;
  durationMs: number;
}

export interface BatchCounts {
  pass: number;
  blocked: number;
  fail: number;
}

/** Removes the logger prefix if present, so every parser below sees the same shape. */
export function stripLoggerPrefix(line: string): string {
  return line.replace(LOGGER_PREFIX, '');
}

export function parseScenarioProgress(line: string): ScenarioProgress | null {
  const m = PROGRESS.exec(stripLoggerPrefix(line).trim());
  if (!m) return null;
  return {
    index: Number(m[1]),
    total: Number(m[2]),
    verdict: m[3] as RegressionVerdict,
    testCaseId: m[4],
    // A scenario key never contains a space, but the error text appended to a FAIL line does;
    // the non-greedy capture stops at the duration, so trailing prose cannot leak in.
    scenario: m[5].trim(),
    durationMs: Math.round(Number(m[6]) * 1000),
  };
}

export function parseBatchHeader(
  line: string,
): { label: string; total: number; environment: string } | null {
  const m = BATCH_HEADER.exec(stripLoggerPrefix(line).trim());
  if (!m) return null;
  return { label: m[1], total: Number(m[2]), environment: m[3] };
}

export function parseBatchCounts(line: string): BatchCounts | null {
  const m = COUNTS.exec(stripLoggerPrefix(line));
  if (!m) return null;
  return { pass: Number(m[1]), blocked: Number(m[2]), fail: Number(m[3]) };
}

export function parseSummaryPath(line: string): string | null {
  const m = SUMMARY_PATH.exec(stripLoggerPrefix(line).trim());
  if (!m) return null;
  const value = m[1].trim();
  // Require a path separator. A scenario that happens to log "Summary: all good" would otherwise
  // be taken for the batch summary and stored as this job's artifact path.
  return value.includes('\\') || value.includes('/') ? value : null;
}

/**
 * Running tally, updated line by line. Kept as an explicit object rather than closure state so the
 * runner service can persist it on a throttle and a spec can drive it with a fixture transcript.
 */
export interface ProgressAccumulator {
  total?: number;
  completed: number;
  pass: number;
  blocked: number;
  fail: number;
  summaryPath?: string;
  /** True once the batch's own tail counts were seen, which supersede the running tally. */
  finalCounts: boolean;
}

export function createProgressAccumulator(): ProgressAccumulator {
  return { completed: 0, pass: 0, blocked: 0, fail: 0, finalCounts: false };
}

/** Returns true when the line changed the accumulator, so callers can skip redundant writes. */
export function applyProgressLine(acc: ProgressAccumulator, line: string): boolean {
  const header = parseBatchHeader(line);
  if (header) {
    acc.total = header.total;
    return true;
  }

  const progress = parseScenarioProgress(line);
  if (progress) {
    acc.total = progress.total;
    acc.completed = progress.index;
    if (progress.verdict === 'PASS') acc.pass++;
    else if (progress.verdict === 'BLOCKED') acc.blocked++;
    else acc.fail++;
    return true;
  }

  // The tail counts win over the tally: they are what the runner wrote to the summary file, and
  // they stay correct even if a progress line was malformed or the log was truncated.
  const counts = parseBatchCounts(line);
  if (counts) {
    acc.pass = counts.pass;
    acc.blocked = counts.blocked;
    acc.fail = counts.fail;
    acc.finalCounts = true;
    return true;
  }

  const summary = parseSummaryPath(line);
  if (summary) {
    acc.summaryPath = summary;
    return true;
  }

  return false;
}
