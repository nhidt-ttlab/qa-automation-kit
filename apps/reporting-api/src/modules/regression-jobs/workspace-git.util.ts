/**
 * Pure helpers behind "sync test scripts": the parsing and classification of git output, kept
 * free of I/O so the rules can be tested without a repository.
 *
 * The sync itself (runner-workspace-sync.service.ts) shells `git`; everything it needs to
 * *interpret* lives here.
 */
import * as path from 'path';
import { MAX_REGRESSION_SYNC_CHANGED_FILES } from '@qakit/reporting-shared';

/** `git log -1 --format=<GIT_HEAD_FORMAT>`: four fields separated by the ASCII unit separator. */
export const GIT_HEAD_FORMAT = '%H%x1f%h%x1f%s%x1f%cI';

export interface GitHead {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string;
}

export function parseGitHead(stdout: string): GitHead | null {
  const [sha, shortSha, subject, committedAt] = stdout.trim().split('\x1f');
  if (!sha || !shortSha) return null;
  return { sha, shortSha, subject: subject ?? '', committedAt: committedAt ?? '' };
}

/**
 * Converts a `git diff --name-only` listing (paths relative to the repository root, forward
 * slashes, one per line) to paths relative to the runner checkout, dropping anything outside it.
 *
 * `runnerRelDir` is the runner's directory relative to the repository root, e.g.
 * `tests/acme-regression`, or '' when the runner IS the repository.
 */
export function toRunnerRelativePaths(stdout: string, runnerRelDir: string): string[] {
  const prefix = runnerRelDir ? `${runnerRelDir.replace(/\\/g, '/').replace(/\/+$/, '')}/` : '';
  const out: string[] = [];
  for (const raw of stdout.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!prefix) {
      out.push(line);
      continue;
    }
    if (line.startsWith(prefix)) out.push(line.slice(prefix.length));
  }
  return out;
}

/** Scenario scripts, the files a tester means by "new test cases". */
export const SCENARIO_FILE_PATTERN = /\.scenario\.ts$/i;

/**
 * Files whose change means `npm install` must run before the new scripts can execute. Only the
 * runner's own manifest at its root counts: a package.json inside a fixture folder does not.
 */
export const DEPENDENCY_MANIFESTS: ReadonlySet<string> = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
]);

export interface ChangedFileSummary {
  /** Capped at MAX_REGRESSION_SYNC_CHANGED_FILES, scenario files first so the cap never hides them. */
  files: string[];
  total: number;
  scenarioFiles: number;
  dependenciesChanged: boolean;
}

export function summarizeChangedFiles(runnerRelative: readonly string[]): ChangedFileSummary {
  const scenarios: string[] = [];
  const others: string[] = [];
  let dependenciesChanged = false;
  for (const file of runnerRelative) {
    if (SCENARIO_FILE_PATTERN.test(file)) scenarios.push(file);
    else others.push(file);
    if (DEPENDENCY_MANIFESTS.has(file)) dependenciesChanged = true;
  }
  const ordered = [...scenarios, ...others];
  return {
    files: ordered.slice(0, MAX_REGRESSION_SYNC_CHANGED_FILES),
    total: ordered.length,
    scenarioFiles: scenarios.length,
    dependenciesChanged,
  };
}

/** The runner's path relative to the repository root, with forward slashes; '' when identical. */
export function runnerRelativeDir(repoRoot: string, runnerRoot: string): string {
  const rel = path.relative(repoRoot, runnerRoot);
  return rel.split(path.sep).join('/');
}

/** Keeps the last `maxChars` of a process transcript, marking the cut. */
export function tailText(text: string, maxChars: number): string {
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed.length <= maxChars) return trimmed;
  return `…(${trimmed.length - maxChars} chars omitted)\n${trimmed.slice(-maxChars)}`;
}

/** The one-line outcome shown in the UI. States what changed, in the tester's terms. */
export function describeSyncOutcome(input: {
  commitsPulled: number;
  summary: ChangedFileSummary;
  dependenciesInstalled: boolean;
}): string {
  if (input.commitsPulled === 0) return 'Already up to date: no new test scripts.';
  const parts = [
    `Pulled ${input.commitsPulled} commit${input.commitsPulled === 1 ? '' : 's'}`,
    `${input.summary.total} file${input.summary.total === 1 ? '' : 's'} changed under the runner`,
    `${input.summary.scenarioFiles} scenario script${input.summary.scenarioFiles === 1 ? '' : 's'}`,
  ];
  if (input.summary.dependenciesChanged) {
    parts.push(input.dependenciesInstalled ? 'dependencies installed' : 'dependencies NOT installed');
  }
  return `${parts.join(', ')}.`;
}

/**
 * The line of a failed git command worth showing. git puts the cause on an `error:`/`fatal:` line
 * and ends with a bare "Aborting", which is what a naive "last line" would surface.
 */
export function gitFailureMessage(stderr: string, fallback: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flagged = lines.find((l) => /^(fatal|error):\s*/i.test(l));
  if (flagged) return flagged.replace(/^(fatal|error):\s*/i, '');
  return lines.length > 0 ? lines[lines.length - 1] : fallback;
}
