/**
 * Turns a validated request into the argv array and environment patch for one runner batch.
 *
 * This is the security boundary of the feature, and the threat is not what it first looks like.
 * The child is spawned with an argv array and `shell: false`, so there is no shell to inject
 * into. The real hazard is a value that *looks like a flag*: the runner's `parseArgs` only warns
 * on an unknown argument and carries on, so a module token of `--all` would be silently swallowed
 * and a batch scoped to one testcase would become 1140 scenarios against shared UAT. Hence
 * `assertNoFlagLikeValues` at the end, which no value may bypass.
 *
 * No fs and no I/O: the allow-lists it validates against are read from disk by the caller and
 * passed in, which is what keeps this file unit-testable. The only exception is the pair of
 * variables the *deployment* names rather than this code - the runner's write switch and its
 * cancel-file key - which `runnerWritesEnvName` and `reservedCustomEnvNames` read from
 * `process.env` because a constant frozen at import time would miss a redeployment that renamed
 * either one.
 */
import {
  MAX_REGRESSION_CUSTOM_ENV_ENTRIES,
  MAX_REGRESSION_CUSTOM_ENV_VALUE_LENGTH,
  MAX_REGRESSION_MODULES,
  MAX_REGRESSION_TEST_CASE_IDS,
  MAX_REGRESSION_UI_SLOWMO_MS,
  REGRESSION_CHILD_ENV_DENY_LIST,
  REGRESSION_CLEAN_SCOPE,
  REGRESSION_CUSTOM_ENV_NAME_PATTERN,
  REGRESSION_CUSTOM_ENV_RESERVED,
  REGRESSION_CUSTOM_ENV_VALUE_PATTERN,
  REGRESSION_DATA_MODE,
  REGRESSION_ENV_NAME_PATTERN,
  REGRESSION_GREP_PATTERN,
  REGRESSION_MODULE_TOKEN_PATTERN,
  REGRESSION_SUITE_KIND,
  REGRESSION_TEST_CASE_ID_PATTERN,
  ValidationError,
  type RegressionCleanScope,
  type RegressionDataMode,
  type RegressionSuiteKind,
} from '@qakit/reporting-shared';

/** A request that has been normalised and is safe to turn into argv. */
export interface RegressionJobSpec {
  kind?: RegressionSuiteKind;
  modules: string[];
  testCaseIds: string[];
  grep?: string;
  environment: string;
  cleanScope?: RegressionCleanScope;
  dataMode: RegressionDataMode;
  writeMode: boolean;
  bail: boolean;
  /** Tri-state: undefined says nothing and lets the runner's own default apply. */
  cleanup?: boolean;
  headed: boolean;
  uiSlowMoMs?: number;
  /** Validated custom parameters, merged into the child's environment. Never reserved names. */
  customEnv: Record<string, string>;
}

/** The unvalidated shape as it arrives off the wire. */
export interface RawRegressionSpecInput {
  kind?: string | null;
  modules?: string[] | null;
  test_case_ids?: string[] | null;
  grep?: string | null;
  environment?: string | null;
  clean_scope?: string | null;
  data_mode?: string | null;
  write_mode?: boolean | null;
  bail?: boolean | null;
  cleanup?: boolean | null;
  headed?: boolean | null;
  ui_slowmo_ms?: number | null;
  custom_env?: Record<string, string> | null;
}

export interface NormalizeContext {
  /** `configs/environments/*.json` basenames, read from the runner by the caller. */
  allowedEnvironments: readonly string[];
  /** Every testcase id the runner knows, from the cached `--list` catalog. */
  knownTestCaseIds: ReadonlySet<string>;
}

export interface BuiltRegressionCommand {
  /** Args to run-suite.ts. Excludes node, the tsx cli path and the script path. */
  argv: string[];
  /** Merged over the inherited environment (minus the deny-list) at spawn time. */
  envPatch: Record<string, string>;
  /** What `parseBatchArgs` will compute for this argv, so the summary file stays findable. */
  label: string;
}

