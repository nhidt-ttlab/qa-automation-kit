import {
  ConfigError,
  EvidenceStore,
  createAuthProviders,
  type AuthConfig,
  type AuthSource,
  type LoadedProjectConfig,
  type Logger,
  type ProjectAdapter,
} from '@qakit/core';
import type { BrowserType } from 'playwright';
import type { UiDriverText } from './driver.js';
import { createHtmlWidgets } from './html-widgets.js';
import { createBrowserRuntime, type BrowserRuntime, type RetainPolicy } from './runtime.js';
import type { WebTarget } from './types.js';
import type { UiWidgets } from './widgets.js';

/**
 * Browsers `QAKIT_UI_BROWSER` may name. `chromium` (the default) is Playwright's bundled Chromium; `chrome` and `msedge`
 * are the branded browsers installed on the machine, launched through Playwright's `channel`; `firefox` is Playwright's
 * Firefox (`npx playwright install firefox`). Every existing caller keeps today's behaviour: the variable unset means
 * `chromium`.
 */
export const UI_BROWSERS = ['chromium', 'chrome', 'msedge', 'firefox'] as const;
export type UiBrowserName = (typeof UI_BROWSERS)[number];

/** The variable a run sets to pick the browser (a browser/OS matrix runs the same suite once per value). */
export const UI_BROWSER_ENV = 'QAKIT_UI_BROWSER';

export interface ResolvedUiBrowser {
  name: UiBrowserName;
  /** The Playwright browser type to launch. */
  engine: 'chromium' | 'firefox';
  /** Playwright launch `channel` for the branded builds; undefined for the bundled ones. */
  channel?: 'chrome' | 'msedge';
}

/** Reads `QAKIT_UI_BROWSER` (case-insensitive, trimmed). Unset or empty → `chromium`; anything else unknown → `ConfigError`. */
export function resolveUiBrowser(env: NodeJS.ProcessEnv = process.env): ResolvedUiBrowser {
  const raw = (env[UI_BROWSER_ENV] ?? '').trim().toLowerCase();
  const name = (raw === '' ? 'chromium' : raw) as UiBrowserName;
  if (!UI_BROWSERS.includes(name)) {
    throw new ConfigError(`${UI_BROWSER_ENV}="${env[UI_BROWSER_ENV]}" is not a browser this kit can launch — use one of ${UI_BROWSERS.join(', ')}.`);
  }
  switch (name) {
    case 'firefox':
      return { name, engine: 'firefox' };
    case 'chrome':
    case 'msedge':
      return { name, engine: 'chromium', channel: name };
    default:
      return { name: 'chromium', engine: 'chromium' };
  }
}

/** The Playwright `BrowserType` for a resolved browser (Playwright is imported lazily, like everywhere else in the kit). */
export async function uiBrowserType(resolved: ResolvedUiBrowser): Promise<BrowserType> {
  const playwright = await import('playwright');
  return resolved.engine === 'firefox' ? playwright.firefox : playwright.chromium;
}

/**
 * Whether the resolved browser can be launched here, without a network call: the bundled builds by their executable,
 * the branded channels by a short headless launch (their path is not known before launching).
 */
export async function uiBrowserInstalled(resolved: ResolvedUiBrowser): Promise<{ ok: boolean; detail: string }> {
  const browserType = await uiBrowserType(resolved);
  if (!resolved.channel) {
    const { existsSync } = await import('node:fs');
    const executable = browserType.executablePath();
    return existsSync(executable) ? { ok: true, detail: `${resolved.name} installed (${executable})` } : { ok: false, detail: `run \`npx playwright install ${resolved.engine}\`` };
  }
  try {
    const browser = await browserType.launch({ headless: true, channel: resolved.channel });
    const version = browser.version();
    await browser.close();
    return { ok: true, detail: `${resolved.name} ${version} installed` };
  } catch (error) {
    return { ok: false, detail: `${resolved.name} (channel ${resolved.channel}) could not be launched: ${error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error)}` };
  }
}

