import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { EvidenceStore, Logger } from '@qakit/core';
import { DesktopDriver, type DesktopDriverText } from './driver.js';
import { describeDesktopTarget } from './target.js';
import type { DesktopBrowser, DesktopTarget } from './types.js';

/** A started app: the WebdriverIO session and how to end it. */
export interface DesktopSession {
  browser: DesktopBrowser;
  /** Electron's version, or its Chromium's, as the session reports it. */
  version?: string;
  close(): Promise<void>;
}

export interface DesktopLaunchOptions {
  /** Where the service writes the main and renderer process logs, when `captureLogs` is on. */
  logDir?: string;
}

export type DesktopLauncher = (target: DesktopTarget, options: DesktopLaunchOptions) => Promise<DesktopSession>;

/**
 * Variables removed from the environment the app starts with. A VS Code terminal exports `ELECTRON_RUN_AS_NODE=1`,
 * which makes Electron start as plain Node: no `app`, no window, and a session that never connects.
 */
const STRIPPED_ENV = ['ELECTRON_RUN_AS_NODE'];

/**
 * Applies the app's environment to this process for the duration of a launch — chromedriver and the app inherit it —
 * and returns a function that puts the previous values back.
 */
export function applyLaunchEnv(extra: Record<string, string>, env: NodeJS.ProcessEnv = process.env): () => void {
  const previous = new Map<string, string | undefined>();
  const set = (name: string, value: string | undefined): void => {
    if (!previous.has(name)) previous.set(name, env[name]);
    if (value === undefined) delete env[name];
    else env[name] = value;
  };
  for (const name of STRIPPED_ENV) set(name, undefined);
  for (const [name, value] of Object.entries(extra)) set(name, value);
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  };
}

/**
 * WebdriverIO logs every command at info by default, which would bury the suite's own output. Its `webdriver` package
 * reads `WDIO_LOG_LEVEL` once, when it is first imported, so this must run before that import. A level the user set wins.
 */
export function quietWebdriverLogs(env: NodeJS.ProcessEnv = process.env): void {
  env.WDIO_LOG_LEVEL ??= 'warn';
}

/** The `@wdio/electron-service` capability for a target. */
export function electronCapability(target: DesktopTarget, options: DesktopLaunchOptions = {}): Record<string, unknown> {
  const logs = target.captureLogs && options.logDir !== undefined;
  return {
    browserName: 'electron',
    // The service leaves chromedriver options it is given alone, so a binary here skips the download.
    ...(target.chromedriverPath ? { 'wdio:chromedriverOptions': { binary: target.chromedriverPath } } : {}),
    'wdio:electronServiceOptions': {
      ...(target.appBinaryPath ? { appBinaryPath: target.appBinaryPath } : {}),
      ...(target.appEntryPoint && !target.appBinaryPath ? { appEntryPoint: target.appEntryPoint } : {}),
      appArgs: target.appArgs,
      ...(logs ? { captureMainProcessLogs: true, captureRendererLogs: true, logDir: options.logDir } : {}),
    },
  };
}

/** Whether `@wdio/electron-service` (and with it webdriverio) can be loaded here, without launching anything. */
export async function desktopDriverInstalled(): Promise<{ ok: boolean; detail: string }> {
  try {
    await import('@wdio/electron-service');
    return { ok: true, detail: '@wdio/electron-service and webdriverio installed' };
  } catch (error) {
    const reason = error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? '') : String(error);
    return { ok: false, detail: `@wdio/electron-service is not installed (npm i -D @wdio/electron-service webdriverio): ${reason}` };
  }
}

/**
 * Starts the app through `@wdio/electron-service` in standalone mode (no WDIO test runner): the service finds the
 * Electron version, fetches the matching chromedriver and opens a session on the app's first window.
 */
