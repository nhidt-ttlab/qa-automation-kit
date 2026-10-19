import type { CheckResult, HttpClient, LoadedProjectConfig, Logger } from '@qakit/core';
import type { DesktopDriver } from '@qakit/desktop';
import type { UiDriver, WebTarget } from '@qakit/ui';

export type ScenarioKind = 'api' | 'ui';

/** What an API scenario gets to work with. */
export interface ApiScenarioContext {
  runId: string;
  loaded: LoadedProjectConfig;
  logger: Logger;
  env: NodeJS.ProcessEnv;
  /** Requests go to a source by its `apiSources` key and carry its credentials. */
  http: HttpClient;
  /**
   * Records one check. `assertion` is the step doc's assertion id (e.g. `A2`); the check is stored as
   * `<testCaseId> / <assertion>`, which must match `ids.checkRef`.
   */
  check(assertion: string, label: string, expected: unknown, actual: unknown): CheckResult;
  /** Records a step for the report. */
  step(title: string, ok: boolean, data?: unknown): void;
  /** A line for the report's highlights. */
  highlight(text: string): void;
  /** Marks the run BLOCKED: part of it could not be evaluated (missing data, unavailable dependency). */
  block(reason: string): void;
}

/**
 * What a UI scenario gets: everything an API scenario has, plus a lazily launched browser (the `web` block) and a
 * lazily launched desktop app (the `desktop` block). A scenario may use either or both.
 */
export interface UiScenarioContext extends ApiScenarioContext {
  /** The config's `web` block; reading it throws when the project has none. */
  web: WebTarget;
  /** Launches the browser on first call and signs in per `web.authMode`. */
  ui(): Promise<UiDriver>;
  /** Launches the desktop app (`desktop` block, WebdriverIO + Electron service) on first call. */
  desktop(): Promise<DesktopDriver>;
}

interface ScenarioBase {
  /** Unique scenario key, e.g. `orders-list`. Reports and the run store are keyed by it. */
  name: string;
  testCaseId: string;
  /** Business-readable test-case name. */
  title: string;
  objective: string;
  /** Module id from `modules[]`; groups artifacts. */
  module?: string;
}

export interface ApiScenario extends ScenarioBase {
  kind: 'api';
  run(ctx: ApiScenarioContext): Promise<void>;
}

export interface UiScenario extends ScenarioBase {
  kind: 'ui';
  run(ctx: UiScenarioContext): Promise<void>;
}

export type Scenario = ApiScenario | UiScenario;

export function defineApiScenario(scenario: Omit<ApiScenario, 'kind'>): ApiScenario {
  return { ...scenario, kind: 'api' };
}

export function defineUiScenario(scenario: Omit<UiScenario, 'kind'>): UiScenario {
  return { ...scenario, kind: 'ui' };
}

export function isScenario(value: unknown): value is Scenario {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<Scenario>;
  return (candidate.kind === 'api' || candidate.kind === 'ui') && typeof candidate.name === 'string' && typeof candidate.run === 'function';
}
