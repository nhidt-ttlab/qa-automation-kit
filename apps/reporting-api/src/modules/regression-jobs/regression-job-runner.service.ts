/**
 * Owns the child process for one regression batch: spawn, log tee, progress parsing, the
 * clean-all wipe, the post-run sync, cancellation and boot reconciliation.
 *
 * The HTTP-facing service (regression-jobs.service.ts) never touches a process; it creates the
 * row and hands the id here. That split is what keeps a request from ever waiting on a batch.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import {
  ConflictError,
  REGRESSION_CHILD_ENV_DENY_LIST,
  REGRESSION_CLEAN_SCOPE,
  REGRESSION_DATA_MODE,
  REGRESSION_JOB_ACTIVE_STATUSES,
  REGRESSION_JOB_LOG_STREAM,
  REGRESSION_JOB_STATUS,
  REGRESSION_JOB_SYNC_STATUS,
  REGRESSION_SUITE_KIND,
  type RegressionJobStatus,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import {
  resolveRegressionSqlitePath,
  resolveSafeArtifactPath,
} from '../runs/artifact-storage.util';
import { SqliteSyncService } from '../sync/sqlite-sync.service';
import { LineSplitter } from './regression-log.util';
import { RegressionJobLog } from './regression-job-log.store';
import {
  applyProgressLine,
  createProgressAccumulator,
  type ProgressAccumulator,
} from './regression-progress.util';
import {
  cancelFilePath,
  checkRunnerAvailability,
  environmentConfigPath,
  environmentSupportsUi,
  findLiveSessionLocks,
  environmentFileRequired,
  resolveRunnerPaths,
  runnerSpawnArgs,
  type RunnerPaths,
} from './regression-runner-cli.util';
import {
  describeWipePlan,
  planRunnerWipe,
  RUNNER_WIPE_ROOTS,
  type RunnerDirEntry,
  type WipePlan,
} from './runner-workspace.util';

/** Persist progress at most this often; a 1140-scenario batch would otherwise be 1140 UPDATEs. */
const PROGRESS_FLUSH_MS = 5000;
const PROGRESS_FLUSH_LINES = 20;

const DEFAULT_JOB_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;

/** How long a cancelled child gets to stop cooperatively before signals escalate. */
const CANCEL_SIGINT_GRACE_MS = 20_000;
const CANCEL_SIGKILL_GRACE_MS = 20_000;

/** stdin is 'ignore', so it is null; stdout and stderr are piped. */
type RunnerChild = ChildProcessByStdio<null, Readable, Readable>;

interface ActiveJob {
  jobId: number;
  child: RunnerChild;
  log: RegressionJobLog;
  cancelled: boolean;
}

