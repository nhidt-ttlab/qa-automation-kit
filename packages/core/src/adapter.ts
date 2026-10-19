import { pathToFileURL } from 'node:url';
import { ConfigError, type LoadedProjectConfig } from './config/load.js';
import type { Logger } from './logger.js';
import type { ReportableResult } from './report/result.js';
import type { ReportWording } from './report/wording.js';
import type { ArtifactGroup } from './runner/artifact-layout.js';
import type { ModuleAliases } from './runner/select.js';
import type { PersistRunHooks } from './store/persist-run.js';

/**
 * The code half of a project's integration with the kit — everything `qakit.config.yaml` cannot
 * express. Every member is optional: the kit falls back to generic behaviour for whatever a project
 * leaves out. Browser and HTTP types are generic parameters so the core stays free of Playwright.
 */
export interface ProjectAdapter<
  R extends ReportableResult = ReportableResult,
  Http = unknown,
  BrowserContext = unknown,
  Page = unknown,
> {
  /** Should match `project` in the config. */
  name: string;
  /** Report language, step/check/endpoint descriptions, domain sections. */
  reportWording?: ReportWording<R>;
  /** Short `--module` names, e.g. `{ po: 'purchase-order' }`. */
  moduleAliases?: ModuleAliases;
  /** Artifact folder grouping for a scenario key. */
  resolveArtifactGroup?(scenario: string): ArtifactGroup;
  /** Domain payloads, related entities and extra data written with each run. */
  persistHooks?: PersistRunHooks<R>;
  /** The signed-in user id carried by a bearer token, in the backend's claim convention. */
  userIdFromToken?(token: string): string | undefined;
  /** Test-data lookup (and optionally creation) the scenarios depend on. */
  createDataProvider?(http: Http): unknown;
  browser?: {
    /** Puts an authenticated session into a fresh browser context before any page loads. */
    seedSession?(context: BrowserContext, webBaseUrl: string, tokens: never): Promise<void>;
    /** Confirms a page is past the login screen and rendered normally. */
    verifyLoggedIn?(page: Page, loginPath: string): Promise<{ ok: boolean; reason?: string }>;
    /** Signs in through the real login form. */
    loginViaForm?(page: Page, options: never): Promise<unknown>;
  };
  /**
   * The project half of the UI MCP server: browser runtime, run writer and wording — a `UiMcpSetup`
   * from `@qakit/mcp-ui`. Without it the server builds a generic setup from the config and `browser`.
   */
  mcpUi?(loaded: LoadedProjectConfig, context: { logger: Logger; locale?: unknown }): unknown;
}

/** Identity helper that type-checks an adapter literal while keeping its precise type. */
export function defineProjectAdapter<A extends ProjectAdapter<never, never, never, never>>(adapter: A): A {
  return adapter;
}

/**
 * Imports the module named by `adapter` in the config (resolved against the config's directory)
 * and returns its default export, or its `adapter` export. `undefined` when no adapter is configured.
 */
export async function loadProjectAdapter(loaded: LoadedProjectConfig): Promise<ProjectAdapter | undefined> {
  const { adapter } = loaded.config;
  if (adapter === undefined) return undefined;
  const modulePath = loaded.resolvePath(adapter);
  let imported: Record<string, unknown>;
  try {
    imported = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  } catch (error) {
    throw new ConfigError(`Could not import the project adapter ${modulePath}: ${(error as Error).message}`);
  }
  const candidate = imported.default ?? imported.adapter;
  if (candidate === null || typeof candidate !== 'object' || typeof (candidate as { name?: unknown }).name !== 'string') {
    throw new ConfigError(`Project adapter ${modulePath} must default-export an object with a string \`name\`.`);
  }
  return candidate as ProjectAdapter;
}
