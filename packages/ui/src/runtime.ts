import fs from 'node:fs';
import type { Browser, BrowserContext, BrowserType, Page } from 'playwright';
import type { EvidenceStore, Logger, RequestTraceEntry } from '@qakit/core';
import { BlockedRequestRegistry } from './blocked-registry.js';
import { DiagnosticsCollector } from './diagnostics.js';
import { UiDriver, type UiDriverOptions, type UiDriverText } from './driver.js';
import { installGuards } from './guards.js';
import { BrowserNetworkRecorder } from './network-recorder.js';
import type { WebTarget } from './types.js';
import type { UiWidgets } from './widgets.js';

/** Keep an artifact always, never, or only when the run did not pass. */
export type RetainPolicy = 'on' | 'off' | 'retain-on-failure';

export function parseRetainPolicy(raw: string | undefined, fallback: RetainPolicy): RetainPolicy {
  return raw === 'on' || raw === 'off' || raw === 'retain-on-failure' ? raw : fallback;
}

/** Evidence captions the runtime registers. */
export interface BrowserRuntimeText {
  trace: string;
  har: string;
  video: string;
  console: string;
}

export const englishBrowserRuntimeText: BrowserRuntimeText = {
  trace: 'Playwright trace',
  har: 'Full network HAR',
  video: 'Session video',
  console: 'Console, page errors and blocked requests',
};

/** The project's sign-in flow, in two halves around page creation. */
export interface BrowserAuthHooks<Mode extends string, D extends UiDriver> {
  /** After the context exists and tracing has started, before the first page — e.g. seed storage. */
  beforePage?(context: BrowserContext, mode: Mode): Promise<void>;
  /** Once the driver exists — e.g. open the app, verify the session, fall back to a form login. */
  afterPage?(driver: D, page: Page, mode: Mode): Promise<void>;
}

export type DriverBaseOptions = Omit<UiDriverOptions, 'widgets' | 'text'>;

export interface CreateBrowserRuntimeOptions<Mode extends string = string, D extends UiDriver = UiDriver> {
  /** e.g. `chromium` from `playwright` — injected, so the kit needs no browser dependency of its own. */
  browserType: BrowserType;
  /**
   * Playwright launch `channel` (`chrome`, `msedge`): the installed branded browser instead of the bundled build.
   * Set from `QAKIT_UI_BROWSER` by `openProjectBrowser`; undefined launches `browserType` as is.
   */
  channel?: string;
  /** Name written to the evidence manifest (`browser.name`); defaults to `browserType.name()`. */
  browserName?: string;
  web: WebTarget;
  evidence: EvidenceStore;
  logger: Pick<Logger, 'warn'>;
  /** Auth mode used when `ui()` is called without one. */
  defaultAuthMode: Mode;
  auth?: BrowserAuthHooks<Mode, D>;
  /** Builds the driver. Defaults to a `UiDriver` over `widgets` and `driverText`. */
  createDriver?(options: DriverBaseOptions): D;
  widgets?: UiWidgets;
  driverText?: UiDriverText;
  text?: BrowserRuntimeText;
  headless?: boolean;
  slowMoMs?: number;
  timeoutMs?: number;
  tracePolicy?: RetainPolicy;
  videoPolicy?: RetainPolicy;
  /** `off`, `on` (headers and timings), or `full` (bodies embedded — for contract tracing; large). */
  harMode?: string;
  /** Opt in to mutations. Off by default — see `installGuards`. */
  allowWrites?: boolean;
  /** Used when `web.viewport` is not set. */
  defaultViewport?: { width: number; height: number };
  /** Recorded in the evidence manifest when console capture is known to be unreliable. */
  consoleCaptureNote?: string;
}

export interface BrowserLaunchOptions<Mode extends string = string> {
  authMode?: Mode;
  /** Read-only POST lookups this scenario needs to go through. See `GuardOptions.postLookups`. */
  postLookups?: string[];
}

export interface BrowserRuntime<Mode extends string = string, D extends UiDriver = UiDriver> {
  /**
   * Lazily launches the browser on first call, so an API-checkable precondition costs nothing.
   * Options are read on that first call only; later calls return the same driver.
   */
  ui(options?: BrowserLaunchOptions<Mode>): Promise<D>;
  networkTrace(): RequestTraceEntry[];
  /** Flushes trace/video/HAR, console diagnostics and the manifest. Never throws. */
  close(passed: boolean): Promise<void>;
  evidenceDirDisplay(): string;
}

/**
 * Owns the browser for one deterministic scenario run: a clean context (fresh storage, known
 * viewport, tracing from step 0), the route guards, diagnostics and network recording, and an
 * evidence flush on close that never leaves a browser process behind.
 */