function uniqueTrimmed(values: readonly string[], transform: (v: string) => string): string[] {
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const value = transform(raw.trim());
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

export function normalizeRegressionSpec(
  raw: RawRegressionSpecInput,
  ctx: NormalizeContext,
): RegressionJobSpec {
  // kind: the runner *throws* on an unrecognised --kind, so a bad value must never reach it.
  let kind: RegressionSuiteKind | undefined;
  if (raw.kind !== undefined && raw.kind !== null && raw.kind !== '') {
    if (raw.kind !== REGRESSION_SUITE_KIND.API && raw.kind !== REGRESSION_SUITE_KIND.UI) {
      throw new ValidationError(`kind must be "api" or "ui", got "${raw.kind}"`);
    }
    kind = raw.kind;
  }

  // modules: an OPEN vocabulary. Tokens are matched, not enumerated, in the runner (suite module,
  // docs domain, or alias), and new ones appear whenever a suite folder is added. So the shape is
  // enforced and the value is not — an unknown-but-well-formed token selects nothing, which is
  // the same call ListRunsQueryDto makes for `module`.
  const modules = uniqueTrimmed(raw.modules ?? [], (v) => v.toLowerCase());
  if (modules.length > MAX_REGRESSION_MODULES) {
    throw new ValidationError(`at most ${MAX_REGRESSION_MODULES} modules may be selected`);
  }
  for (const token of modules) {
    if (!REGRESSION_MODULE_TOKEN_PATTERN.test(token)) {
      throw new ValidationError(`invalid module token: "${token}"`);
    }
  }

  // test_case_ids: a CLOSED vocabulary, checked against the runner's live catalog. Ids are not
  // uniformly shaped (TC-DH-L01, TC-BOQG-A04b, SPIKE-R01), so the pattern only guards the
  // character set and the catalog decides what actually exists.
  const testCaseIds = uniqueTrimmed(raw.test_case_ids ?? [], (v) => v.toUpperCase());
  if (testCaseIds.length > MAX_REGRESSION_TEST_CASE_IDS) {
    throw new ValidationError(
      `at most ${MAX_REGRESSION_TEST_CASE_IDS} test case ids may be selected`,
    );
  }
  for (const id of testCaseIds) {
    if (!REGRESSION_TEST_CASE_ID_PATTERN.test(id)) {
      throw new ValidationError(`invalid test case id: "${id}"`);
    }
  }
  const unknownIds = testCaseIds.filter((id) => !ctx.knownTestCaseIds.has(id));
  if (unknownIds.length > 0) {
    throw new ValidationError(
      `unknown test case id(s): ${unknownIds.join(', ')}`,
      { unknown_test_case_ids: unknownIds },
    );
  }

  const grep = raw.grep?.trim() || undefined;
  if (grep !== undefined && !REGRESSION_GREP_PATTERN.test(grep)) {
    throw new ValidationError(
      'grep must be 1-120 characters with no spaces or line breaks',
    );
  }

  // 'qa' stays the default where the runner offers it; a runner without one (a qakit project's
  // `local`) defaults to its first environment instead of failing a request that named none.
  const fallbackEnvironment = ctx.allowedEnvironments.includes('qa')
    ? 'qa'
    : (ctx.allowedEnvironments[0] ?? 'qa');
  const environment = (raw.environment?.trim() || fallbackEnvironment).toLowerCase();
  if (!REGRESSION_ENV_NAME_PATTERN.test(environment)) {
    throw new ValidationError(`invalid environment name: "${environment}"`);
  }
  if (!ctx.allowedEnvironments.includes(environment)) {
    throw new ValidationError(
      `unknown environment "${environment}". Available: ${ctx.allowedEnvironments.join(', ')}`,
    );
  }

  let cleanScope: RegressionCleanScope | undefined;
  if (raw.clean_scope !== undefined && raw.clean_scope !== null && raw.clean_scope !== '') {
    if (
      raw.clean_scope !== REGRESSION_CLEAN_SCOPE.RUN &&
      raw.clean_scope !== REGRESSION_CLEAN_SCOPE.ALL
    ) {
      throw new ValidationError(`clean_scope must be "run" or "all", got "${raw.clean_scope}"`);
    }
    cleanScope = raw.clean_scope;
  }

  const dataMode = (raw.data_mode ?? REGRESSION_DATA_MODE.EXISTING) as RegressionDataMode;
  if (
    dataMode !== REGRESSION_DATA_MODE.EXISTING &&
    dataMode !== REGRESSION_DATA_MODE.SEEDED
  ) {
    throw new ValidationError(`data_mode must be "existing" or "seeded", got "${dataMode}"`);
  }

  let uiSlowMoMs: number | undefined;
  if (raw.ui_slowmo_ms !== undefined && raw.ui_slowmo_ms !== null) {
    if (!Number.isInteger(raw.ui_slowmo_ms) || raw.ui_slowmo_ms < 0) {
      throw new ValidationError('ui_slowmo_ms must be a non-negative integer');
    }
    if (raw.ui_slowmo_ms > MAX_REGRESSION_UI_SLOWMO_MS) {
      throw new ValidationError(`ui_slowmo_ms must be at most ${MAX_REGRESSION_UI_SLOWMO_MS}`);
    }
    uiSlowMoMs = raw.ui_slowmo_ms;
  }

  return {
    kind,
    modules,
    testCaseIds,
    grep,
    environment,
    cleanScope,
    dataMode,
    writeMode: raw.write_mode === true,
    bail: raw.bail === true,
    // Left undefined when absent: see the tri-state note on RegressionJobFlagsDto.
    cleanup: raw.cleanup === undefined || raw.cleanup === null ? undefined : raw.cleanup,
    headed: raw.headed === true,
    uiSlowMoMs,
    customEnv: normalizeCustomEnv(raw.custom_env),
  };
}

/**
 * Names no custom parameter may take.
 *
 * Read at call time rather than frozen into a constant because two of them are named by the
 * deployment: the runner's write switch and its cancel-file variable both come from the API's own
 * environment, and a list compiled at import time would miss a redeployment that renamed either.
 */
export function reservedCustomEnvNames(): Set<string> {
  return new Set<string>([
    ...REGRESSION_CUSTOM_ENV_RESERVED,
    ...REGRESSION_CHILD_ENV_DENY_LIST,
    runnerWritesEnvName(),
    process.env.RUNNER_CANCEL_FILE_ENV || 'QAKIT_CANCEL_FILE',
  ]);
}

/**
 * Validates the custom parameters and returns them as a plain patch.
 *
 * Every refusal here has a failure mode behind it, and they are not the same failure mode:
 *
 * - A **reserved** name would let a text box on a web form decide which binary runs, or turn the
 *   runner's write switch on while the "Allow destructive writes" checkbox — and the preview
 *   warning built from it — still said off. The job record would then describe a run that did not
 *   happen.
 * - A **malformed** name or value would reach `spawn` as a broken environment entry. A newline in
 *   particular splits one value into two in every tool that prints an environment, including the
 *   job detail page.
 *
 * An empty-string value is kept, not dropped: on Windows libuv discards empty environment
 * variables, so `FOO=` is the caller asking for something the platform cannot express, and
 * silently turning it into "unset" would be a different instruction than the one given.
 */
export function normalizeCustomEnv(raw: Record<string, string> | null | undefined): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('custom_env must be an object of NAME: value pairs');
  }

  const entries = Object.entries(raw);
  if (entries.length > MAX_REGRESSION_CUSTOM_ENV_ENTRIES) {
    throw new ValidationError(
      `at most ${MAX_REGRESSION_CUSTOM_ENV_ENTRIES} custom parameters may be set, got ${entries.length}`,
    );
  }

  const reserved = reservedCustomEnvNames();
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim();
    if (name === '') continue;
    if (!REGRESSION_CUSTOM_ENV_NAME_PATTERN.test(name)) {
      throw new ValidationError(
        `invalid custom parameter name "${name}" - use UPPER_SNAKE_CASE, at most 64 characters`,
      );
    }
    if (reserved.has(name)) {
      throw new ValidationError(
        `custom parameter "${name}" is reserved and cannot be set from a run request`,
      );
    }
    if (typeof rawValue !== 'string') {
      throw new ValidationError(`custom parameter "${name}" must be a string value`);
    }
    if (rawValue.length > MAX_REGRESSION_CUSTOM_ENV_VALUE_LENGTH) {
      throw new ValidationError(
        `custom parameter "${name}" is longer than ${MAX_REGRESSION_CUSTOM_ENV_VALUE_LENGTH} characters`,
      );
    }
    if (!REGRESSION_CUSTOM_ENV_VALUE_PATTERN.test(rawValue)) {
      throw new ValidationError(
        `custom parameter "${name}" must not contain a line break or a NUL character`,
      );
    }
    out[name] = rawValue;
  }
  return out;
}

