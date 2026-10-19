/**
 * The HTTP-facing half of the regression-jobs feature: validate, preview, create, list, get,
 * cancel, tail and stream. It owns Prisma and never touches a child process — that is the runner
 * service's job, and the split is what keeps a request from ever waiting on a batch.
 */
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { concat, from, interval, map, Observable, of, takeWhile, filter, merge } from 'rxjs';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  REGRESSION_CLEAN_SCOPE,
  REGRESSION_DATA_MODE,
  REGRESSION_JOB_STATUS,
  REGRESSION_JOB_SSE_EVENT,
  REGRESSION_SUITE_KIND,
  isRegressionJobActive,
  type PaginatedResponse,
  type RegressionJobDetailResponseDto,
  type RegressionJobLogLineDto,
  type RegressionJobLogTailResponseDto,
  type RegressionJobOptionsResponseDto,
  type RegressionJobStatus,
  type RegressionJobSummaryResponseDto,
  type RegressionPreviewResponseDto,
  type RegressionCleanScope,
  type RegressionDataMode,
  type RegressionSuiteKind,
} from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import {
  buildPreviewArgv,
  buildRegressionArgv,
  normalizeRegressionSpec,
  type NormalizeContext,
  type RawRegressionSpecInput,
  type RegressionJobSpec,
} from './regression-argv.util';
import { runnerWritesEnvName } from './regression-argv.util';
import { parseListOutput, type ParsedListOutput } from './regression-list.util';
import {
  jobLogRelativePath,
  readJobLogFromDisk,
  type RegressionJobLog,
} from './regression-job-log.store';
import { RegressionJobRunnerService } from './regression-job-runner.service';
import {
  checkRunnerAvailability,
  listRunnerEnvironments,
  resolveRunnerPaths,
  runnerSpawnArgs,
  type RunnerPaths,
} from './regression-runner-cli.util';
import type {
  CancelRegressionJobBody,
  CreateRegressionJobBody,
  ListRegressionJobsQuery,
  PreviewRegressionJobBody,
  RegressionJobLogQuery,
} from './dto/regression-job.dto';

/** A `--list` run is pure computation over a generated index; 60s is generous. */
const PREVIEW_TIMEOUT_MS = 60_000;
const PREVIEW_MAX_STDOUT = 2 * 1024 * 1024;
/** The full catalog changes only when the runner is rebuilt; re-shelling it per keystroke is waste. */
const CATALOG_TTL_MS = 5 * 60 * 1000;
/** Proxies drop idle connections; a comment-frame heartbeat keeps an SSE stream alive. */
const SSE_HEARTBEAT_MS = 20_000;

type JobRow = Awaited<ReturnType<PrismaService['regressionJob']['findUniqueOrThrow']>>;

