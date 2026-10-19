import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Logger } from '@qakit/core';
import type { UiDriver, WebTarget } from '@qakit/ui';
import { UiPolicy } from './policy.js';
import { createUiToolSchemas, DEFAULT_CHECK_REF_PATTERN, DEFAULT_MODAL_PICK_MODES, type NonEmpty } from './schemas.js';
import { UiMcpSession, type OpenRuntimeArgs, type UiMcpRuntime } from './session.js';
import { englishUiMcpText, type UiMcpText } from './text.js';
import { registerUiTools, type UiRunWriter } from './tools.js';
import { ENGLISH_DESTRUCTIVE_LABEL } from './policy.js';

/**
 * Everything the UI MCP server needs from a project. `openRuntime`, `writeRun` and `web` are the
 * project's; the rest has a default, and the CLI fills most of it from `qakit.config.yaml`.
 */
export interface UiMcpSetup<Mode extends string = string, D extends UiDriver = UiDriver> {
  web: WebTarget;
  openRuntime(args: OpenRuntimeArgs<Mode>): Promise<UiMcpRuntime<Mode, D>>;
  writeRun: UiRunWriter;
  /** Accepted by `ui_open_session`. Defaults to `[defaultAuthMode]`, or `['none']`. */
  authModes?: NonEmpty<Mode>;
  defaultAuthMode?: Mode;
  serverName?: string;
  serverVersion?: string;
  text?: UiMcpText;
  destructiveLabel?: RegExp;
  checkRefPattern?: RegExp;
  allowWrites?: boolean;
  allowDestructive?: boolean;
  secretValues?: string[];
  maxActionsPerSession?: number;
  maxSessionMs?: number;
  enabledTools?: string[];
  /** Environment name stored with finished runs. */
  environment?: string;
  /** Counted as `gridCount` by `ui_describe_screen`. */
  gridSelector?: string;
  modalPickModes?: NonEmpty<string>;
  /** Audit logs go under `<auditRoot>/mcp-sessions/`. */
  auditRoot?: string;
  /** Closes an idle browser after this long. */
  idleTimeoutMs?: number;
}

export type ResolvedUiMcpSetup<Mode extends string = string, D extends UiDriver = UiDriver> = Required<
  Omit<UiMcpSetup<Mode, D>, 'enabledTools'>
> &
  Pick<UiMcpSetup<Mode, D>, 'enabledTools'>;

/** Precedence: `overrides`, then `setup`, then `defaults`, then the kit's own defaults. */
export function resolveUiMcpSetup<Mode extends string, D extends UiDriver>(
  setup: UiMcpSetup<Mode, D>,
  defaults: Partial<UiMcpSetup<Mode, D>> = {},
  overrides: Partial<UiMcpSetup<Mode, D>> = {},
): ResolvedUiMcpSetup<Mode, D> {
  const pick = <K extends keyof UiMcpSetup<Mode, D>>(key: K): UiMcpSetup<Mode, D>[K] | undefined =>
    overrides[key] ?? setup[key] ?? defaults[key];
  const explicitModes = pick('authModes');
  const defaultAuthMode = pick('defaultAuthMode') ?? explicitModes?.[0] ?? ('none' as Mode);
  const allowWrites = pick('allowWrites') ?? false;
  return {
    web: setup.web,
    openRuntime: setup.openRuntime,
    writeRun: setup.writeRun,
    authModes: explicitModes ?? [defaultAuthMode],
    defaultAuthMode,
    serverName: pick('serverName') ?? 'qakit-ui-mcp',
    serverVersion: pick('serverVersion') ?? '0.1.0',
    text: pick('text') ?? englishUiMcpText,
    destructiveLabel: pick('destructiveLabel') ?? ENGLISH_DESTRUCTIVE_LABEL,
    checkRefPattern: pick('checkRefPattern') ?? DEFAULT_CHECK_REF_PATTERN,
    allowWrites,
    allowDestructive: pick('allowDestructive') ?? false,
    secretValues: pick('secretValues') ?? [],
    maxActionsPerSession: pick('maxActionsPerSession') ?? 200,
    maxSessionMs: pick('maxSessionMs') ?? 10 * 60_000,
    enabledTools: pick('enabledTools'),
    environment: pick('environment') ?? 'default',
    gridSelector: pick('gridSelector') ?? 'table, [role="grid"]',
    modalPickModes: pick('modalPickModes') ?? DEFAULT_MODAL_PICK_MODES,
    auditRoot: pick('auditRoot') ?? path.resolve('evidence'),
    idleTimeoutMs: pick('idleTimeoutMs') ?? 10 * 60_000,
  };
}

