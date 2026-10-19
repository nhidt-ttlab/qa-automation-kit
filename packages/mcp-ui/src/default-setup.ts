import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createArtifactLayout, createRunWriter, sanitizeSegment, type LoadedProjectConfig, type Logger, type ProjectAdapter } from '@qakit/core';
import {
  openProjectBrowser,
  projectAuthModes,
  projectWebTarget,
  type ProjectAuthMode,
  type UiCheckText,
  type UiDriver,
  type UiDriverText,
} from '@qakit/ui';
import type { UiMcpSetup } from './server.js';
import type { UiMcpText } from './text.js';

/** What a `@qakit/locale-<lang>` package exports as `locale`. */
export interface UiMcpLocalePack {
  uiMcpText?: UiMcpText;
  destructiveLabel?: RegExp;
  uiDriverText?: UiDriverText;
  /** Wording of the shared UI checks, for scenario harnesses. */
  uiCheckText?: UiCheckText;
}

export type DefaultAuthMode = ProjectAuthMode;

export interface UiMcpSetupContext {
  logger: Logger;
  locale?: UiMcpLocalePack;
}

/**
 * The locale pack named by `locale` in the config, resolved from the project (not from the kit), so
 * a project gets exactly the pack it installed. `undefined` for `en` or when none is installed.
 */
export async function loadLocalePack(loaded: LoadedProjectConfig): Promise<UiMcpLocalePack | undefined> {
  const language = loaded.config.locale.split('-')[0];
  if (language === 'en') return undefined;
  try {
    const resolved = createRequire(path.join(loaded.rootDir, 'package.json')).resolve(`@qakit/locale-${language}`);
    const imported = (await import(pathToFileURL(resolved).href)) as { locale?: UiMcpLocalePack };
    return imported.locale;
  } catch {
    return undefined;
  }
}

/** Everything `qakit.config.yaml` decides about the server, as defaults beneath the project's setup. */
export function setupDefaultsFromConfig(
  loaded: LoadedProjectConfig,
  locale: UiMcpLocalePack | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { defaults: Partial<UiMcpSetup>; overrides: Partial<UiMcpSetup> } {
  const { config } = loaded;
  const { safety } = config;
  const idle = Number(env.QAKIT_UI_MCP_IDLE_MS);
  return {
    defaults: {
      serverName: `${config.mcp.uiServerName}-mcp`,
      text: locale?.uiMcpText,
      destructiveLabel: locale?.destructiveLabel,
      checkRefPattern: new RegExp(config.ids.checkRef),
      allowWrites: safety.allowWrites,
      allowDestructive: safety.allowDestructive,
      maxActionsPerSession: safety.budget.maxActionsPerSession,
      maxSessionMs: safety.budget.maxSessionMs,
      environment: config.environment,
      auditRoot: loaded.resolvePath(config.paths.evidence),
      idleTimeoutMs: Number.isFinite(idle) && idle > 0 ? idle : undefined,
    },
    // A pattern written into the config is the project's explicit decision, so it beats code defaults.
    overrides:
      safety.destructiveLabels === 'locale' ? {} : { destructiveLabel: new RegExp(safety.destructiveLabels.pattern, safety.destructiveLabels.flags) },
  };
}

const SECRET_FIELDS = ['passwordEnv', 'staticTokenEnv', 'tokenEnv', 'keyEnv', 'clientSecretEnv'] as const;

/** Values of every credential env var the api sources name — never to be typed into a page. */
export function secretValuesFromConfig(loaded: LoadedProjectConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const values = new Set<string>();
  for (const source of Object.values(loaded.config.apiSources)) {
    const auth = source.auth as Record<string, unknown>;
    for (const field of SECRET_FIELDS) {
      const name = auth[field];
      const value = typeof name === 'string' ? env[name] : undefined;
      if (value) values.add(value);
    }
  }
  return [...values];
}

/**
 * The generic setup used when the adapter has no `mcpUi` hook: a Playwright Chromium over the
 * ARIA/native `createHtmlWidgets`, evidence under the project root, the kit's run writer, and
 * sign-in through the adapter's `browser` hooks when it has them.
 *
 * - `storage` needs `browser.seedSession` and `web.apiSource`; the token comes from that source.
 * - `form` needs `browser.loginViaForm`; credentials come from the source's `usernameEnv` / `passwordEnv`.
 * - `none` is always available.
 */
export function createDefaultUiMcpSetup(
  loaded: LoadedProjectConfig,
  adapter: ProjectAdapter | undefined,
  context: UiMcpSetupContext,
  env: NodeJS.ProcessEnv = process.env,
): UiMcpSetup<DefaultAuthMode, UiDriver> {
  const { config } = loaded;
  const target = projectWebTarget(loaded);
  const modes = projectAuthModes(loaded, adapter);
  for (const warning of modes.warnings) context.logger.warn(warning);

  const layout = createArtifactLayout({
    rootDir: loaded.rootDir,
    resolveGroup: adapter?.resolveArtifactGroup ?? ((scenario) => ({ domain: '_unknown', kind: undefined, testCaseId: sanitizeSegment(scenario) })),
  });

  return {
    web: target,
    authModes: modes.available,
    defaultAuthMode: modes.defaultMode,
    secretValues: secretValuesFromConfig(loaded, env),
    writeRun: createRunWriter({
      layout,
      sqlitePath: loaded.resolvePath(config.reporting.sqlite),
      wording: adapter?.reportWording,
      persistHooks: adapter?.persistHooks,
      logger: context.logger,
    }),
    openRuntime: async ({ scenario, runId, authMode, allowWrites }) => {
      const { runtime, evidence } = await openProjectBrowser({
        loaded,
        adapter,
        logger: context.logger,
        scenario,
        runId,
        runDir: layout.runEvidenceDir(scenario, runId),
        authMode,
        allowWrites,
        env,
        driverText: context.locale?.uiDriverText,
      });
      return {
        ui: (options) => runtime.ui(options),
        evidence,
        networkTrace: () => runtime.networkTrace(),
        close: (passed) => runtime.close(passed),
        evidenceDirDisplay: () => runtime.evidenceDirDisplay(),
      };
    },
  };
}
