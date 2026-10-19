import fs from 'node:fs';
import path from 'node:path';
import {
  batchSummaryFileName,
  cleanArtifactTrees,
  countVerdicts,
  createLogger,
  groupSegments,
  knownModuleTokens,
  loadProjectAdapter,
  loadProjectConfigWithEnv,
  openRunStore,
  parseBatchArgs,
  purgeRunsInStore,
  renderBatchSummary,
  selectScenarios,
  sortScenarioIndex,
  type ArtifactGroup,
  type BatchSummaryRow,
  type LoadedProjectConfig,
  type Logger,
  type ProjectAdapter,
  type ScenarioIndexEntry,
  type TerminalVerdict,
} from '@qakit/core';
import { discoverScenarios, type DiscoveredScenario } from './discover.js';
import { runScenario, type ScenarioVerdict } from './run.js';
import type { Scenario, ScenarioKind } from './scenario.js';

export interface SuiteCliArgs {
  configPath?: string;
  environment?: string;
  kind?: ScenarioKind;
  /** Module tokens: a scenario's `module`, or the domain its artifacts are grouped under. */
  modules: string[];
  testCaseIds: string[];
  grep?: string;
  /** Derived from the selection, as `parseBatchArgs` does; names the batch summary file. */
  label: string;
  list: boolean;
  bail: boolean;
  /** `--clean`: remove the selected scenarios' artifacts and stored runs before the batch. */
  clean: boolean;
  /** Accepted for runner compatibility; the only data mode a qakit scenario has. */
  dataMode: 'existing';
  /** Accepted for runner compatibility and otherwise unused: qakit scenarios clean up after themselves. */
  cleanup?: boolean;
  headed: boolean;
  uiSlowMoMs?: number;
  files: string[];
}

const USAGE =
  'Usage: qakit-suite --config <qakit.config.yaml> [--env <name>] [--kind api|ui] [--module <token>] [--testcase <id,id>] ' +
  '[--grep <text>] [--list] [--bail] [--clean] [--headed] [--ui-slowmo <ms>] [--data-mode existing] [--cleanup|--no-cleanup] [files...]';

/** Flags that take a value, so `--flag=value` can be split before the batch parser sees it. */
const VALUE_FLAGS = new Set(['--config', '--env', '--kind', '--module', '--testcase', '--grep', '--data-mode', '--ui-slowmo']);

function splitInlineValues(argv: readonly string[]): string[] {
  return argv.flatMap((arg) => {
    const eq = arg.indexOf('=');
    return eq > 0 && VALUE_FLAGS.has(arg.slice(0, eq)) ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg];
  });
}

