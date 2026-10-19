/**
 * "Sync test scripts": pulls the git checkout the runner executes from, so a scenario pushed to the
 * tracking branch can be run from the web UI without anyone logging on to the server.
 *
 * What it deliberately is NOT:
 *
 *   - Not a deploy. It never checks out another branch, never resets, never stashes. `git pull
 *     --ff-only` either moves HEAD forward along the branch already checked out, or fails and says
 *     why (local commits, a conflicting local edit). The server's checkout stays something an
 *     operator can reason about.
 *   - Not concurrent with a batch. Swapping scenario files under a running job would make its
 *     report describe scripts that no longer exist, so a sync is refused while any job is active,
 *     and only one sync runs at a time.
 *   - Not a rebuild. The runner executes TypeScript through tsx, so a pulled scenario is runnable
 *     as soon as it is on disk. The one exception is dependencies: when the runner's own
 *     package.json or lockfile changed, `npm install` runs in the runner, because otherwise the
 *     first job after the sync would fail on a missing module.
 */
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs';
import {
  ConflictError,
  REGRESSION_WORKSPACE_SYNC_STATUS,
  ValidationError,
  type RegressionWorkspaceStatusResponseDto,
  type RegressionWorkspaceSyncResponseDto,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import { resolveRunnerPaths } from './regression-runner-cli.util';
import {
  describeSyncOutcome,
  GIT_HEAD_FORMAT,
  gitFailureMessage,
  parseGitHead,
  runnerRelativeDir,
  summarizeChangedFiles,
  tailText,
  toRunnerRelativePaths,
} from './workspace-git.util';

const GIT_QUERY_TIMEOUT_MS = 15_000;
const GIT_PULL_TIMEOUT_MS = 3 * 60 * 1000;
const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_CHARS = 12_000;
const MAX_BUFFER = 16 * 1024 * 1024;

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        // npm on Windows is a .cmd shim, which only a shell can start. git is a real executable
        // everywhere, and never goes through a shell: its args are fixed strings, never user input.
        shell: process.platform === 'win32' && file === 'npm',
        env: {
          ...process.env,
          // A credential prompt would hang the request until the timeout; fail fast instead.
          GIT_TERMINAL_PROMPT: '0',
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          ...extraEnv,
        },
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
        let code = 0;
        if (err) {
          if (err.killed) {
            stderr = `${stderr}\n${file} timed out after ${timeoutMs}ms`;
            code = 124;
          } else if (typeof err.code === 'number') {
            code = err.code;
          } else {
            // ENOENT and friends: the binary itself is missing.
            stderr = `${stderr}\n${err.message}`;
            code = 127;
          }
        }
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

@Injectable()
export class RunnerWorkspaceSyncService {
  private readonly logger = new Logger(RunnerWorkspaceSyncService.name);
  private inProgress = false;
  private lastSync: RegressionWorkspaceSyncResponseDto | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  async getStatus(): Promise<RegressionWorkspaceStatusResponseDto> {
    const runnerRoot = resolveRunnerPaths().root;
    const base: RegressionWorkspaceStatusResponseDto = {
      runner_root: runnerRoot,
      repo_root: null,
      is_git_repo: false,
      branch: null,
      upstream: null,
      head_sha: null,
      head_short_sha: null,
      head_subject: null,
      head_committed_at: null,
      dirty_file_count: 0,
      sync_in_progress: this.inProgress,
      last_sync: this.lastSync,
    };
    if (!fs.existsSync(runnerRoot)) return base;

    const repoRoot = await this.git(runnerRoot, ['rev-parse', '--show-toplevel'], true);
    if (repoRoot === null) return base;

    const [branch, upstream, headRaw, porcelain] = await Promise.all([
      this.git(runnerRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], true),
      this.git(runnerRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], true),
      this.git(runnerRoot, ['log', '-1', `--format=${GIT_HEAD_FORMAT}`], true),
      // Tracked modifications only: untracked files (reports, evidence, .env) never block a pull.
      this.git(runnerRoot, ['status', '--porcelain', '--untracked-files=no', '--', '.'], true),
    ]);
    const head = headRaw ? parseGitHead(headRaw) : null;

    return {
      ...base,
      repo_root: repoRoot,
      is_git_repo: true,
      branch: branch && branch !== 'HEAD' ? branch : null,
      upstream,
      head_sha: head?.sha ?? null,
      head_short_sha: head?.shortSha ?? null,
      head_subject: head?.subject ?? null,
      head_committed_at: head?.committedAt ?? null,
      dirty_file_count: (porcelain ?? '').split(/\r?\n/).filter((l) => l.trim()).length,
    };
  }

  /**
   * A git query's trimmed stdout. Lenient: null when it fails (e.g. no upstream configured, not a
   * repository). Strict: a failure throws with git's own message.
   */
  private git(cwd: string, args: string[], lenient: true): Promise<string | null>;
  private git(cwd: string, args: string[], lenient: false): Promise<string>;
  private async git(cwd: string, args: string[], lenient: boolean): Promise<string | null> {
    const result = await run('git', args, cwd, GIT_QUERY_TIMEOUT_MS);
    if (result.code !== 0) {
      if (lenient) return null;
      throw new Error(gitFailureMessage(result.stderr, `git ${args[0]} failed (exit ${result.code})`));
    }
    return result.stdout.trim();
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  /**
   * Pulls, installs dependencies when needed, and calls `onUpdated` once the checkout has moved —
   * the hook the jobs service uses to drop its scenario-catalog cache. Resolves with the outcome,
   * including a FAILED one; it only rejects for a refused request (409/400).
   */
  async sync(
    requestedBy: string,
    onUpdated: () => void,
  ): Promise<RegressionWorkspaceSyncResponseDto> {
    if (this.inProgress) {
      throw new ConflictError('A test-script sync is already in progress.');
    }
    const active = await this.prisma.regressionJob.findFirst({
      where: { activeSlot: true },
      select: { id: true, status: true },
    });
    if (active) {
      throw new ConflictError(
        'A regression run is in progress; syncing test scripts under it would corrupt its report.',
        { active_job_id: active.id, active_job_status: active.status },
      );
    }

    const runnerRoot = resolveRunnerPaths().root;
    if (!fs.existsSync(runnerRoot)) {
      throw new ValidationError(`Runner checkout not found at ${runnerRoot}.`);
    }
    const repoRoot = await this.git(runnerRoot, ['rev-parse', '--show-toplevel'], true);
    if (repoRoot === null) {
      throw new ValidationError(`${runnerRoot} is not inside a git checkout, so it cannot be synced.`);
    }

    this.inProgress = true;
    const startedAt = new Date();
    const transcript: string[] = [];
    const note = (line: string): void => {
      transcript.push(line);
    };

    let beforeSha: string | null = null;
    let afterSha: string | null = null;
    let branch: string | null = null;
    let status: RegressionWorkspaceSyncResponseDto['status'] = REGRESSION_WORKSPACE_SYNC_STATUS.FAILED;
    let commitsPulled = 0;
    let summary = summarizeChangedFiles([]);
    let dependenciesInstalled = false;
    let catalogRefreshed = false;
    let message: string;

    try {
      branch = await this.git(runnerRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], true);
      const before = await this.git(runnerRoot, ['rev-parse', 'HEAD'], false);
      beforeSha = before;
      note(`$ git pull --ff-only  (${repoRoot}, ${branch ?? 'detached'} @ ${before.slice(0, 8)})`);

      // --ff-only: the server's branch must never grow a merge commit or lose local commits
      // because someone clicked a button. --no-recurse-submodules: the kit submodule is linked
      // into the runner by `file:` dependencies that need their own build; moving it here would
      // leave node_modules pointing at sources that no longer match.
      const pull = await run(
        'git',
        ['pull', '--ff-only', '--no-rebase', '--no-recurse-submodules'],
        repoRoot,
        GIT_PULL_TIMEOUT_MS,
      );
      note(pull.stdout.trim());
      if (pull.stderr.trim()) note(pull.stderr.trim());
      if (pull.code !== 0) {
        throw new Error(gitFailureMessage(pull.stderr, `git pull failed (exit ${pull.code})`));
      }

      const after = await this.git(runnerRoot, ['rev-parse', 'HEAD'], false);
      afterSha = after;
      if (after !== before) {
        const count = await this.git(runnerRoot, ['rev-list', '--count', `${before}..${after}`], true);
        commitsPulled = Number(count) || 0;
        const diff = await this.git(runnerRoot, ['diff', '--name-only', before, after, '--', '.'], false);
        summary = summarizeChangedFiles(
          toRunnerRelativePaths(diff, runnerRelativeDir(repoRoot, runnerRoot)),
        );

        if (summary.dependenciesChanged) {
          note('$ npm install --no-audit --no-fund  (runner manifest changed)');
          const install = await run(
            'npm',
            ['install', '--no-audit', '--no-fund'],
            runnerRoot,
            NPM_INSTALL_TIMEOUT_MS,
          );
          note(install.stdout.trim());
          if (install.stderr.trim()) note(install.stderr.trim());
          if (install.code !== 0) {
            throw new Error(`npm install failed (exit ${install.code}); the scripts were pulled but may not run.`);
          }
          dependenciesInstalled = true;
        }

        onUpdated();
        catalogRefreshed = true;
        status = REGRESSION_WORKSPACE_SYNC_STATUS.UPDATED;
      } else {
        status = REGRESSION_WORKSPACE_SYNC_STATUS.UP_TO_DATE;
      }
      message = describeSyncOutcome({ commitsPulled, summary, dependenciesInstalled });
      this.logger.log(`Test-script sync by ${requestedBy}: ${message}`);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
      note(`ERROR: ${message}`);
      this.logger.warn(`Test-script sync by ${requestedBy} failed: ${message}`);
    } finally {
      this.inProgress = false;
    }

    const finishedAt = new Date();
    const result: RegressionWorkspaceSyncResponseDto = {
      status,
      requested_by: requestedBy,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      branch,
      before_sha: beforeSha,
      after_sha: afterSha,
      commits_pulled: commitsPulled,
      changed_files: summary.files,
      changed_file_count: summary.total,
      scenario_files_changed: summary.scenarioFiles,
      dependencies_changed: summary.dependenciesChanged,
      dependencies_installed: dependenciesInstalled,
      catalog_refreshed: catalogRefreshed,
      message,
      output: tailText(transcript.filter(Boolean).join('\n'), MAX_OUTPUT_CHARS),
    };
    this.lastSync = result;
    return result;
  }
}
