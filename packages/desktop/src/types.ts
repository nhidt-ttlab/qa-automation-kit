/**
 * The slice of WebdriverIO the desktop driver uses. A `WebdriverIO.Browser` from `@wdio/electron-service`'s
 * `startWdioSession` satisfies it; tests pass a fake.
 */
export interface DesktopElement {
  click(): Promise<unknown>;
  setValue(value: string): Promise<unknown>;
  clearValue(): Promise<unknown>;
  getText(): Promise<string>;
  getValue(): Promise<string>;
  getTagName(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  /** WebDriver's computed ARIA role (`GET /element/:id/computedrole`). */
  getComputedRole(): Promise<string>;
  isDisplayed(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  $$(selector: string): PromiseLike<ArrayLike<DesktopElement>>;
}

export interface DesktopBrowser {
  $$(selector: string): PromiseLike<ArrayLike<DesktopElement>>;
  keys(value: string | string[]): Promise<unknown>;
  getTitle(): Promise<string>;
  getUrl(): Promise<string>;
  /** Base64 PNG of the current window. */
  takeScreenshot(): Promise<string>;
  getWindowHandles(): Promise<string[]>;
  switchToWindow(handle: string): Promise<unknown>;
  /** Runs in the renderer of the current window. */
  execute<T>(script: string | ((...args: never[]) => T), ...args: unknown[]): Promise<T>;
  electron: {
    /** Runs in the Electron main process; the first argument is the `electron` module. */
    execute<T>(script: string | ((electron: never, ...args: never[]) => T), ...args: unknown[]): Promise<T>;
  };
}

/** The `desktop` block of the config, resolved: absolute paths, values read from the environment. */
export interface DesktopTarget {
  framework: 'electron';
  appBinaryPath?: string;
  appEntryPoint?: string;
  /** Absolute folder WebdriverIO reads the app's `package.json` and Electron version from. */
  appRoot: string;
  appArgs: string[];
  /** A chromedriver to use instead of downloading one. */
  chromedriverPath?: string;
  env: Record<string, string>;
  timeoutMs: number;
  captureLogs: boolean;
}