export function createBrowserRuntime<Mode extends string = string, D extends UiDriver = UiDriver>(
  options: CreateBrowserRuntimeOptions<Mode, D>,
): BrowserRuntime<Mode, D> {
  const { web, evidence, logger } = options;
  const text = options.text ?? englishBrowserRuntimeText;

  const blocked = new BlockedRequestRegistry();
  const diagnostics = new DiagnosticsCollector(blocked);
  const network = new BrowserNetworkRecorder(blocked);

  const tracePolicy = options.tracePolicy ?? 'retain-on-failure';
  const videoPolicy = options.videoPolicy ?? 'retain-on-failure';
  const harMode = options.harMode ?? 'on';
  const harEnabled = harMode !== 'off';
  const headless = options.headless ?? true;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const allowWrites = options.allowWrites ?? false;

  const createDriver =
    options.createDriver ??
    ((base: DriverBaseOptions): D => {
      if (!options.widgets) throw new Error('createBrowserRuntime needs either `widgets` or `createDriver`.');
      return new UiDriver({ ...base, widgets: options.widgets, text: options.driverText }) as D;
    });

  let browser: Browser | undefined;
  let browserVersion: string | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let harPath: string | undefined;
  let videoDir: string | undefined;

  const launch = async (authMode: Mode, postLookups: string[]): Promise<D> => {
    browser = await options.browserType.launch({ headless, slowMo: options.slowMoMs, channel: options.channel });
    // Read now: the manifest is written after `browser.close()`, when `version()` is no longer answerable.
    browserVersion = browser.version();

    harPath = harEnabled ? evidence.reserve('network_har', 'network.har') : undefined;
    videoDir = videoPolicy === 'off' ? undefined : evidence.reserve('video', '.');

    context = await browser.newContext({
      viewport: web.viewport ?? options.defaultViewport ?? { width: 1920, height: 1200 },
      recordHar: harPath ? { path: harPath, content: harMode === 'full' ? 'embed' : 'omit' } : undefined,
      recordVideo: videoDir ? { dir: videoDir } : undefined,
      ignoreHTTPSErrors: false,
    });
    context.setDefaultTimeout(timeoutMs);

    await installGuards(context, { web, allowWrites, postLookups, blocked });

    if (tracePolicy !== 'off') {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    }

    await options.auth?.beforePage?.(context, authMode);

    page = await context.newPage();
    diagnostics.attach(page);
    network.attach(page);

    const driver = createDriver({ page, webBaseUrl: web.baseUrl, evidence, diagnostics, network, defaultTimeoutMs: timeoutMs });

    await options.auth?.afterPage?.(driver, page, authMode);
    return driver;
  };

  let pending: Promise<D> | undefined;

  return {
    ui: (launchOptions) => {
      if (!pending) pending = launch(launchOptions?.authMode ?? options.defaultAuthMode, launchOptions?.postLookups ?? []);
      return pending;
    },
    networkTrace: () => network.trace(),
    evidenceDirDisplay: () => evidence.displayDir,
    close: async (passed: boolean) => {
      // Teardown must never turn a finished run into a failure, or mask the verdict it produced.
      try {
        if (!browser) return;

        if (context && tracePolicy !== 'off') {
          const keepTrace = tracePolicy === 'on' || !passed;
          const tracePath = evidence.reserve('trace_zip', 'trace.zip');
          await context.tracing.stop({ path: tracePath });
          if (keepTrace) evidence.register('trace_zip', tracePath, text.trace);
          else fs.rmSync(tracePath, { force: true });
        }

        const videoFile = page?.video();
        await context?.close();
        await browser.close();
        browser = undefined;

        if (harPath) evidence.register('network_har', harPath, text.har);

        if (videoFile && videoDir) {
          const keepVideo = videoPolicy === 'on' || !passed;
          const savedPath = await videoFile.path().catch(() => undefined);
          if (savedPath && keepVideo) evidence.register('video', savedPath, text.video);
          else if (savedPath) fs.rmSync(savedPath, { force: true });
        }

        const snapshot = diagnostics.snapshot();
        evidence.writeAndRegister('console_log', 'console.json', `${JSON.stringify(snapshot, null, 2)}\n`, text.console);

        const browserName = options.browserName ?? options.browserType.name();
        evidence.writeManifest({
          browser: { name: browserName, version: browserVersion ?? browserName },
          diagnosticsSummary: {
            pageErrors: snapshot.pageErrors.length,
            consoleErrors: snapshot.consoleErrors.length,
            failedRequests: snapshot.failedRequests.length,
            blockedRequests: snapshot.blockedRequests.length,
          },
          consoleCaptureNote: options.consoleCaptureNote,
        });
      } catch (error) {
        logger.warn(`UI teardown failed (run result unaffected): ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        // Never leave a browser behind, even if the tidy path above threw.
        if (browser) await browser.close().catch(() => undefined);
      }
    },
  };
}
