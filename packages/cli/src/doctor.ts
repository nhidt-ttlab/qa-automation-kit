import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  ConfigError,
  createAuthProviders,
  loadDotEnvFiles,
  loadProjectAdapter,
  loadProjectConfig,
  newRunId,
  type AuthSource,
  type LoadedProjectConfig,
  type ProjectAdapter,
} from '@qakit/core';
import { describeDesktopTarget, desktopDriverInstalled, openProjectDesktop, projectDesktopTarget } from '@qakit/desktop';
import { apiSourcesFromConfig, loadDomains, loadEdges } from '@qakit/mcp-api';
import { openProjectBrowser, projectAuthModes, projectWebTarget, resolveUiBrowser, uiBrowserInstalled, UI_BROWSER_ENV } from '@qakit/ui';
import { KIT_ROOT, STAMP_FILE, kitVersion } from './skills.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorOptions {
  configPath: string;
  environment?: string;
  /** Skip every network call (spec fetch, login, web reachability, browser login). */
  offline?: boolean;
  /** Also sign in through a real browser, per `web.authMode`. */
  browser?: boolean;
  /** Also launch the desktop app (`desktop` block) and read its window title. */
  desktop?: boolean;
  /** Installed skills folder to compare against the kit version. */
  skillsDir?: string;
  /** Defaults to `process.env`; `.env` files are loaded into it. */
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  kitRoot?: string;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Checks that a project can use the kit: the config loads, the env files and adapter exist, every API
 * source resolves and (online) serves its spec and issues a token, the domains reference known sources,
 * the web target answers and the browser is installed, the desktop app and its WebdriverIO packages are there, and
 * installed skills match the kit version.
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: CheckStatus, detail: string): void => {
    checks.push({ name, status, detail });
  };
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  let loaded: LoadedProjectConfig;
  try {
    const first = loadProjectConfig({ configPath: options.configPath, environment: options.environment, env });
    loadDotEnvFiles(first.config.envFiles.map((f) => first.resolvePath(f)), env);
    loaded = loadProjectConfig({ configPath: options.configPath, environment: options.environment, env });
    add('config', 'ok', `${loaded.config.project} (environment ${loaded.config.environment}, locale ${loaded.config.locale})`);
    for (const file of loaded.config.envFiles) {
      const full = loaded.resolvePath(file);
      if (!existsSync(full)) add('env file', 'warn', `${file} not found${existsSync(`${full}.example`) ? ` — copy ${file}.example` : ''}`);
    }
  } catch (error) {
    add('config', 'fail', error instanceof ConfigError ? error.message : message(error));
    return checks;
  }
  const { config } = loaded;

  let adapter: ProjectAdapter | undefined;
  if (config.adapter) {
    try {
      adapter = await loadProjectAdapter(loaded);
      add('adapter', 'ok', `${adapter?.name} (${config.adapter})`);
    } catch (error) {
      const detail = message(error);
      add('adapter', 'fail', /Cannot find (package|module) '@qakit\//.test(detail) ? `${detail}\n  The kit packages are not installed here — run \`npm install\` in the project first.` : detail);
    }
  }

  for (const [key, value] of Object.entries({ suites: config.paths.suites, steps: config.paths.steps, knowledge: config.paths.knowledge })) {
    if (!existsSync(loaded.resolvePath(value))) add(`paths.${key}`, 'warn', `${value} does not exist yet`);
  }

  // API sources.
  const sources: Record<string, AuthSource> = {};
  for (const [id, source] of Object.entries(config.apiSources)) sources[id] = { baseUrl: loaded.resolveValue(source.baseUrl) ?? '', auth: source.auth };
  const providers = createAuthProviders(sources, { env });
  const mcpSources = apiSourcesFromConfig(loaded);
  for (const source of mcpSources.values()) {
    const name = `api source ${source.id}`;
    if (!source.baseUrl()) {
      add(name, 'fail', 'baseUrl resolves to nothing');
      continue;
    }
    const provider = providers.get(source.configId);
    const configured = !source.requiresAuth || (provider?.isConfigured() ?? false);
    add(`${name} credentials`, configured ? 'ok' : 'warn', configured ? (source.requiresAuth ? 'configured' : 'no auth') : `not set (${source.credentialEnvNames.join(' / ')})`);

    const specFile = source.specFileEnv ? env[source.specFileEnv] : undefined;
    if (specFile) {
      add(`${name} spec`, existsSync(specFile) ? 'ok' : 'fail', `${source.specFileEnv}=${specFile}${existsSync(specFile) ? '' : ' (missing)'}`);
    } else if (options.offline) {
      add(`${name} spec`, 'skip', 'offline');
    } else {
      try {
        const response = await fetchImpl(source.specUrl());
        const body = response.ok ? ((await response.json()) as { openapi?: string; swagger?: string; paths?: object }) : undefined;
        const operations = body?.paths ? Object.keys(body.paths).length : 0;
        add(`${name} spec`, response.ok && body ? 'ok' : 'fail', response.ok ? `${source.specUrl()} (${operations} paths)` : `${source.specUrl()} answered ${response.status}`);
      } catch (error) {
        add(`${name} spec`, 'fail', `${source.specUrl()}: ${message(error)}`);
      }
    }

    if (source.requiresAuth && configured && !options.offline) {
      try {
        const parts = await provider!.authorize();
        const got = Object.keys(parts.headers).length + Object.keys(parts.query).length > 0;
        add(`${name} login`, got ? 'ok' : 'fail', got ? 'credentials accepted' : 'no credentials were produced');
      } catch (error) {
        add(`${name} login`, 'fail', message(error));
      }
    }
  }

  // Domains.
  if (config.api.domainsDir) {
    try {
      const domains = loadDomains(loaded.resolvePath(config.api.domainsDir));
      const unknown = domains.flatMap((d) => d.apiSourceIds.filter((id) => !mcpSources.has(id)).map((id) => `${d.id} -> ${id}`));
      add('api domains', domains.length === 0 ? 'warn' : unknown.length > 0 ? 'fail' : 'ok', unknown.length > 0 ? `unknown api sources: ${unknown.join(', ')}` : `${domains.length} domain(s)`);
      if (config.api.businessGraph) add('business graph', 'ok', `${loadEdges(loaded.resolvePath(config.api.businessGraph)).length} edge(s)`);
    } catch (error) {
      add('api domains', 'fail', message(error));
    }
  }

  // Web.
  if (config.web) {
    try {
      const web = projectWebTarget(loaded);
      add('web target', 'ok', `${web.baseUrl} (allowed hosts: ${web.allowedHosts.join(', ')})`);
      const host = new URL(web.baseUrl).host;
      if (!web.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) add('web allowedHosts', 'fail', `${host} is not in web.allowedHosts, so the browser guard would block the app itself`);
      if (!options.offline) {
        try {
          const response = await fetchImpl(web.baseUrl, { redirect: 'manual' });
          add('web reachable', response.status < 500 ? 'ok' : 'fail', `${web.baseUrl} answered ${response.status}`);
        } catch (error) {
          add('web reachable', 'fail', `${web.baseUrl}: ${message(error)}`);
        }
      }
      const modes = projectAuthModes(loaded, adapter);
      add('web sign-in', modes.warnings.length > 0 ? 'warn' : 'ok', modes.warnings.join(' ') || `authMode ${modes.defaultMode}`);
      // The browser the suite would launch (`QAKIT_UI_BROWSER`: chromium by default, or chrome / msedge / firefox).
      try {
        const requested = resolveUiBrowser(env);
        const installed = await uiBrowserInstalled(requested);
        add('browser', installed.ok ? 'ok' : 'warn', `${UI_BROWSER_ENV}=${env[UI_BROWSER_ENV] ?? '(unset)'} → ${installed.detail}`);
      } catch (error) {
        add('browser', error instanceof ConfigError ? 'fail' : 'warn', error instanceof ConfigError ? error.message : `playwright is not installed: ${message(error)}`);
      }
      if (options.browser && !options.offline) {
        const runId = newRunId();
        const scratch = path.join(loaded.resolvePath(config.paths.evidence), 'doctor', runId);
        const { runtime } = await openProjectBrowser({ loaded, adapter, logger: { warn: () => {} }, scenario: 'doctor', runId, runDir: scratch, allowWrites: false, env, tracePolicy: 'off', videoPolicy: 'off', harMode: 'off' });
        try {
          const driver = await runtime.ui();
          add('browser sign-in', 'ok', `signed in (${modes.defaultMode}), now at ${driver.page.url()}`);
        } catch (error) {
          add('browser sign-in', 'fail', message(error));
        } finally {
          await runtime.close(true);
        }
      }
    } catch (error) {
      add('web target', 'fail', message(error));
    }
  }

  // Desktop.
  if (config.desktop) {
    try {
      const target = projectDesktopTarget(loaded);
      const missing = [target.appBinaryPath, target.appEntryPoint].filter((file): file is string => file !== undefined && !existsSync(file));
      add('desktop target', missing.length > 0 ? 'fail' : 'ok', missing.length > 0 ? `${missing.join(', ')} not found — build the app first` : describeDesktopTarget(target));
      if (!target.appBinaryPath) {
        const appPackage = path.join(target.appRoot, 'package.json');
        if (!existsSync(appPackage)) {
          add('desktop app root', 'fail', `${appPackage} not found — set desktop.appRoot to the app's folder`);
        } else {
          try {
            createRequire(appPackage).resolve('electron');
            add('desktop electron', 'ok', `electron resolves from ${target.appRoot}`);
          } catch {
            add('desktop electron', 'fail', `electron is not installed under ${target.appRoot} — install the app's dependencies`);
          }
        }
      }
      const driver = await desktopDriverInstalled();
      add('desktop driver', driver.ok ? 'ok' : 'fail', driver.detail);
      if (target.chromedriverPath) {
        const found = existsSync(target.chromedriverPath);
        add('desktop chromedriver', found ? 'ok' : 'fail', `${target.chromedriverPath}${found ? '' : ' not found'}`);
      }
      if (options.desktop && !options.offline) {
        const runId = newRunId();
        const scratch = path.join(loaded.resolvePath(config.paths.evidence), 'doctor', runId, 'desktop');
        const { runtime } = openProjectDesktop({ loaded, logger: { warn: () => {} }, scenario: 'doctor', runId, runDir: scratch });
        try {
          const app = await runtime.app();
          add('desktop launch', 'ok', `window "${await app.browser.getTitle()}" opened`);
        } catch (error) {
          add('desktop launch', 'fail', message(error));
        } finally {
          await runtime.close(true);
        }
      }
    } catch (error) {
      add('desktop target', 'fail', message(error));
    }
  }

  // Skills.
  if (options.skillsDir) {
    const version = kitVersion(options.kitRoot ?? KIT_ROOT);
    const dir = path.resolve(options.skillsDir);
    const stamps = existsSync(dir)
      ? readdirSync(dir)
          .map((name) => path.join(dir, name, STAMP_FILE))
          .filter((f) => existsSync(f))
          .map((f) => JSON.parse(readFileSync(f, 'utf8')) as { skill: string; version: string })
      : [];
    const stale = stamps.filter((s) => s.version !== version).map((s) => `${s.skill}@${s.version}`);
    add('skills', stamps.length === 0 ? 'warn' : stale.length > 0 ? 'warn' : 'ok', stamps.length === 0 ? `no kit skills installed in ${options.skillsDir}` : stale.length > 0 ? `older than kit ${version}: ${stale.join(', ')}` : `${stamps.length} kit skill(s) at ${version}`);
  }

  return checks;
}

const ICONS: Record<CheckStatus, string> = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };

export function formatDoctor(checks: DoctorCheck[]): string[] {
  const lines = checks.map((c) => `${ICONS[c.status]}  ${c.name.padEnd(28)} ${c.detail}`);
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  lines.push('', failed > 0 ? `${failed} problem(s), ${warned} warning(s).` : `No problems${warned > 0 ? `, ${warned} warning(s)` : ''}.`);
  return lines;
}