/** How a browser session signs in: a seeded session, the real login form, or not at all. */
export type ProjectAuthMode = 'storage' | 'form' | 'none';

/** The config's `web` block as a browser target, with `baseUrl` resolved. */
export function projectWebTarget(loaded: LoadedProjectConfig): WebTarget {
  const web = loaded.config.web;
  if (!web) throw new ConfigError(`${loaded.configPath} has no \`web\` block — a browser session needs one.`);
  const baseUrl = loaded.resolveValue(web.baseUrl);
  if (!baseUrl) throw new ConfigError(`${loaded.configPath}: web.baseUrl resolved to nothing.`);
  return { baseUrl, loginPath: web.loginPath, allowedHosts: web.allowedHosts, authPaths: web.authPaths, viewport: web.viewport };
}

function loginAuthOf(loaded: LoadedProjectConfig): AuthConfig | undefined {
  const { config } = loaded;
  const apiSource = config.web?.apiSource;
  const auth = apiSource ? config.apiSources[apiSource]?.auth : undefined;
  return auth?.type === 'reuse' ? config.apiSources[auth.from]?.auth : auth;
}

export interface ProjectAuthModes {
  available: [ProjectAuthMode, ...ProjectAuthMode[]];
  defaultMode: ProjectAuthMode;
  /** Settings the adapter cannot back, for the caller to log. */
  warnings: string[];
}

/**
 * Which sign-in modes the project can actually use:
 * - `storage` needs `browser.seedSession` and `web.apiSource` (the token comes from that source);
 * - `form` needs `browser.loginViaForm` and a source with `usernameEnv` / `passwordEnv`;
 * - `none` is always available.
 */
export function projectAuthModes(loaded: LoadedProjectConfig, adapter: ProjectAdapter | undefined): ProjectAuthModes {
  const web = loaded.config.web;
  const browser = adapter?.browser;
  const loginAuth = loginAuthOf(loaded);
  const available: ProjectAuthMode[] = [];
  if (browser?.seedSession && web?.apiSource) available.push('storage');
  if (browser?.loginViaForm && loginAuth && 'usernameEnv' in loginAuth) available.push('form');
  available.push('none');

  const warnings: string[] = [];
  const wanted = web?.authMode ?? 'none';
  const defaultMode = available.includes(wanted) ? wanted : 'none';
  if (defaultMode !== wanted) {
    warnings.push(`web.authMode "${wanted}" needs adapter browser hooks this project does not provide — sessions default to "none".`);
  }
  if (web && web.widgets.some((name) => name !== 'html')) {
    warnings.push(`Widget adapters ${web.widgets.join(', ')} are not built in; the generic setup drives the page with the html adapter.`);
  }
  return { available: available as [ProjectAuthMode, ...ProjectAuthMode[]], defaultMode, warnings };
}

export interface OpenProjectBrowserOptions {
  loaded: LoadedProjectConfig;
  adapter?: ProjectAdapter;
  logger: Pick<Logger, 'warn'>;
  scenario: string;
  runId: string;
  /** Evidence folder for this run. */
  runDir: string;
  authMode?: ProjectAuthMode;
  allowWrites: boolean;
  env?: NodeJS.ProcessEnv;
  widgets?: UiWidgets;
  driverText?: UiDriverText;
  timeoutMs?: number;
  tracePolicy?: RetainPolicy;
  videoPolicy?: RetainPolicy;
  harMode?: string;
}

export interface ProjectBrowser {
  runtime: BrowserRuntime<ProjectAuthMode>;
  evidence: EvidenceStore;
  web: WebTarget;
}