@Injectable()
export class RegressionJobsService {
  private readonly logger = new Logger(RegressionJobsService.name);
  private catalog: { at: number; value: ParsedListOutput } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: RegressionJobRunnerService,
  ) {}

  // -------------------------------------------------------------------------
  // Runner introspection
  // -------------------------------------------------------------------------

  /**
   * Runs the runner's `--list` and parses it.
   *
   * Cheap and side-effect-free by construction: `--list` returns inside parseBatchArgs, before the
   * runner parses its environment config, resolves credentials or opens a session. It cannot touch
   * the tenant and it always exits 0.
   */
  private async runList(paths: RunnerPaths, argv: string[]): Promise<ParsedListOutput> {
    const availability = checkRunnerAvailability(paths);
    if (!availability.available) {
      throw new ValidationError(availability.reason ?? 'The regression runner is unavailable');
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, runnerSpawnArgs(paths, argv), {
        cwd: paths.root,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });

      let out = '';
      let err = '';
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Listing scenarios timed out after ${PREVIEW_TIMEOUT_MS}ms`));
      }, PREVIEW_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (c: string) => {
        if (out.length < PREVIEW_MAX_STDOUT) out += c;
      });
      child.stderr.on('data', (c: string) => {
        if (err.length < 8192) err += c;
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        if (!settled) reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        if (code !== 0) {
          // A non-zero --list means the selector itself was rejected (a bad --kind throws), so the
          // runner's own message is the most useful thing to surface.
          reject(new Error(err.trim() || out.trim() || `Listing scenarios failed (exit ${code})`));
          return;
        }
        resolve(out);
      });
    });

    return parseListOutput(stdout);
  }

  /** The unfiltered catalog, cached: it is also the allow-list for testcase-id validation. */
  private async getCatalog(paths: RunnerPaths): Promise<ParsedListOutput> {
    if (this.catalog && Date.now() - this.catalog.at < CATALOG_TTL_MS) {
      return this.catalog.value;
    }
    const value = await this.runList(paths, ['--list']);
    this.catalog = { at: Date.now(), value };
    return value;
  }

  /**
   * Drops the cached catalog. Called after a test-script sync moves the checkout: the TTL exists
   * because the catalog "changes only when the runner is rebuilt", and a sync is exactly that event.
   */
  invalidateCatalog(): void {
    this.catalog = null;
  }

  private async normalizeContext(paths: RunnerPaths): Promise<NormalizeContext> {
    const catalog = await this.getCatalog(paths);
    return {
      allowedEnvironments: listRunnerEnvironments(paths),
      knownTestCaseIds: new Set(catalog.items.map((i) => i.test_case_id.toUpperCase())),
    };
  }

  async getOptions(): Promise<RegressionJobOptionsResponseDto> {
    const paths = resolveRunnerPaths();
    const availability = checkRunnerAvailability(paths);
    if (!availability.available) {
      return {
        environments: [],
        module_tokens: [],
        scenarios: [],
        runner_available: false,
        runner_unavailable_reason: availability.reason ?? null,
      };
    }
    const catalog = await this.getCatalog(paths);
    return {
      environments: listRunnerEnvironments(paths),
      module_tokens: catalog.moduleTokens,
      scenarios: catalog.items,
      runner_available: true,
      runner_unavailable_reason: null,
    };
  }

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  async preview(body: PreviewRegressionJobBody): Promise<RegressionPreviewResponseDto> {
    const paths = resolveRunnerPaths();
    const ctx = await this.normalizeContext(paths);
    const spec = normalizeRegressionSpec(body as RawRegressionSpecInput, ctx);
    return this.previewSpec(paths, spec, body as RawRegressionSpecInput);
  }

  private async previewSpec(
    paths: RunnerPaths,
    spec: RegressionJobSpec,
    raw: RawRegressionSpecInput,
  ): Promise<RegressionPreviewResponseDto> {
    const parsed = await this.runList(paths, buildPreviewArgv(spec));
    const catalog = await this.getCatalog(paths);

    // Advisories, not errors: each names a real consequence the confirmation dialog should state
    // before the user commits, and none of them should block a deliberate choice.
    const warnings: string[] = [];
    if (spec.kind === REGRESSION_SUITE_KIND.UI) {
      warnings.push(
        'UI scenarios need Playwright Chromium in the runner checkout (npm run pw:install).',
      );
    }
    if (raw.write_mode === true) {
      warnings.push(
        `Destructive writes are enabled (${runnerWritesEnvName()}=1): this run creates and modifies real records in the shared QA tenant.`,
      );
    }
    if (spec.dataMode === REGRESSION_DATA_MODE.SEEDED) {
      warnings.push(
        'Seeded data mode creates prerequisite rows in the shared QA tenant and tears them down afterwards.',
      );
    }
    if (spec.cleanScope === REGRESSION_CLEAN_SCOPE.ALL) {
      warnings.push(
        'Clean scope "all" deletes every artifact directory under reports/, outputs/ and evidence/, plus the runner database - not just the scenarios selected here. MCP audit logs, batch summaries and session records are preserved, and a full sync to Postgres runs first.',
      );
    }
    const customNames = Object.keys(spec.customEnv);
    if (customNames.length > 0) {
      // Names only, never values. A custom parameter is free text and may hold a URL, a path or a
      // token someone pasted; the dialog's job is to make the operator aware the run is not on
      // default settings, which the names alone do.
      warnings.push(
        `${customNames.length} custom parameter(s) will be set in the runner's environment: ${customNames.join(', ')}.`,
      );
    }
    if (parsed.total === 0) {
      warnings.push('This selection matches no scenarios, so the job cannot be started.');
    }

    return {
      total: parsed.total,
      items: parsed.items,
      label: parsed.label,
      known_module_tokens:
        parsed.moduleTokens.length > 0 ? parsed.moduleTokens : catalog.moduleTokens,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async createJob(body: CreateRegressionJobBody): Promise<RegressionJobDetailResponseDto> {
    const paths = resolveRunnerPaths();
    const ctx = await this.normalizeContext(paths);
    const spec = normalizeRegressionSpec(body as RawRegressionSpecInput, ctx);

    // The confirmation is not a formality: clean-all reaches well beyond the selection below.
    if (spec.cleanScope === REGRESSION_CLEAN_SCOPE.ALL && body.confirm_clean_all !== true) {
      throw new ValidationError(
        'clean_scope "all" deletes the runner\'s entire artifact tree and database. Set confirm_clean_all to proceed.',
      );
    }

    // Preview before spawning. A selector that matches nothing would otherwise be discovered by
    // the runner twenty minutes into a job that could never have run.
    const preview = await this.previewSpec(paths, spec, body as RawRegressionSpecInput);
    if (preview.total === 0) {
      throw new ValidationError('This selection matches no scenarios.');
    }

    const built = buildRegressionArgv(spec);

    let created: JobRow;
    try {
      created = await this.prisma.regressionJob.create({
        data: {
          status: REGRESSION_JOB_STATUS.QUEUED,
          activeSlot: true,
          requestedBy: body.requested_by.trim(),
          label: built.label,
          kind: spec.kind ?? null,
          environment: spec.environment,
          cleanScope: spec.cleanScope ?? null,
          dataMode: spec.dataMode,
          writeMode: spec.writeMode,
          bail: spec.bail,
          cleanup: spec.cleanup ?? null,
          headed: spec.headed,
          uiSlowMoMs: spec.uiSlowMoMs ?? null,
          grep: spec.grep ?? null,
          modules: spec.modules,
          testCaseIds: spec.testCaseIds,
          argv: built.argv,
          envPatch: built.envPatch,
          runnerRoot: paths.root,
          logPath: 'pending',
          selectedCount: preview.total,
        },
      });
    } catch (err) {
      // P2002 on active_slot is the mutex doing its job. Surfacing the active job's id is what
      // lets the UI offer "Watch it" instead of a dead end.
      if ((err as { code?: string }).code === 'P2002') {
        const active = await this.prisma.regressionJob.findFirst({
          where: { activeSlot: true },
          select: { id: true, status: true },
        });
        throw new ConflictError('A regression run is already in progress.', {
          active_job_id: active?.id ?? null,
          active_job_status: active?.status ?? null,
        });
      }
      throw err;
    }

    // logPath is only knowable once the row has an id.
    const job = await this.prisma.regressionJob.update({
      where: { id: created.id },
      data: { logPath: jobLogRelativePath(created.id) },
    });

    // Fire and forget: the response must not wait on a batch. runJob never rejects.
    void this.runner.runJob(job.id).catch((err) => {
      this.logger.error(`Job ${job.id} failed outside its own error handling: ${String(err)}`);
    });

    return this.toDetail(job);
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listJobs(
    query: ListRegressionJobsQuery,
  ): Promise<PaginatedResponse<RegressionJobSummaryResponseDto>> {
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.regressionJob.findMany({
        where,
        orderBy: { queuedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.regressionJob.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toSummary(r)),
      total,
      page: query.page,
      limit: query.limit,
      has_more: query.page * query.limit < total,
    };
  }

  async getJob(id: number): Promise<RegressionJobDetailResponseDto> {
    return this.toDetail(await this.requireJob(id));
  }

  async getActiveJob(): Promise<RegressionJobDetailResponseDto | null> {
    const row = await this.prisma.regressionJob.findFirst({ where: { activeSlot: true } });
    return row ? this.toDetail(row) : null;
  }

  private async requireJob(id: number): Promise<JobRow> {
    const row = await this.prisma.regressionJob.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('RegressionJob', String(id));
    return row;
  }

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------

  async cancelJob(
    id: number,
    body: CancelRegressionJobBody,
  ): Promise<RegressionJobDetailResponseDto> {
    const job = await this.requireJob(id);
    if (!isRegressionJobActive(job.status as RegressionJobStatus)) {
      throw new ConflictError(`Job ${id} has already finished (${job.status}).`);
    }

    await this.prisma.regressionJob.update({
      where: { id },
      data: { cancelRequestedAt: new Date(), cancelRequestedBy: body.requested_by.trim() },
    });

    const signalled = this.runner.requestCancel(id);
    if (!signalled) {
      // The row says active but no child is attached: the process is gone and boot reconciliation
      // never ran (or the job is still in PREPARING). Release the slot rather than wedge the queue.
      this.logger.warn(`Cancel for job ${id}: no live child; marking CANCELLED.`);
      await this.prisma.regressionJob.update({
        where: { id },
        data: {
          status: REGRESSION_JOB_STATUS.CANCELLED,
          activeSlot: null,
          finishedAt: new Date(),
        },
      });
    }

    return this.toDetail(await this.requireJob(id));
  }

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  async getLogTail(
    id: number,
    query: RegressionJobLogQuery,
  ): Promise<RegressionJobLogTailResponseDto> {
    const job = await this.requireJob(id);
    const lines = readJobLogFromDisk(id, query.from_seq, query.limit);
    return {
      job_id: id,
      lines,
      next_seq: lines.length > 0 ? lines[lines.length - 1].seq : query.from_seq,
      total: job.logLineCount,
      status: job.status as RegressionJobStatus,
    };
  }

  /**
   * Replay from disk, then live lines, then a terminal `end` event.
   *
   * The replay/live seam is where a naive implementation loses or duplicates lines: a subscriber
   * attached after the file read would miss anything written in between. Subscribing to the live
   * subject first and filtering by sequence closes that window in the only direction that matters
   * — an overlapping line is dropped, a missing one is impossible.
   */
  async streamLog(id: number, fromSeq: number): Promise<Observable<MessageEvent>> {
    const job = await this.requireJob(id);
    const live: RegressionJobLog | null = this.runner.getActiveLog(id);

    // Every event must carry an id, and it must be the last log sequence the client has seen.
    //
    // Nest assigns an incrementing id to any event that lacks one, and EventSource reconnects on
    // its own whenever the stream closes — replaying from whatever id it saw last. An `end` or
    // `heartbeat` stamped with Nest's counter would therefore make the browser resume from
    // sequence 1 and replay the whole log, forever. Stamping the real high-water mark makes a
    // reconnect resume exactly where it stopped instead.
    let lastSeq = fromSeq;

    const toEvent = (line: RegressionJobLogLineDto): MessageEvent => {
      lastSeq = line.seq;
      return {
        id: String(line.seq),
        type: REGRESSION_JOB_SSE_EVENT.LOG,
        data: line,
      } as unknown as MessageEvent;
    };

    const controlEvent = (
      type: string,
      data: Record<string, unknown>,
    ): MessageEvent =>
      ({ id: String(lastSeq), type, data }) as unknown as MessageEvent;

    if (!live) {
      // Terminal (or not yet started): the file is the whole story, and the stream completes.
      const replay = readJobLogFromDisk(id, fromSeq, Number.MAX_SAFE_INTEGER);
      return concat(
        from(replay).pipe(map(toEvent)),
        of(null).pipe(
          map(() =>
            controlEvent(REGRESSION_JOB_SSE_EVENT.END, {
              job_id: id,
              status: job.status,
            }),
          ),
        ),
      );
    }

    const live$ = live.lines$;
    const replayed = readJobLogFromDisk(id, fromSeq, Number.MAX_SAFE_INTEGER);
    const lastReplayedSeq = replayed.length > 0 ? replayed[replayed.length - 1].seq : fromSeq;

    const heartbeat$ = interval(SSE_HEARTBEAT_MS).pipe(
      map(() =>
        controlEvent(REGRESSION_JOB_SSE_EVENT.HEARTBEAT, {
          ts: new Date().toISOString(),
        }),
      ),
    );

    const lines$ = concat(
      from(replayed).pipe(map(toEvent)),
      live$.pipe(
        filter((l) => l.seq > lastReplayedSeq),
        map(toEvent),
      ),
    );

    // The heartbeat must not keep the response open after the log completes, so it is stopped by
    // the same completion that ends the line stream.
    return merge(lines$, heartbeat$.pipe(takeWhile(() => this.runner.activeJobId === id)));
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------

  private toSummary(row: JobRow): RegressionJobSummaryResponseDto {
    return {
      id: row.id,
      status: row.status as RegressionJobStatus,
      requested_by: row.requestedBy,
      label: row.label,
      environment: row.environment,
      kind: (row.kind as RegressionSuiteKind | null) ?? null,
      modules: (row.modules as string[] | null) ?? [],
      test_case_ids: (row.testCaseIds as string[] | null) ?? [],
      grep: row.grep,
      clean_scope: (row.cleanScope as RegressionCleanScope | null) ?? null,
      data_mode: row.dataMode as RegressionDataMode,
      write_mode: row.writeMode,
      selected_count: row.selectedCount,
      pass_count: row.passCount,
      blocked_count: row.blockedCount,
      fail_count: row.failCount,
      sync_status: row.syncStatus as RegressionJobSummaryResponseDto['sync_status'],
      queued_at: row.queuedAt.toISOString(),
      started_at: row.startedAt?.toISOString() ?? null,
      finished_at: row.finishedAt?.toISOString() ?? null,
      duration_ms: row.durationMs,
    };
  }

  private toDetail(row: JobRow): RegressionJobDetailResponseDto {
    return {
      ...this.toSummary(row),
      bail: row.bail,
      cleanup: row.cleanup,
      headed: row.headed,
      ui_slowmo_ms: row.uiSlowMoMs,
      argv: (row.argv as string[] | null) ?? [],
      env_patch: (row.envPatch as Record<string, string> | null) ?? {},
      pid: row.pid,
      exit_code: row.exitCode,
      signal: row.signal,
      cancel_requested_at: row.cancelRequestedAt?.toISOString() ?? null,
      cancel_requested_by: row.cancelRequestedBy,
      last_seq: row.logLineCount,
      summary_path: row.summaryPath,
      error_summary: row.errorSummary,
      synced_run_count: row.syncedRunCount,
    };
  }
}