/**
 * Mirrors the label `parseBatchArgs` computes for the same flags. The runner names its summary
 * file `reports/_batches/<iso>-<label>.md`, so if these two ever disagree the API loses the
 * ability to find the artifact it just produced. A spec asserts they agree.
 */
export function buildLabel(spec: RegressionJobSpec): string {
  return (
    [spec.kind, ...spec.modules, ...spec.testCaseIds, spec.grep]
      .filter(Boolean)
      .join('-') || 'all'
  );
}

/**
 * Last line of defence. Every argv element that is not a flag we deliberately emitted must not
 * begin with `-`, because the runner would take it for a flag and ignore it with only a warning.
 */
function assertNoFlagLikeValues(argv: readonly string[]): void {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const isOwnFlag = token.startsWith('--') && EMITTED_FLAGS.has(token);
    if (isOwnFlag) continue;
    if (token.startsWith('-')) {
      throw new ValidationError(`refusing to pass a flag-like value to the runner: "${token}"`);
    }
  }
}

/** Every flag this builder is allowed to emit. Nothing else may reach the runner. */
const EMITTED_FLAGS = new Set([
  '--kind',
  '--module',
  '--testcase',
  '--grep',
  '--env',
  '--clean',
  '--data-mode',
  '--bail',
  '--cleanup',
  '--no-cleanup',
  '--headed',
  '--ui-slowmo',
  '--list',
]);

