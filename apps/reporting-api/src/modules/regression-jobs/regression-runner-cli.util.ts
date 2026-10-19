/**
 * The only file that knows the runner's filesystem layout.
 *
 * Everything else in this module works with an argv array and a cwd; this resolves where the
 * runner is, how to invoke it, and which environments it offers — so a change to the runner's
 * layout lands here and nowhere else.
 *
 * Every location is configurable from the API's .env and relative to REGRESSION_RUNNER_PATH. The
 * defaults describe a tsx-based runner checkout (`src/entrypoints/run-suite.ts`,
 * `configs/environments/<env>.json`); a qakit project points them at its own layout instead:
 *
 *   REGRESSION_RUNNER_SCRIPT=node_modules/@qakit/runner/dist/bin.js
 *   REGRESSION_RUNNER_TSX=none
 *   REGRESSION_RUNNER_ARGS=--config qakit.config.yaml
 *   REGRESSION_RUNNER_ENVIRONMENTS=local
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveArtifactStorageRoot } from '../runs/artifact-storage.util';

/** Placeholder for the environment name in REGRESSION_RUNNER_ENVIRONMENT_FILE. */
export const RUNNER_ENVIRONMENT_PLACEHOLDER = '{env}';

export const RUNNER_PATH_DEFAULTS = {
  script: 'src/entrypoints/run-suite.ts',
  tsxCli: 'node_modules/tsx/dist/cli.mjs',
  environmentsDir: 'configs/environments',
  environmentFile: `${RUNNER_ENVIRONMENT_PLACEHOLDER}.json`,
  sessionsDir: '.sessions',
} as const;