/**
 * A browser runtime for the project described by `qakit.config.yaml`: the browser `QAKIT_UI_BROWSER` names (Playwright
 * Chromium by default; `chrome`, `msedge` or `firefox`, see {@link resolveUiBrowser}), evidence under the project root,
 * the widget adapter (ARIA/native by default), and sign-in through the adapter's `browser` hooks. Launching is lazy —
 * nothing starts until `runtime.ui()`. The manifest records the browser's name and version.
 */
export async function openProjectBrowser(options: OpenProjectBrowserOptions): Promise<ProjectBrowser> {
  const { loaded, adapter, logger } = options;
  const env = options.env ?? process.env;
  const web = projectWebTarget(loaded);
  const webConfig = loaded.config.web!;
  const browser = adapter?.browser;
  const loginAuth = loginAuthOf(loaded);
  const timeoutMs = options.timeoutMs ?? 30_000;

  const sources: Record<string, AuthSource> = {};
  for (const [id, source] of Object.entries(loaded.config.apiSources)) {
    sources[id] = { baseUrl: loaded.resolveValue(source.baseUrl) ?? '', auth: source.auth };
  }
  const providers = createAuthProviders(sources, { env });

  const uiBrowser = resolveUiBrowser(env);
  const browserType = await uiBrowserType(uiBrowser);
  const evidence = new EvidenceStore({ scenario: options.scenario, runId: options.runId, webBaseUrl: web.baseUrl, rootDir: loaded.rootDir, runDir: options.runDir });
  const runtime = createBrowserRuntime<ProjectAuthMode>({
    browserType,
    channel: uiBrowser.channel,
    browserName: uiBrowser.name,
    web,
    evidence,
    logger,
    defaultAuthMode: options.authMode ?? projectAuthModes(loaded, adapter).defaultMode,
    widgets: options.widgets ?? createHtmlWidgets(),
    driverText: options.driverText,
    headless: env.QAKIT_UI_HEADLESS !== '0',
    // Set by `qakit-suite --ui-slowmo <ms>`; watching a headed run is the only reason to want it.
    slowMoMs: Number(env.QAKIT_UI_SLOWMO_MS) > 0 ? Number(env.QAKIT_UI_SLOWMO_MS) : undefined,
    timeoutMs,
    tracePolicy: options.tracePolicy,
    videoPolicy: options.videoPolicy,
    harMode: options.harMode,
    allowWrites: options.allowWrites,
    auth: {
      beforePage: async (browserContext, mode) => {
        if (mode !== 'storage') return;
        const token = await providers.get(webConfig.apiSource!)?.getToken();
        if (!token) throw new Error(`Could not get a token from api source "${webConfig.apiSource}" to seed the browser session.`);
        await browser!.seedSession!(browserContext, web.baseUrl, { accessToken: token } as never);
      },
      afterPage: async (driver, page, mode) => {
        if (mode === 'storage') {
          await driver.goto('/');
          const verification = await browser?.verifyLoggedIn?.(page, web.loginPath);
          if (verification && !verification.ok) throw new Error(`Seeded session rejected: ${verification.reason ?? 'no reason given'}`);
        } else if (mode === 'form') {
          const credentials = loginAuth as { usernameEnv: string; passwordEnv: string };
          const username = env[credentials.usernameEnv];
          const password = env[credentials.passwordEnv];
          if (!username || !password) throw new Error(`Form login needs ${credentials.usernameEnv} / ${credentials.passwordEnv}.`);
          await browser!.loginViaForm!(page, { webBaseUrl: web.baseUrl, loginPath: web.loginPath, username, password, timeoutMs } as never);
        }
      },
    },
  });
  // Every launch may send the project's declared read-only POST lookups, plus any the caller adds.
  const postLookups = webConfig.postLookups;
  const withLookups: BrowserRuntime<ProjectAuthMode> = {
    ...runtime,
    ui: (launch) => runtime.ui({ ...launch, postLookups: [...postLookups, ...(launch?.postLookups ?? [])] }),
  };
  return { runtime: withLookups, evidence, web };
}
