import type { Logger } from '../logger.js';
import { newRunId, type ReportableResult } from '../report/result.js';
import type { PersistRunMeta } from '../store/persist-run.js';

/** PASS | BLOCKED | FAIL — the coarse verdict a terminal run and a batch summary report. */
export type TerminalVerdict = 'PASS' | 'BLOCKED' | 'FAIL';

export function terminalVerdict(result: Pick<ReportableResult, 'passed' | 'blocked'>): TerminalVerdict {
  if (result.passed) return 'PASS';
  return result.blocked ? 'BLOCKED' : 'FAIL';
}

export interface RunLifecycleOptions<R extends ReportableResult> {
  scenario: string;
  dryRun: boolean;
  environment: string;
  /** Pre-minted run id; minted here when omitted. */
  runId?: string;
  logger: Pick<Logger, 'error'>;
  /** Builds the context and runs the scenario. The run id exists before this starts, so evidence can be keyed by it. */
  execute(runId: string): Promise<R>;
  /** Always runs, even when `execute` threw — e.g. closing a browser. Receives the result when there is one. */
  teardown?(result: R | undefined): Promise<void>;
}

export interface RunLifecycleOutcome<R extends ReportableResult> {
  result: R;
  runId: string;
  durationMs: number;
  /** Ready for `writeRunToStore`. */
  meta: PersistRunMeta;
}

/**
 * One scenario run, start to finish: mint the run id, execute, turn a thrown error into a result
 * (no steps, no checks — which the store records as ERROR), always tear down, and time it. Report
 * writing is left to the caller, which has the trace.
 */
export async function runLifecycle<R extends ReportableResult>(options: RunLifecycleOptions<R>): Promise<RunLifecycleOutcome<R>> {
  // The failure shape carries only the base fields; project-specific result fields stay unset.
  const failure = (error: string): R =>
    ({ scenario: options.scenario, dryRun: options.dryRun, passed: false, steps: [], error }) as ReportableResult as R;

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const runId = options.runId ?? newRunId();

  let result: R | undefined;
  try {
    result = await options.execute(runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.logger.error(`Scenario failed before completing: ${message}`);
    result = failure(message);
  } finally {
    // Teardown runs even when the scenario threw, so a crash still leaves its evidence behind and
    // never leaves a browser process alive.
    await options.teardown?.(result);
  }

  // Defensive: the try/catch above assigns on every path, so this only guards a future edit.
  result ??= failure('Scenario produced no result.');

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAtMs;
  return {
    result,
    runId,
    durationMs,
    meta: {
      environment: options.environment,
      startedAt,
      finishedAt,
      durationMs,
      executedBy: process.env.USER ?? process.env.USERNAME ?? undefined,
    },
  };
}