export interface UiMcpServerHandle<Mode extends string = string, D extends UiDriver = UiDriver> {
  server: McpServer;
  session: UiMcpSession<Mode, D>;
  policy: UiPolicy;
  setup: ResolvedUiMcpSetup<Mode, D>;
}

/** Builds the server with its tools registered, not yet connected to a transport. */
export function createUiMcpServer<Mode extends string, D extends UiDriver>(setup: ResolvedUiMcpSetup<Mode, D>): UiMcpServerHandle<Mode, D> {
  const policy = new UiPolicy({
    web: setup.web,
    enabledTools: setup.enabledTools,
    allowWrites: setup.allowWrites,
    allowDestructive: setup.allowDestructive,
    maxActionsPerSession: setup.maxActionsPerSession,
    maxSessionMs: setup.maxSessionMs,
    secretValues: setup.secretValues,
    destructiveLabel: setup.destructiveLabel,
    text: setup.text.deny,
  });
  const session = new UiMcpSession<Mode, D>({
    openRuntime: setup.openRuntime,
    allowWrites: policy.allowWrites,
    auditRoot: setup.auditRoot,
    noSessionMessage: setup.text.errors.noSession,
  });
  const server = new McpServer({ name: setup.serverName, version: setup.serverVersion });
  registerUiTools(server, {
    session,
    policy,
    text: setup.text,
    schemas: createUiToolSchemas({
      fields: setup.text.fields,
      checkRefPattern: setup.checkRefPattern,
      authModes: setup.authModes,
      defaultAuthMode: setup.defaultAuthMode,
      modalPickModes: setup.modalPickModes,
    }),
    writeRun: setup.writeRun,
    environment: setup.environment,
    gridSelector: setup.gridSelector,
  });
  return { server, session, policy, setup };
}

/**
 * Connects the server to stdio and owns process hygiene.
 *
 * A stdio server launched through a shell wrapper cannot reliably reap a grandchild browser when
 * the client disconnects, so every disconnect would leak a browser plus its crash handler. Three
 * independent nets close the session: SIGTERM/SIGINT, stdin EOF (the reliable disconnect signal
 * for stdio transports), and an idle timeout. Register the server with `node` as the command
 * rather than a shell, so there is no intermediate process to orphan the tree.
 */
export async function serveUiMcpOverStdio<Mode extends string, D extends UiDriver>(
  handle: UiMcpServerHandle<Mode, D>,
  logger: Logger,
): Promise<void> {
  const { session, policy, setup } = handle;

  let closing = false;
  const shutdown = async (why: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info(`Shutting down (${why}) — closing browser session.`);
    // Not passed: keep trace and video, since an abrupt shutdown is exactly when they help.
    await session.close(false).catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.stdin.on('close', () => void shutdown('stdin closed'));
  process.stdin.on('end', () => void shutdown('stdin ended'));

  const idleTimer = setInterval(() => {
    if (session.isOpen && session.idleMs > setup.idleTimeoutMs) {
      logger.warn(`Session idle for ${Math.round(session.idleMs / 1000)}s — closing browser to avoid a leak.`);
      void session.close(false).catch(() => undefined);
    }
  }, 30_000);
  idleTimer.unref();

  logger.info(`${setup.serverName} ready — target ${setup.web.baseUrl}, writes ${policy.allowWrites ? 'ENABLED' : 'blocked'}.`);
  await handle.server.connect(new StdioServerTransport());
}