export function parseSuiteArgs(argv: readonly string[]): SuiteCliArgs {
  const tokens = splitInlineValues(argv);
  for (const [i, token] of tokens.entries()) {
    if (VALUE_FLAGS.has(token) && (tokens[i + 1] === undefined || tokens[i + 1]!.startsWith('--'))) {
      throw new Error(`${token} needs a value. ${USAGE}`);
    }
  }

  // Selection flags (--kind, --module, --testcase, --grep, --list, --bail, --all) are the kit's shared
  // batch contract, the same one the reporting API builds its argv and batch label from.
  const batch = parseBatchArgs(tokens);
  const args: SuiteCliArgs = {
    kind: batch.selector.kind,
    modules: batch.selector.modules ?? [],
    testCaseIds: batch.selector.testCaseIds ?? [],
    grep: batch.selector.grep,
    label: batch.label,
    list: batch.list,
    bail: batch.bail,
    clean: false,
    dataMode: 'existing',
    headed: false,
    files: [],
  };

  const rest = batch.rest;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    const value = (): string => rest[++i]!;
    switch (arg) {
      case '--config':
        args.configPath = value();
        break;
      case '--env':
        args.environment = value();
        break;
      case '--clean':
        args.clean = true;
        break;
      case '--data-mode': {
        const mode = value();
        if (mode === 'seeded') throw new Error('--data-mode seeded is not supported: qakit scenarios run against existing data.');
        if (mode !== 'existing') throw new Error(`--data-mode must be existing, got "${mode}". ${USAGE}`);
        break;
      }
      case '--cleanup':
        args.cleanup = true;
        break;
      case '--no-cleanup':
        args.cleanup = false;
        break;
      case '--headed':
        args.headed = true;
        break;
      case '--ui-slowmo': {
        const raw = value();
        const ms = Number(raw);
        if (!Number.isInteger(ms) || ms < 0) throw new Error(`--ui-slowmo must be a non-negative integer, got "${raw}".`);
        args.uiSlowMoMs = ms;
        break;
      }
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown argument "${arg}". ${USAGE}`);
        args.files.push(arg);
    }
  }
  return args;
}

const pad = (text: string, width: number): string => (text.length >= width ? text : text + ' '.repeat(width - text.length));

/** ERROR (the harness broke before recording anything) counts as FAIL in a batch, as it does in the store. */
/**
 * A scenario's env: its own `layer` over the live `process.env`. Reads see the current process value (so a credential
 * refreshed during the run is picked up); writes and the layer's keys stay in the layer; spreading it copies both.
 */
export function liveEnv(layer: Record<string, string>, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const own = (key: PropertyKey) => Object.prototype.hasOwnProperty.call(layer, key);
  return new Proxy(layer as NodeJS.ProcessEnv, {
    get: (target, key) => (own(key) ? Reflect.get(target, key) : typeof key === 'string' ? base[key] : undefined),
    has: (_target, key) => own(key) || (typeof key === 'string' && key in base),
    ownKeys: (target) => [...new Set([...Reflect.ownKeys(base), ...Reflect.ownKeys(target)])],
    getOwnPropertyDescriptor: (target, key) => {
      if (own(key)) return Reflect.getOwnPropertyDescriptor(target, key);
      const value = typeof key === 'string' ? base[key] : undefined;
      return value === undefined ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
  });
}

function toTerminalVerdict(verdict: ScenarioVerdict): TerminalVerdict {
  return verdict === 'ERROR' ? 'FAIL' : verdict;
}

function artifactGroupOf(scenario: Scenario, adapter: ProjectAdapter | undefined): ArtifactGroup {
  return adapter?.resolveArtifactGroup?.(scenario.name) ?? { domain: scenario.module ?? 'default', kind: scenario.kind, testCaseId: scenario.testCaseId };
}

function toIndexEntry({ scenario }: DiscoveredScenario, adapter: ProjectAdapter | undefined): ScenarioIndexEntry {
  const domain = artifactGroupOf(scenario, adapter).domain;
  return { scenario: scenario.name, module: scenario.module ?? domain, domain, kind: scenario.kind, testCaseId: scenario.testCaseId };
}

/** `--clean`: the selected scenarios' artifact folders, then their rows in the run store. */
function cleanSelection(loaded: LoadedProjectConfig, adapter: ProjectAdapter | undefined, scenarios: readonly Scenario[], logger: Logger): void {
  const groups = new Map(scenarios.map((s) => [s.name, artifactGroupOf(s, adapter)]));
  const removed = cleanArtifactTrees({
    rootDir: loaded.rootDir,
    roots: ['reports', 'outputs', 'evidence'].map((root) => path.join(loaded.rootDir, root)),
    scope: 'run',
    scenarios: [...groups.keys()],
    scenarioSegments: (name) => groupSegments(groups.get(name)!),
  });

  let runsDeleted = 0;
  const sqlitePath = loaded.resolvePath(loaded.config.reporting.sqlite);
  if (fs.existsSync(sqlitePath)) {
    const db = openRunStore(sqlitePath);
    try {
      runsDeleted = purgeRunsInStore(db, [...groups.keys()]).runsDeleted;
    } finally {
      db.close();
    }
  }
  logger.info(`--clean: removed ${removed.length} artifact folder(s) and ${runsDeleted} stored run(s).`);
}

/**
 * `qakit-suite`: discover scenarios under `paths.suites` (or the given files), select a slice and run it
 * one scenario after another. Returns the exit code: 1 when a scenario failed, 0 otherwise (BLOCKED is an
 * environment verdict, not a regression).
 *
 * The console output is a contract with the reporting app, which lists, previews and tracks jobs by
 * parsing it (apps/reporting-api/src/modules/regression-jobs/regression-{list,progress}.util.ts):
 *
 *   TC-ORD-A01       api  orders                       orders-list        --list rows
 *   2 scenario(s) selected  [api]                                         --list summary
 *   module tokens: orders                                                 --list, when no --module
 *   [<ISO>] [INFO] Batch [api]: 2 scenario(s) against "local"             batch header
 *   [<ISO>] [INFO] [1/2] PASS    TC-ORD-A01       orders-list (0.4s)       one per scenario
 *     PASS 2   BLOCKED 0   FAIL 0                                         final counts
 *   Summary: <absolute path to reports/_batches/*.md>
 */
export async function runSuiteCli(argv: readonly string[]): Promise<number> {
  const args = parseSuiteArgs(argv);
  const logger = createLogger();
  const loaded = loadProjectConfigWithEnv({ configPath: path.resolve(args.configPath ?? process.env.QAKIT_CONFIG ?? 'qakit.config.yaml'), environment: args.environment });
  const environment = loaded.config.environment;
  const adapter = await loadProjectAdapter(loaded);

  const discovered = await discoverScenarios(loaded, { files: args.files });
  const byName = new Map(discovered.map((d) => [d.scenario.name, d.scenario]));
  const index = sortScenarioIndex(discovered.map((d) => toIndexEntry(d, adapter)));

  // Grep keeps the kit's meaning (scenario key, title or test-case id), so it is applied here rather than
  // by selectScenarios, which knows no titles.
  const grep = args.grep?.toLowerCase();
  const selected = selectScenarios(index, { kind: args.kind, modules: args.modules, testCaseIds: args.testCaseIds }).filter((entry) => {
    if (!grep) return true;
    const scenario = byName.get(entry.scenario)!;
    return [scenario.name, scenario.title, scenario.testCaseId].some((text) => text.toLowerCase().includes(grep));
  });

  if (args.list) {
    for (const entry of selected) {
      console.log(`${pad(entry.testCaseId, 16)} ${pad(entry.kind, 4)} ${pad(entry.domain, 28)} ${entry.scenario}`);
    }
    console.log(`\n${selected.length} scenario(s) selected  [${args.label}]`);
    if (args.modules.length === 0) console.log(`\nmodule tokens: ${knownModuleTokens(index).join(', ')}`);
    return 0;
  }

  if (selected.length === 0) {
    logger.error(`No scenario matched [${args.label}]. Valid --module tokens: ${knownModuleTokens(index).join(', ')}`);
    return 1;
  }

  if (args.cleanup !== undefined) logger.warn(`--${args.cleanup ? '' : 'no-'}cleanup has no effect: qakit scenarios clean up after themselves.`);
  if (args.clean) cleanSelection(loaded, adapter, selected.map((e) => byName.get(e.scenario)!), logger);

  // Live, not a copy: a project entrypoint may keep a short-lived credential in process.env fresh (a static-bearer
  // token that expires within the batch, or within one long scenario). Writes stay in the scenario's own layer.
  const scenarioEnv = (): NodeJS.ProcessEnv =>
    liveEnv({
      ...(args.headed ? { QAKIT_UI_HEADLESS: '0' } : {}),
      ...(args.uiSlowMoMs !== undefined ? { QAKIT_UI_SLOWMO_MS: String(args.uiSlowMoMs) } : {}),
    });
  // Set by a supervising process (the reporting API) that cannot signal a child gracefully on Windows.
  const cancelFile = process.env.QAKIT_CANCEL_FILE;

  const startedAt = new Date().toISOString();
  const batchStartMs = Date.now();
  const rows: BatchSummaryRow[] = [];
  let stoppedEarly: string | undefined;

  logger.info(`Batch [${args.label}]: ${selected.length} scenario(s) against "${environment}"`);

  for (const [index, entry] of selected.entries()) {
    if (cancelFile && fs.existsSync(cancelFile)) {
      stoppedEarly = `Cancel requested — stopped after ${rows.length} scenario(s).`;
      logger.warn(stoppedEarly);
      break;
    }

    const scenario = byName.get(entry.scenario)!;
    let row: BatchSummaryRow;
    let detail = '';
    try {
      const outcome = await runScenario(scenario, { loaded, adapter, logger, env: scenarioEnv(), environment });
      row = {
        verdict: toTerminalVerdict(outcome.verdict),
        testCaseId: entry.testCaseId,
        scenario: entry.scenario,
        domain: entry.domain,
        kind: entry.kind,
        durationMs: outcome.durationMs,
        error: outcome.error ?? outcome.blockedReason,
      };
      detail = ` ${outcome.checks - outcome.failedChecks}/${outcome.checks} checks, report: ${path.relative(loaded.rootDir, outcome.reportPath)}`;
    } catch (err) {
      // runScenario traps scenario failures; reaching here means the harness itself threw. Record it and
      // keep going, so one broken scenario does not cost the rest of the batch its run.
      row = { verdict: 'FAIL', testCaseId: entry.testCaseId, scenario: entry.scenario, domain: entry.domain, kind: entry.kind, durationMs: 0, error: err instanceof Error ? err.message : String(err) };
    }
    rows.push(row);

    const line = `[${index + 1}/${selected.length}] ${pad(row.verdict, 7)} ${pad(row.testCaseId, 16)} ${row.scenario} (${(row.durationMs / 1000).toFixed(1)}s)${detail}`;
    if (row.verdict === 'PASS') logger.info(line);
    else if (row.verdict === 'BLOCKED') logger.warn(`${line}${row.error ? ` — ${row.error}` : ''}`);
    else logger.error(`${line}${row.error ? ` — ${row.error}` : ''}`);

    if (args.bail && row.verdict === 'FAIL') {
      stoppedEarly = `--bail: stopped after the first failure (${selected.length - rows.length} scenario(s) not run).`;
      logger.error(stoppedEarly);
      break;
    }
  }

  const durationMs = Date.now() - batchStartMs;
  const summaryDir = path.join(loaded.rootDir, 'reports', '_batches');
  fs.mkdirSync(summaryDir, { recursive: true });
  const summaryPath = path.join(summaryDir, batchSummaryFileName(startedAt, args.label));
  fs.writeFileSync(
    summaryPath,
    renderBatchSummary({ label: args.label, environment, rows, startedAt, durationMs, sections: stoppedEarly ? [`> ${stoppedEarly}`, ''] : [] }),
    'utf8',
  );

  const counts = countVerdicts(rows);
  console.log('');
  console.log(`Batch [${args.label}] — ${rows.length} run in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  PASS ${counts.PASS}   BLOCKED ${counts.BLOCKED}   FAIL ${counts.FAIL}`);
  for (const row of rows.filter((r) => r.verdict === 'FAIL')) {
    console.log(`  FAIL  ${pad(row.testCaseId, 16)} ${row.scenario}${row.error ? ` — ${row.error}` : ''}`);
  }
  console.log(`Summary: ${summaryPath}`);

  return counts.FAIL > 0 ? 1 : 0;
}
