import path from 'node:path';
import {
  HttpClient,
  check,
  createArtifactLayout,
  createAuthProviders,
  createRunWriter,
  runLifecycle,
  terminalVerdict,
  type AuthSource,
  type CheckResult,
  type LoadedProjectConfig,
  type Logger,
  type ProjectAdapter,
  type ReportableResult,
  type ReportStep,
  type RunWriter,
} from '@qakit/core';
import { openProjectDesktop, type DesktopDriver, type ProjectDesktop } from '@qakit/desktop';
import { mergeTraces, openProjectBrowser, projectWebTarget, type ProjectBrowser, type UiDriver } from '@qakit/ui';
import type { ApiScenarioContext, Scenario } from './scenario.js';

export interface RunScenarioOptions {
  loaded: LoadedProjectConfig;
  adapter?: ProjectAdapter;
  logger: Logger;
  env?: NodeJS.ProcessEnv;
  /** Stored with the run; defaults to the config's `environment`. */
  environment?: string;
  /** Defaults to the kit's report + SQLite writer. */
  writeRun?: RunWriter;
}

export type ScenarioVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR';

export interface ScenarioRunOutcome {
  scenario: string;
  testCaseId: string;
  kind: Scenario['kind'];
  verdict: ScenarioVerdict;
  runId: string;
  durationMs: number;
  checks: number;
  failedChecks: number;
  reportPath: string;
  outputPath: string;
  stored: boolean;
  error?: string;
  blockedReason?: string;
}

function authSources(loaded: LoadedProjectConfig): Record<string, AuthSource> {
  const sources: Record<string, AuthSource> = {};
  for (const [id, source] of Object.entries(loaded.config.apiSources)) {
    sources[id] = { baseUrl: loaded.resolveValue(source.baseUrl) ?? '', auth: source.auth };
  }
  return sources;
}

/**
 * Runs one scenario end to end: builds its context (HTTP client with the sources' credentials, and for
 * UI scenarios a lazily launched browser), turns what it recorded into a `ReportableResult`, always
 * closes the browser, and writes the report and the run store row.
 */
export async function runScenario(scenario: Scenario, options: RunScenarioOptions): Promise<ScenarioRunOutcome> {
  const { loaded, adapter, logger } = options;
  const { config } = loaded;
  const env = options.env ?? process.env;

  const layout = createArtifactLayout({
    rootDir: loaded.rootDir,
    resolveGroup: adapter?.resolveArtifactGroup ?? (() => ({ domain: scenario.module ?? 'default', kind: scenario.kind, testCaseId: scenario.testCaseId })),
  });

  const sources = authSources(loaded);
  const providers = createAuthProviders(sources, { env });
  const http = new HttpClient(
    new Map(
      Object.entries(sources).map(([id, source]) => [id, { baseUrl: source.baseUrl, auth: source.auth.type === 'none' ? undefined : providers.get(id) }]),
    ),
  );

  const checks: CheckResult[] = [];
  const steps: ReportStep[] = [];
  const highlights: string[] = [];
  const checkRef = new RegExp(config.ids.checkRef);
  let blockedReason: string | undefined;
  let browser: ProjectBrowser | undefined;
  let driver: UiDriver | undefined;
  let desktop: ProjectDesktop | undefined;
  let desktopDriver: DesktopDriver | undefined;

  const outcome = await runLifecycle<ReportableResult>({
    scenario: scenario.name,
    dryRun: false,
    environment: options.environment ?? config.environment,
    logger,
    execute: async (runId) => {
      const base: ApiScenarioContext = {
        runId,
        loaded,
        logger,
        env,
        http,
        check: (assertion, label, expected, actual) => {
          const testId = `${scenario.testCaseId} / ${assertion}`;
          if (!checkRef.test(testId)) logger.warn(`Check id "${testId}" does not match ids.checkRef (${config.ids.checkRef}).`);
          const result = check(label, expected, actual, testId);
          checks.push(result);
          return result;
        },
        step: (title, ok, data) => {
          steps.push({ title, ok, data });
        },
        highlight: (text) => {
          highlights.push(text);
        },
        block: (reason) => {
          blockedReason = reason;
        },
      };

      if (scenario.kind === 'ui') {
        await scenario.run({
          ...base,
          // Resolved on use: a desktop-only project has no `web` block.
          get web() {
            return projectWebTarget(loaded);
          },
          ui: async () => {
            browser ??= await openProjectBrowser({
              loaded,
              adapter,
              logger,
              scenario: scenario.name,
              runId,
              runDir: layout.runEvidenceDir(scenario.name, runId),
              allowWrites: config.safety.allowWrites,
              env,
            });
            driver ??= await browser.runtime.ui();
            return driver;
          },
          desktop: async () => {
            desktop ??= openProjectDesktop({
              loaded,
              logger,
              scenario: scenario.name,
              runId,
              // Its own folder, so its manifest never overwrites the browser's when a scenario uses both.
              runDir: path.join(layout.runEvidenceDir(scenario.name, runId), 'desktop'),
            });
            desktopDriver ??= await desktop.runtime.app();
            return desktopDriver;
          },
        });
      } else {
        await scenario.run(base);
      }

      const evaluated = checks.filter((c) => c.expected !== 'NOT_EVALUATED');
      return {
        scenario: scenario.name,
        dryRun: false,
        passed: blockedReason === undefined && evaluated.length > 0 && evaluated.every((c) => c.passed),
        blocked: blockedReason === undefined ? undefined : true,
        blockedReason,
        checks,
        steps: [...steps, ...(driver?.recordedSteps() ?? []), ...(desktopDriver?.recordedSteps() ?? [])],
        overview: {
          testCaseId: scenario.testCaseId,
          testCaseName: scenario.title,
          objective: scenario.objective,
          highlights: highlights.length > 0 ? highlights : undefined,
        },
      };
    },
    teardown: async (result) => {
      await desktop?.runtime.close(result?.passed ?? false);
      await browser?.runtime.close(result?.passed ?? false);
    },
  });

  const trace = [...http.getTrace(), ...(driver ? mergeTraces(driver.networkTrace()) : [])];
  const writeRun =
    options.writeRun ??
    createRunWriter({
      layout,
      sqlitePath: loaded.resolvePath(config.reporting.sqlite),
      wording: adapter?.reportWording,
      persistHooks: adapter?.persistHooks,
      logger,
    });
  const written = writeRun(outcome.result, { trace, runId: outcome.runId, meta: outcome.meta, evidenceManifestPath: (browser ?? desktop)?.evidence.manifestPath });

  const { result } = outcome;
  const errored = result.error !== undefined && result.steps.length === 0 && !(result.checks?.length ?? 0);
  return {
    scenario: scenario.name,
    testCaseId: scenario.testCaseId,
    kind: scenario.kind,
    verdict: errored ? 'ERROR' : terminalVerdict(result),
    runId: outcome.runId,
    durationMs: outcome.durationMs,
    checks: result.checks?.length ?? 0,
    failedChecks: (result.checks ?? []).filter((c) => !c.passed).length,
    reportPath: written.reportPath,
    outputPath: written.outputPath,
    stored: written.runId !== undefined,
    error: result.error,
    blockedReason,
  };
}