@Injectable()
export class RegressionJobRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegressionJobRunnerService.name);
  private active: ActiveJob | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SqliteSyncService,
  ) {}

  /**
   * A restarted API cannot adopt a child it did not spawn, so any row still marked active belongs
   * to a process that is gone (or, rarely, still running detached). Both are released here so the
   * mutex does not stay wedged across a PM2 restart.
   *
   * The pid is logged but deliberately NOT killed: pids are reused, and killing the wrong process
   * is a far worse failure than leaving one orphan to finish. Runs it completes still reach
   * Postgres on the next sync.
   *
   * Runs on bootstrap, before the HTTP server accepts traffic, so the first POST sees a clean slate.
   */
  async onApplicationBootstrap(): Promise<void> {
    const stale = await this.prisma.regressionJob.findMany({
      where: { status: { in: [...REGRESSION_JOB_ACTIVE_STATUSES] } },
      select: { id: true, pid: true, label: true },
    });
    if (stale.length === 0) return;

    for (const job of stale) {
      this.logger.warn(
        `Job ${job.id} (${job.label}) was still marked active at startup; marking ORPHANED. ` +
          `Its process (pid ${job.pid ?? 'unknown'}) was not killed - check it manually if it is still running.`,
      );
      await this.prisma.regressionJob.update({
        where: { id: job.id },
        data: {
          status: REGRESSION_JOB_STATUS.ORPHANED,
          activeSlot: null,
          finishedAt: new Date(),
          errorSummary:
            'The API restarted while this job was running, so its outcome is unknown.',
        },
      });
    }
  }

  get activeJobId(): number | null {
    return this.active?.jobId ?? null;
  }

  // -------------------------------------------------------------------------
  // The state machine
  // -------------------------------------------------------------------------

  /**
   * Drives one job to a terminal status. Never rejects: every failure is recorded on the row,
   * because the caller is a fire-and-forget `void` from the HTTP layer and an unhandled rejection
   * would take the process down with it.
   */
  async runJob(jobId: number): Promise<void> {
    const job = await this.prisma.regressionJob.findUnique({ where: { id: jobId } });
    if (!job) {
      this.logger.error(`runJob(${jobId}): no such job`);
      return;
    }

    const log = new RegressionJobLog(jobId);
    const paths = resolveRunnerPaths();
    const acc = createProgressAccumulator();

    try {
      await this.setStatus(jobId, REGRESSION_JOB_STATUS.PREPARING);
      log.append(REGRESSION_JOB_LOG_STREAM.API, `Preparing job ${jobId} (${job.label})`);

      await this.preflight(job, paths, log);

      // The clean-all wipe, and the sync that must precede it.
      if (job.cleanScope === REGRESSION_CLEAN_SCOPE.ALL) {
        await this.syncBeforeWipe(jobId, log);
        this.executeRunnerWipe(paths, log);
      }

      await this.setStatus(jobId, REGRESSION_JOB_STATUS.RUNNING, { startedAt: new Date() });
      const outcome = await this.spawnBatch(job, paths, log, acc);

      await this.finishRun(jobId, outcome, acc, log);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.append(REGRESSION_JOB_LOG_STREAM.API, `ERROR: ${message}`);
      await this.terminate(jobId, REGRESSION_JOB_STATUS.ERRORED, log, {
        errorSummary: message,
      });
    } finally {
      this.active = null;
      await log.close();
    }
  }

  /** Everything that can be known to be wrong before a process is spawned. */
  private async preflight(
    job: { environment: string; kind: string | null; dataMode: string },
    paths: RunnerPaths,
    log: RegressionJobLog,
  ): Promise<void> {
    const availability = checkRunnerAvailability(paths);
    if (!availability.available) throw new Error(availability.reason);

    // A fixed environment list (REGRESSION_RUNNER_ENVIRONMENTS) needs no file per environment.
    const configPath = environmentConfigPath(paths, job.environment);
    if (environmentFileRequired(paths) && !fs.existsSync(configPath)) {
      throw new Error(`Environment config not found at ${configPath}`);
    }

    // A UI batch against an environment with no `web` block fails once per scenario. Catch it once.
    if (job.kind === REGRESSION_SUITE_KIND.UI && !environmentSupportsUi(paths, job.environment)) {
      throw new Error(
        `Environment "${job.environment}" has no "web" block, so UI scenarios cannot run against it.`,
      );
    }

    // Only seeded runs take a session lock, and the runner hard-errors on a live one.
    if (job.dataMode === REGRESSION_DATA_MODE.SEEDED) {
      const live = findLiveSessionLocks(paths);
      if (live.length > 0) {
        throw new Error(
          `A seeded session is locked by a live process: ${live.join(', ')}. ` +
            `Two runs must not share one session.`,
        );
      }
    }

    log.append(REGRESSION_JOB_LOG_STREAM.API, `Runner: ${paths.root}`);
  }

  /**
   * The sync that runs BEFORE a clean-all wipe.
   *
   * This is the guarantee that makes clean-all acceptable as a default: everything the runner has
   * produced is already in Postgres, and the UI-evidence pass has copied the screenshots, video
   * and traces out of the tree that is about to be deleted. It cannot be skipped to save time —
   * skipping it would destroy evidence that has no other copy.
   */
  private async syncBeforeWipe(jobId: number, log: RegressionJobLog): Promise<void> {
    log.append(
      REGRESSION_JOB_LOG_STREAM.API,
      'Clean scope is "all": syncing to Postgres first so nothing unsynced is lost.',
    );
    await this.prisma.regressionJob.update({
      where: { id: jobId },
      data: { syncStatus: REGRESSION_JOB_SYNC_STATUS.RUNNING },
    });
    const report = await this.sync.sync({
      onProgress: (m) => log.append(REGRESSION_JOB_LOG_STREAM.SYNC, m),
    });
    log.append(
      REGRESSION_JOB_LOG_STREAM.API,
      `Pre-wipe sync complete: ${report.importedRunIds.length} run(s) imported, ` +
        `${report.uiEvidence.filesCopied} evidence file(s) copied.`,
    );
  }

  /**
   * The wipe itself. Order is the point: database first, then the trees.
   *
   * The runner's own --clean-all does the reverse and therefore leaves a half-wiped workspace when
   * the database is locked - which on Windows it routinely is, because `npm run review` holds it
   * open. Deleting it first means an EBUSY arrives with every artifact still intact.
   */
  private executeRunnerWipe(paths: RunnerPaths, log: RegressionJobLog): void {
    const entriesByRoot: Record<string, RunnerDirEntry[]> = {};
    for (const root of RUNNER_WIPE_ROOTS) {
      try {
        entriesByRoot[root] = fs
          .readdirSync(resolveSafeArtifactPath(paths.root, root), { withFileTypes: true })
          .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
      } catch {
        entriesByRoot[root] = [];
      }
    }

    // The database the sync reads, not an assumed name: wiping db/regression.db while the runner
    // keeps db/runs.db leaves stored runs pointing at evidence this same wipe deletes.
    const sqlitePath = resolveRegressionSqlitePath();
    const dbFile = path.relative(paths.root, sqlitePath).replace(/\\/g, '/');
    if (!dbFile || dbFile.startsWith('../') || path.isAbsolute(dbFile)) {
      throw new Error(
        `The runner database ${sqlitePath} is outside the runner checkout ${paths.root}, so a ` +
          `"clean everything" wipe cannot remove it. Nothing was deleted.`,
      );
    }
    const plan = planRunnerWipe(entriesByRoot, dbFile);
    log.append(REGRESSION_JOB_LOG_STREAM.API, `Wipe plan: ${describeWipePlan(plan)}`);

    this.wipeDatabaseFiles(paths, plan, log);

    for (const rel of plan.deletes) {
      fs.rmSync(resolveSafeArtifactPath(paths.root, rel), { recursive: true, force: true });
      log.append(REGRESSION_JOB_LOG_STREAM.API, `wiped ${rel}/`);
    }
    for (const rel of plan.preserved) {
      log.append(REGRESSION_JOB_LOG_STREAM.API, `preserved ${rel}`);
    }
  }

  private wipeDatabaseFiles(paths: RunnerPaths, plan: WipePlan, log: RegressionJobLog): void {
    for (const rel of plan.dbFiles) {
      const abs = resolveSafeArtifactPath(paths.root, rel);
      try {
        fs.rmSync(abs, { force: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
          throw new ConflictError(
            `${rel} is locked by another process, so nothing was deleted. The review server ` +
              `(npm run review, http://localhost:4173) holds it open - stop it and retry.`,
            { path: rel, code },
          );
        }
        throw err;
      }
    }
    log.append(REGRESSION_JOB_LOG_STREAM.API, `wiped ${plan.dbFiles.length} database file(s)`);
  }

  // -------------------------------------------------------------------------
  // The child process
  // -------------------------------------------------------------------------

  private buildChildEnv(envPatch: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    const denied = new Set<string>(REGRESSION_CHILD_ENV_DENY_LIST);
    for (const [key, value] of Object.entries(process.env)) {
      if (!denied.has(key)) env[key] = value;
    }
    return { ...env, ...envPatch };
  }

  private async spawnBatch(
    job: { id: number; argv: unknown; envPatch: unknown },
    paths: RunnerPaths,
    log: RegressionJobLog,
    acc: ProgressAccumulator,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null; cancelled: boolean }> {
    const argv = (job.argv as string[]) ?? [];
    const envPatch = (job.envPatch as Record<string, string>) ?? {};

    const spawnArgs = runnerSpawnArgs(paths, argv);
    log.append(REGRESSION_JOB_LOG_STREAM.API, `Spawning: node ${spawnArgs.join(' ')}`);

    const child = spawn(
      process.execPath,
      spawnArgs,
      {
        cwd: paths.root,
        env: {
          ...this.buildChildEnv(envPatch),
          // How the runner learns it should stop. A signal cannot do this on Windows.
          [process.env.RUNNER_CANCEL_FILE_ENV || 'QAKIT_CANCEL_FILE']: cancelFilePath(paths, job.id),
        },
        // stdin is ignored: nothing in a batch is interactive, and an inherited stdin would let a
        // stray prompt hang the job forever.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      },
    );

    this.active = { jobId: job.id, child, log, cancelled: false };
    await this.prisma.regressionJob.update({
      where: { id: job.id },
      data: { pid: child.pid ?? null },
    });

    return this.pumpChild(job.id, child, log, acc);
  }

  private pumpChild(
    jobId: number,
    child: RunnerChild,
    log: RegressionJobLog,
    acc: ProgressAccumulator,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null; cancelled: boolean }> {
    return new Promise((resolve, reject) => {
      const splitter = new LineSplitter();
      let linesSinceFlush = 0;
      let lastActivity = Date.now();

      const flushProgress = (): void => {
        linesSinceFlush = 0;
        void this.persistProgress(jobId, acc);
      };
      const progressTimer = setInterval(flushProgress, PROGRESS_FLUSH_MS);

      const overallTimeout = Number(
        process.env.REGRESSION_JOB_TIMEOUT_MS || DEFAULT_JOB_TIMEOUT_MS,
      );
      const inactivityTimeout = Number(
        process.env.REGRESSION_JOB_INACTIVITY_TIMEOUT_MS || DEFAULT_INACTIVITY_TIMEOUT_MS,
      );
      const startedAt = Date.now();

      const watchdog = setInterval(() => {
        const now = Date.now();
        if (now - lastActivity > inactivityTimeout) {
          log.append(
            REGRESSION_JOB_LOG_STREAM.API,
            `No output for ${Math.round(inactivityTimeout / 60000)} minutes - terminating.`,
          );
          child.kill('SIGKILL');
        } else if (now - startedAt > overallTimeout) {
          log.append(
            REGRESSION_JOB_LOG_STREAM.API,
            `Exceeded the ${Math.round(overallTimeout / 3600000)}h limit - terminating.`,
          );
          child.kill('SIGKILL');
        }
      }, 60_000);

      const cleanup = (): void => {
        clearInterval(progressTimer);
        clearInterval(watchdog);
      };

      const onChunk = (chunk: string): void => {
        lastActivity = Date.now();
        for (const line of splitter.push(chunk)) {
          log.append(REGRESSION_JOB_LOG_STREAM.RUNNER, line);
          if (applyProgressLine(acc, line)) linesSinceFlush++;
          if (linesSinceFlush >= PROGRESS_FLUSH_LINES) flushProgress();
        }
      };

      // The runner writes everything, warnings and errors included, to stdout; stderr is drained
      // anyway so a full pipe buffer can never block the child.
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', onChunk);
      child.stderr.on('data', onChunk);

      child.on('error', (err) => {
        cleanup();
        reject(err);
      });

      child.on('close', (code, signal) => {
        cleanup();
        for (const line of splitter.flush()) {
          log.append(REGRESSION_JOB_LOG_STREAM.RUNNER, line);
          applyProgressLine(acc, line);
        }
        resolve({ code, signal, cancelled: this.active?.cancelled ?? false });
      });
    });
  }

  private async persistProgress(jobId: number, acc: ProgressAccumulator): Promise<void> {
    try {
      await this.prisma.regressionJob.update({
        where: { id: jobId },
        data: {
          passCount: acc.pass,
          blockedCount: acc.blocked,
          failCount: acc.fail,
          ...(acc.total !== undefined ? { selectedCount: acc.total } : {}),
        },
      });
    } catch (err) {
      // Progress is a nicety; losing an update must never fail the batch that produced it.
      this.logger.warn(`Failed to persist progress for job ${jobId}: ${String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Finishing
  // -------------------------------------------------------------------------

  private async finishRun(
    jobId: number,
    outcome: { code: number | null; signal: NodeJS.Signals | null; cancelled: boolean },
    acc: ProgressAccumulator,
    log: RegressionJobLog,
  ): Promise<void> {
    // 130 is the runner's own Ctrl-C exit code, and a signal means something killed it.
    const wasCancelled = outcome.cancelled || outcome.code === 130 || outcome.signal !== null;
    let status: RegressionJobStatus = wasCancelled
      ? REGRESSION_JOB_STATUS.CANCELLED
      : outcome.code === 0
        ? REGRESSION_JOB_STATUS.SUCCEEDED
        : REGRESSION_JOB_STATUS.FAILED;

    // The sync runs whatever the verdict: a batch that failed still produced runs worth importing,
    // and a cancelled one produced everything up to the point it stopped.
    await this.setStatus(jobId, REGRESSION_JOB_STATUS.SYNCING);
    let syncStatus: string = REGRESSION_JOB_SYNC_STATUS.OK;
    let syncedRunCount: number | null = null;
    let syncError: string | null = null;
    try {
      const report = await this.sync.sync({
        onProgress: (m) => log.append(REGRESSION_JOB_LOG_STREAM.SYNC, m),
      });
      syncedRunCount = report.importedRunIds.length;
      log.append(
        REGRESSION_JOB_LOG_STREAM.API,
        `Sync complete: ${syncedRunCount} run(s) imported.`,
      );
    } catch (err) {
      syncStatus = REGRESSION_JOB_SYNC_STATUS.FAILED;
      syncError = err instanceof Error ? err.message : String(err);
      log.append(REGRESSION_JOB_LOG_STREAM.API, `Sync FAILED: ${syncError}`);
      // Deliberately does not change `status`. The batch's verdict is about the product; a failed
      // import is about this API, and conflating them would report a green run as a failure.
    }

    await this.terminate(jobId, status, log, {
      exitCode: outcome.code,
      signal: outcome.signal,
      passCount: acc.pass,
      blockedCount: acc.blocked,
      failCount: acc.fail,
      selectedCount: acc.total,
      summaryPath: acc.summaryPath ? this.toRunnerRelative(acc.summaryPath) : undefined,
      syncStatus,
      syncedRunCount,
      errorSummary: syncError ? `Sync failed: ${syncError}` : undefined,
    });
  }

  /** The runner logs an absolute summary path; rows store it runner-relative like every artifact. */
  private toRunnerRelative(absolutePath: string): string {
    const root = resolveRunnerPaths().root;
    const normalized = absolutePath.replace(/\\/g, '/');
    const normalizedRoot = root.replace(/\\/g, '/');
    return normalized.startsWith(normalizedRoot)
      ? normalized.slice(normalizedRoot.length).replace(/^\//, '')
      : normalized;
  }

  private async setStatus(
    jobId: number,
    status: RegressionJobStatus,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.regressionJob.update({
      where: { id: jobId },
      data: { status, ...extra },
    });
  }

  /** The single exit door: releases the mutex and stamps finishedAt, which the CHECKs require together. */
  private async terminate(
    jobId: number,
    status: RegressionJobStatus,
    log: RegressionJobLog,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const job = await this.prisma.regressionJob.findUnique({
      where: { id: jobId },
      select: { startedAt: true },
    });
    const finishedAt = new Date();
    const cleaned = Object.fromEntries(
      Object.entries(extra).filter(([, v]) => v !== undefined),
    );

    await this.prisma.regressionJob.update({
      where: { id: jobId },
      data: {
        status,
        activeSlot: null,
        finishedAt,
        durationMs: job?.startedAt ? finishedAt.getTime() - job.startedAt.getTime() : null,
        logLineCount: log.lineCount,
        ...cleaned,
      },
    });

    // The cancel flag is per-job and must not outlive it, or the next job would stop immediately.
    try {
      fs.rmSync(cancelFilePath(resolveRunnerPaths(), jobId), { force: true });
    } catch {
      // Nothing to clean up.
    }
  }

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  /**
   * Asks a running batch to stop.
   *
   * The cancel FILE is the primary mechanism and the only one that is graceful on Windows: Node
   * cannot deliver SIGINT to a child there, so `kill('SIGINT')` becomes a hard TerminateProcess,
   * the runner's own SIGINT handler never runs, and a seeded batch strands live rows on the shared
   * tenant. The runner checks for this file at the top of its scenario loop and breaks, letting
   * its `finally` close the session and write the summary.
   *
   * Signals follow only as an escalation, for a batch wedged inside a single long scenario.
   */
  requestCancel(jobId: number): boolean {
    const active = this.active;
    if (!active || active.jobId !== jobId) return false;

    active.cancelled = true;
    const paths = resolveRunnerPaths();
    try {
      fs.mkdirSync(paths.sessionsDir, { recursive: true });
      fs.writeFileSync(cancelFilePath(paths, jobId), new Date().toISOString(), 'utf8');
      active.log.append(
        REGRESSION_JOB_LOG_STREAM.API,
        'Cancel requested. The batch will stop after the scenario in flight.',
      );
    } catch (err) {
      active.log.append(
        REGRESSION_JOB_LOG_STREAM.API,
        `Could not write the cancel file (${String(err)}); falling back to signals.`,
      );
    }

    setTimeout(() => {
      if (this.active?.jobId === jobId && !active.child.killed) {
        active.log.append(REGRESSION_JOB_LOG_STREAM.API, 'Still running - sending SIGINT.');
        active.child.kill('SIGINT');
        setTimeout(() => {
          if (this.active?.jobId === jobId && !active.child.killed) {
            active.log.append(REGRESSION_JOB_LOG_STREAM.API, 'Still running - sending SIGKILL.');
            active.child.kill('SIGKILL');
          }
        }, CANCEL_SIGKILL_GRACE_MS).unref();
      }
    }, CANCEL_SIGINT_GRACE_MS).unref();

    return true;
  }

  /** Live log for an in-flight job, so the controller can fan it out over SSE. */
  getActiveLog(jobId: number): RegressionJobLog | null {
    return this.active?.jobId === jobId ? this.active.log : null;
  }
}