export const launchElectronSession: DesktopLauncher = async (target, options) => {
  quietWebdriverLogs();
  let service: typeof import('@wdio/electron-service');
  try {
    service = await import('@wdio/electron-service');
  } catch (error) {
    throw new Error(
      `Desktop sessions need @wdio/electron-service and webdriverio — install them in the project (npm i -D @wdio/electron-service webdriverio). ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const restore = applyLaunchEnv(target.env);
  let browser: WebdriverIO.Browser;
  try {
    browser = await service.startWdioSession([electronCapability(target, options) as never], { rootDir: target.appRoot });
  } finally {
    restore();
  }
  const caps = browser.capabilities as { browserVersion?: string };
  // Read now: an app that hides to the tray when its window closes outlives the WebDriver session.
  const appPid = await browser.electron.execute(() => process.pid).catch(() => undefined);
  return {
    browser: browser as unknown as DesktopBrowser,
    version: caps.browserVersion,
    close: async () => {
      try {
        await service.cleanupWdioSession(browser);
      } finally {
        if (typeof appPid === 'number') killProcessTree(appPid);
      }
    },
  };
};

/** Ends a process and its children if it is still running. Best effort: an already-exited process is not an error. */
export function killProcessTree(pid: number): void {
  try {
    process.kill(pid, 0);
  } catch {
    return;
  }
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid, 'SIGTERM');
  } catch {
    // Gone between the check and the kill.
  }
}

/** Evidence captions the runtime registers. */
export interface DesktopRuntimeText {
  finalScreenshot: string;
  appLog: string;
}

export const englishDesktopRuntimeText: DesktopRuntimeText = {
  finalScreenshot: 'Application window at the end of the run',
  appLog: 'Electron main and renderer process log',
};

export interface CreateDesktopRuntimeOptions {
  target: DesktopTarget;
  evidence: EvidenceStore;
  logger: Pick<Logger, 'warn'>;
  /** Defaults to `launchElectronSession`; tests inject a fake. */
  launch?: DesktopLauncher;
  driverText?: DesktopDriverText;
  text?: DesktopRuntimeText;
  /** Values never written into step titles (secrets a scenario types into the app). */
  redact?: readonly string[];
  /** Keep the final window screenshot on a passing run too. Off by default, like trace and video in the browser lane. */
  screenshotOnPass?: boolean;
}

export interface DesktopRuntime {
  /** Launches the app on first call; later calls return the same driver. */
  app(): Promise<DesktopDriver>;
  /** Final screenshot (on failure), process logs and the manifest, then quits the app. Never throws. */
  close(passed: boolean): Promise<void>;
  evidenceDirDisplay(): string;
}

/** Owns the desktop app for one scenario run: a lazy launch, evidence, and a close that never leaves the app running. */
export function createDesktopRuntime(options: CreateDesktopRuntimeOptions): DesktopRuntime {
  const { target, evidence, logger } = options;
  const text = options.text ?? englishDesktopRuntimeText;
  const launch = options.launch ?? launchElectronSession;
  const logDir = target.captureLogs ? path.join(evidence.dir, 'app-logs') : undefined;

  let session: DesktopSession | undefined;
  let pending: Promise<DesktopDriver> | undefined;

  const start = async (): Promise<DesktopDriver> => {
    if (logDir) fs.mkdirSync(logDir, { recursive: true });
    try {
      session = await launch(target, { logDir });
    } catch (error) {
      throw new Error(`Could not start the desktop app (${describeDesktopTarget(target)}): ${error instanceof Error ? error.message : String(error)}`);
    }
    return new DesktopDriver({ browser: session.browser, evidence, text: options.driverText, defaultTimeoutMs: target.timeoutMs, redact: options.redact });
  };

  return {
    app: () => (pending ??= start()),
    evidenceDirDisplay: () => evidence.displayDir,
    close: async (passed) => {
      if (!session) return;
      try {
        if (!passed || options.screenshotOnPass) {
          const png = await session.browser.takeScreenshot().catch(() => undefined);
          if (png) evidence.writeAndRegister('screenshot', 'desktop-final.png', Buffer.from(png, 'base64'), text.finalScreenshot);
        }
      } catch (error) {
        logger.warn(`Desktop teardown screenshot failed (run result unaffected): ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        await session.close();
      } catch (error) {
        logger.warn(`Desktop app did not close cleanly (run result unaffected): ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        if (logDir && fs.existsSync(logDir)) {
          for (const name of fs.readdirSync(logDir)) evidence.register('console_log', path.join(logDir, name), `${text.appLog} (${name})`);
        }
        evidence.writeManifest({
          browser: { name: target.framework, version: session.version ?? target.framework },
          diagnosticsSummary: { pageErrors: 0, consoleErrors: 0, failedRequests: 0, blockedRequests: 0 },
          consoleCaptureNote: 'Desktop run: diagnostics are in the captured process logs, not counted here.',
        });
      } catch (error) {
        logger.warn(`Desktop evidence flush failed (run result unaffected): ${error instanceof Error ? error.message : String(error)}`);
      }
      session = undefined;
    },
  };
}