export interface RunnerPaths {
  root: string;
  /**
   * The tsx CLI inside the runner's own node_modules, or undefined when the script runs on plain
   * node (a compiled entry point such as `@qakit/runner/dist/bin.js`).
   *
   * Invoked as `node <tsxCli> <script>` — exactly what the runner's tools/run-ui-write.mjs
   * already does on this machine. Not `npx` (a cold cache turns that into a network call) and
   * not the `.cmd` shim (resolving one on Windows would force `shell: true`, and a shell is the
   * one thing an argv-array spawn exists to avoid).
   */
  tsxCli?: string;
  runSuite: string;
  /** Leading args for every invocation, ahead of the per-job argv (e.g. `--config <yaml>`). */
  baseArgs: string[];
  environmentsDir: string;
  /** File name inside environmentsDir, with RUNNER_ENVIRONMENT_PLACEHOLDER for the name. */
  environmentFile: string;
  /**
   * A fixed environment list. When set the directory is not scanned and an environment needs no
   * file of its own — a qakit environment overlay is optional.
   */
  environments?: string[];
  sessionsDir: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function splitList(value: string | undefined, separator: RegExp): string[] {
  return (value ?? '').split(separator).map((s) => s.trim()).filter(Boolean);
}

export function resolveRunnerPaths(): RunnerPaths {
  const env = process.env;
  const root = resolveArtifactStorageRoot();
  const fromRoot = (value: string | undefined, fallback: string): string =>
    path.resolve(root, nonEmpty(value) ?? fallback);

  const tsx = nonEmpty(env.REGRESSION_RUNNER_TSX);
  const environments = splitList(env.REGRESSION_RUNNER_ENVIRONMENTS, /,/);

  return {
    root,
    tsxCli: tsx?.toLowerCase() === 'none' ? undefined : fromRoot(tsx, RUNNER_PATH_DEFAULTS.tsxCli),
    runSuite: fromRoot(env.REGRESSION_RUNNER_SCRIPT, RUNNER_PATH_DEFAULTS.script),
    // Whitespace-separated, no quoting: paths with spaces belong in the runner's own config.
    baseArgs: splitList(env.REGRESSION_RUNNER_ARGS, /\s+/),
    environmentsDir: fromRoot(env.REGRESSION_RUNNER_ENVIRONMENTS_DIR, RUNNER_PATH_DEFAULTS.environmentsDir),
    environmentFile: nonEmpty(env.REGRESSION_RUNNER_ENVIRONMENT_FILE) ?? RUNNER_PATH_DEFAULTS.environmentFile,
    environments: environments.length > 0 ? environments : undefined,
    sessionsDir: fromRoot(env.REGRESSION_RUNNER_SESSIONS_DIR, RUNNER_PATH_DEFAULTS.sessionsDir),
  };
}

/** The args after `node` for one runner invocation: loader, script, base args, then the job's argv. */
export function runnerSpawnArgs(paths: RunnerPaths, argv: readonly string[]): string[] {
  return [...(paths.tsxCli ? [paths.tsxCli] : []), paths.runSuite, ...paths.baseArgs, ...argv];
}

export interface RunnerAvailability {
  available: boolean;
  reason?: string;
}

/**
 * Checked before a job is accepted, and surfaced on GET /options so the form can disable submit
 * rather than let a user configure a batch that will die at spawn.
 */
export function checkRunnerAvailability(paths: RunnerPaths): RunnerAvailability {
  if (!fs.existsSync(paths.root)) {
    return {
      available: false,
      reason: `Runner checkout not found at ${paths.root}. Set REGRESSION_RUNNER_PATH in apps/api/.env.`,
    };
  }
  if (!fs.existsSync(paths.runSuite)) {
    return {
      available: false,
      reason: `Runner script not found at ${paths.runSuite}. Set REGRESSION_RUNNER_SCRIPT in apps/api/.env.`,
    };
  }
  if (paths.tsxCli && !fs.existsSync(paths.tsxCli)) {
    return {
      available: false,
      reason:
        `tsx not found at ${paths.tsxCli}. Run "npm install" in the runner checkout, or set ` +
        `REGRESSION_RUNNER_TSX (a path, or "none" for a compiled script).`,
    };
  }
  return { available: true };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Environment names, from the config files themselves so adding one needs no code change here. */
export function listRunnerEnvironments(paths: RunnerPaths): string[] {
  if (paths.environments) return [...paths.environments];

  const [prefix, suffix = ''] = paths.environmentFile.split(RUNNER_ENVIRONMENT_PLACEHOLDER, 2);
  const pattern = new RegExp(`^${escapeRegExp(prefix)}([A-Za-z0-9_-]+)${escapeRegExp(suffix)}$`);
  try {
    return fs
      .readdirSync(paths.environmentsDir)
      .map((f) => pattern.exec(f)?.[1])
      .filter((name): name is string => Boolean(name))
      .sort();
  } catch {
    // A missing directory is a runner-availability problem, reported by checkRunnerAvailability
    // with a better message than an empty list would give.
    return [];
  }
}

export function environmentConfigPath(paths: RunnerPaths, environment: string): string {
  return path.join(
    paths.environmentsDir,
    paths.environmentFile.split(RUNNER_ENVIRONMENT_PLACEHOLDER).join(environment),
  );
}

/** Whether a job's environment must have a file of its own before the runner is spawned. */
export function environmentFileRequired(paths: RunnerPaths): boolean {
  return !paths.environments;
}

/**
 * Whether a UI batch can run against this environment.
 *
 * `run-scenario.ts` throws when a UI scenario meets an environment with no `web` block, and it
 * does so per scenario — so a 148-scenario UI batch would fail 148 times over a config problem
 * that is knowable up front.
 *
 * Only a JSON environment file can be checked here. Anything else (a qakit YAML overlay, or a fixed
 * environment with no file) is left to the runner, which reports the problem itself.
 */
export function environmentSupportsUi(paths: RunnerPaths, environment: string): boolean {
  const file = environmentConfigPath(paths, environment);
  if (path.extname(file).toLowerCase() !== '.json') return true;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { web?: unknown };
    return Boolean(parsed.web);
  } catch (err) {
    return !environmentFileRequired(paths) && (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

/**
 * Session lock files held by a live process.
 *
 * Only `--data-mode seeded` takes these, and the runner refuses to re-attach a ledger whose owner
 * is still alive. Checking here turns that into a clear pre-flight message instead of a crash
 * twenty seconds into a batch. A stale lock (dead pid) is reported as free, matching the runner's
 * own reclaim behaviour.
 */
export function findLiveSessionLocks(paths: RunnerPaths): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(paths.sessionsDir).filter((f) => f.endsWith('.lock'));
  } catch {
    return [];
  }

  const live: string[] = [];
  for (const name of names) {
    try {
      const pid = Number(fs.readFileSync(path.join(paths.sessionsDir, name), 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 0) continue;
      // Signal 0 tests for existence without delivering anything.
      process.kill(pid, 0);
      live.push(name.replace(/\.lock$/, ''));
    } catch {
      // ESRCH (dead owner) or an unreadable file: not a live lock.
    }
  }
  return live;
}

/** Where a job's cancel flag lives. The runner checks for this file at the top of its loop. */
export function cancelFilePath(paths: RunnerPaths, jobId: number): string {
  return path.join(paths.sessionsDir, `job-${jobId}.cancel`);
}