/**
 * Selection flags only, plus `--list`.
 *
 * Deliberately no `--env`, `--clean` or `--data-mode`: `--list` returns inside `parseBatchArgs`
 * before `parseArgs`, `loadEnvironmentConfig` or `openSession` ever run, so a preview needs no
 * credentials, reads no environment config, takes no session lock and changes nothing.
 */
export function buildPreviewArgv(spec: RegressionJobSpec): string[] {
  const argv: string[] = [];
  if (spec.kind) argv.push('--kind', spec.kind);
  for (const m of spec.modules) argv.push('--module', m);
  for (const id of spec.testCaseIds) argv.push('--testcase', id);
  if (spec.grep) argv.push('--grep', spec.grep);
  argv.push('--list');
  assertNoFlagLikeValues(argv);
  return argv;
}

export function buildRegressionArgv(spec: RegressionJobSpec): BuiltRegressionCommand {
  const argv: string[] = [];

  if (spec.kind) argv.push('--kind', spec.kind);
  // Repeated flags rather than one comma-joined value: both forms work, but a repeated flag keeps
  // each value in its own argv element, which is what makes the flag-like check above meaningful.
  for (const m of spec.modules) argv.push('--module', m);
  for (const id of spec.testCaseIds) argv.push('--testcase', id);
  if (spec.grep) argv.push('--grep', spec.grep);

  // Always explicit, never left to the runner's default, so the audit record says which
  // environment ran even if that default changes later.
  argv.push('--env', spec.environment);

  // `--clean-all` is NEVER emitted. Scope 'all' is performed by the API itself (see
  // runner-workspace.util.ts) because the runner's version ignores the selection, deletes
  // non-regenerable audit logs, and removes the artifact trees before it discovers the database
  // is locked. Scope 'run' IS delegated, because scoped cleaning also purges the runner's SQLite
  // rows through a schema this package deliberately does not know.
  if (spec.cleanScope === REGRESSION_CLEAN_SCOPE.RUN) argv.push('--clean');

  argv.push('--data-mode', spec.dataMode);
  if (spec.bail) argv.push('--bail');
  if (spec.cleanup === true) argv.push('--cleanup');
  if (spec.cleanup === false) argv.push('--no-cleanup');
  if (spec.headed) argv.push('--headed');
  if (spec.uiSlowMoMs !== undefined) argv.push('--ui-slowmo', String(spec.uiSlowMoMs));

  assertNoFlagLikeValues(argv);

  return { argv, envPatch: buildEnvPatch(spec), label: buildLabel(spec) };
}

/** The runner's write switch; each runner names its own (`RUNNER_WRITES_ENV`, default `QAKIT_ALLOW_WRITES`). */
export function runnerWritesEnvName(): string {
  return process.env.RUNNER_WRITES_ENV || 'QAKIT_ALLOW_WRITES';
}

/**
 * The deliberate environment delta for the child. Never the inherited environment — that is
 * merged at spawn time, minus the deny-list.
 */
export function buildEnvPatch(spec: RegressionJobSpec): Record<string, string> {
  return {
    // Custom parameters go FIRST, so everything below overwrites them. The name validation
    // already refuses these keys, and this ordering means a gap in that list still cannot let a
    // request quietly flip the write switch - two independent defences for the one value whose
    // corruption would make the job record describe a run that did not happen.
    ...spec.customEnv,
    // Always set, in both directions, never omitted. A runner's checked-in .env may have
    // its write switch on, and its loader only assigns keys that are still undefined, so
    // an absent patch means write mode. '0' rather than '': libuv drops empty environment
    // variables on Windows, which would put us straight back on the .env value.
    [runnerWritesEnvName()]: spec.writeMode ? '1' : '0',
    // The log is stored and replayed as text; ANSI escapes would survive into the browser.
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}
