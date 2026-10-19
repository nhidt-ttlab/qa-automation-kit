import type { EvidenceItemMeta, EvidenceStore } from '@qakit/core';
import { describeLocator, parseLocatorSpec, type LocatorSpec, type UiStepRecord } from '@qakit/ui';
import { countDesktopMatches, resolveDesktopLocator } from './locator.js';
import type { DesktopBrowser, DesktopElement } from './types.js';

/** Step titles the desktop driver records when a caller passes none — the report language of the run. */
export interface DesktopDriverText {
  click(target: string): string;
  fill(value: string, target: string): string;
  press(key: string): string;
  readText(target: string): string;
  readValue(target: string): string;
  readControlState(target: string): string;
  countMatching(target: string): string;
  waitForText(text: string): string;
  switchWindow(match: string): string;
  executeMain: string;
  screenshot(caption: string): string;
  failureScreenshot: string;
}

export const englishDesktopDriverText: DesktopDriverText = {
  click: (target) => `Click ${target}`,
  fill: (value, target) => `Type "${value}" into ${target}`,
  press: (key) => `Press ${key}`,
  readText: (target) => `Read text of ${target}`,
  readValue: (target) => `Read value of ${target}`,
  readControlState: (target) => `Read control state of ${target}`,
  countMatching: (target) => `Count elements matching ${target}`,
  waitForText: (text) => `Wait for "${text}"`,
  switchWindow: (match) => `Switch to window ${match}`,
  executeMain: 'Run code in the main process',
  screenshot: (caption) => `Screenshot: ${caption}`,
  failureScreenshot: 'Window at the failed step',
};

/** A step-doc target: the canonical string form (`id=…`, `role=button[name="…"]`, `a >> b`) or a spec. */
export type DesktopTargetSpec = LocatorSpec | string;

/** What `readControlState` reports. Absent is `visible: false, disabled: false` — not there is not disabled. */
export interface DesktopControlState {
  visible: boolean;
  disabled: boolean;
  text: string;
}

export interface DesktopDriverOptions {
  browser: DesktopBrowser;
  evidence: EvidenceStore;
  text?: DesktopDriverText;
  defaultTimeoutMs?: number;
  /** Values never written into step titles or data (secrets typed into the app). */
  redact?: readonly string[];
}

/**
 * The `electron` module as `executeMain` hands it over. Typed loosely so the kit and the project need no `electron`
 * types; annotate the parameter with `typeof import('electron')` in a project that has them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElectronModule = any;

const toSpec = (target: DesktopTargetSpec): LocatorSpec => (typeof target === 'string' ? parseLocatorSpec(target) : target);

/**
 * The scenario-facing API for one desktop application window, over a WebdriverIO session.
 *
 * Every method records exactly one `UiStepRecord`, the same shape the browser lane records, so the report writer and
 * the run store take desktop steps as they are. A failed step also captures the window, best effort. `browser` is the
 * raw WebdriverIO session for anything this API does not cover (`browser.electron.mock`, multi-window work).
 */
export class DesktopDriver {
  private readonly steps: UiStepRecord[] = [];
  private readonly text: DesktopDriverText;
  private readonly timeout: number;
  private screenshots = 0;

  constructor(private readonly options: DesktopDriverOptions) {
    this.text = options.text ?? englishDesktopDriverText;
    this.timeout = options.defaultTimeoutMs ?? 30_000;
  }

  get browser(): DesktopBrowser {
    return this.options.browser;
  }

  recordedSteps(): UiStepRecord[] {
    return [...this.steps];
  }

  /** Records a custom step around `action`, with timing and a failure screenshot. Rethrows the action's error. */
  async step<T>(title: string, action: () => Promise<T>): Promise<T> {
    return this.run(title, async () => ({ value: await action() }));
  }

  async click(target: DesktopTargetSpec, title?: string): Promise<void> {
    const spec = toSpec(target);
    await this.located(title ?? this.text.click(describeLocator(spec)), spec, async (element) => {
      await element.click();
    });
  }

  /** Replaces the control's value. */
  async fill(target: DesktopTargetSpec, value: string, title?: string): Promise<void> {
    const spec = toSpec(target);
    await this.located(title ?? this.text.fill(value, describeLocator(spec)), spec, async (element) => {
      await element.clearValue();
      await element.setValue(value);
    });
  }

  /** Sends keys to the focused element, e.g. `Enter` or `['Control', 'a']`. */
  async press(key: string | string[], title?: string): Promise<void> {
    const name = Array.isArray(key) ? key.join('+') : key;
    await this.step(title ?? this.text.press(name), async () => {
      await this.browser.keys(key);
    });
  }

  async readText(target: DesktopTargetSpec, title?: string): Promise<string> {
    const spec = toSpec(target);
    return this.located(title ?? this.text.readText(describeLocator(spec)), spec, async (element) => (await element.getText()).trim(), true);
  }

  async readValue(target: DesktopTargetSpec, title?: string): Promise<string> {
    const spec = toSpec(target);
    return this.located(title ?? this.text.readValue(describeLocator(spec)), spec, (element) => element.getValue(), true);
  }

  /** Visible, disabled and text of a control that may legitimately be absent — absence is an answer, not a failure. */
  async readControlState(target: DesktopTargetSpec, title?: string): Promise<DesktopControlState> {
    const spec = toSpec(target);
    return this.run(
      title ?? this.text.readControlState(describeLocator(spec)),
      async () => {
        if ((await countDesktopMatches(this.browser, spec)) === 0) return { value: { visible: false, disabled: false, text: '' }, data: { matched: 0 } };
        const { element, resolved } = await resolveDesktopLocator(this.browser, spec, 0);
        const visible = await element.isDisplayed();
        const state = { visible, disabled: visible ? !(await element.isEnabled()) || (await element.getAttribute('aria-disabled')) === 'true' : false, text: visible ? (await element.getText()).trim() : '' };
        return { value: state, data: { locator: { spec, resolvedBy: resolved.strategy, matched: resolved.matched }, state } };
      },
    );
  }

  async countMatching(target: DesktopTargetSpec, title?: string): Promise<number> {
    const spec = toSpec(target);
    return this.run(
      title ?? this.text.countMatching(describeLocator(spec)),
      async () => {
        const count = await countDesktopMatches(this.browser, spec);
        return { value: count, data: { count } };
      },
    );
  }

  /** Waits until an element whose own text is exactly `text` exists. */
  async waitForText(text: string, timeoutMs = this.timeout, title?: string): Promise<void> {
    await this.step(title ?? this.text.waitForText(text), async () => {
      await resolveDesktopLocator(this.browser, { text, nth: 0 }, timeoutMs);
    });
  }

  /** Makes the first window whose title or URL contains `match` (or matches the pattern) the current one. */
  async switchWindow(match: string | RegExp, title?: string): Promise<void> {
    await this.step(title ?? this.text.switchWindow(String(match)), async () => {
      const test = (value: string): boolean => (typeof match === 'string' ? value.includes(match) : match.test(value));
      const deadline = Date.now() + this.timeout;
      for (;;) {
        for (const handle of await this.browser.getWindowHandles()) {
          await this.browser.switchToWindow(handle);
          if (test(await this.browser.getTitle()) || test(await this.browser.getUrl())) return;
        }
        if (Date.now() >= deadline) throw new Error(`No window title or URL matches ${String(match)}.`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    });
  }

  /**
   * Runs `script` in the Electron main process (`browser.electron.execute`); its first argument is the `electron`
   * module. Needs the app's `EnableNodeCliInspectArguments` fuse on, which development builds have.
   */
  async executeMain<T, A extends unknown[]>(script: ((electron: ElectronModule, ...args: A) => T) | string, ...args: A): Promise<Awaited<T>> {
    return this.step(this.text.executeMain, () => this.browser.electron.execute<Awaited<T>>(script as never, ...args));
  }

  /** Captures the current window as evidence and records a step for it. Returns the evidence path. */
  async screenshot(caption: string, meta: EvidenceItemMeta = {}): Promise<string | undefined> {
    return this.run(
      this.text.screenshot(caption),
      async () => {
        const relPath = await this.captureWindow(caption, { stepIndex: this.steps.length, ...meta });
        return { value: relPath, data: { evidence: relPath ? [relPath] : [] } };
      },
    );
  }

  private async run<T>(title: string, action: () => Promise<{ value: T; data?: Record<string, unknown> }>): Promise<T> {
    const startedAt = Date.now();
    const safeTitle = this.redact(title);
    try {
      const { value, data } = await action();
      this.steps.push({ title: safeTitle, ok: true, data: { url: await this.currentUrl(), durationMs: Date.now() - startedAt, ...data } });
      return value;
    } catch (error) {
      const message = this.redact(error instanceof Error ? error.message : String(error));
      const evidence = await this.captureWindow(this.text.failureScreenshot, { stepIndex: this.steps.length }).catch(() => undefined);
      this.steps.push({
        title: safeTitle,
        ok: false,
        data: { url: await this.currentUrl(), durationMs: Date.now() - startedAt, error: message, evidence: evidence ? [evidence] : undefined },
      });
      throw error;
    }
  }

  private async located<T>(title: string, spec: LocatorSpec, act: (element: DesktopElement) => Promise<T>, returnsValue = false): Promise<T> {
    return this.run(
      title,
      async () => {
        const { element, resolved } = await resolveDesktopLocator(this.browser, spec, this.timeout);
        const value = await act(element);
        return { value, data: { locator: { spec, resolvedBy: resolved.strategy, matched: resolved.matched }, ...(returnsValue ? { value: this.redact(String(value)) } : {}) } };
      },
    );
  }

  private async captureWindow(caption: string, meta: EvidenceItemMeta): Promise<string | undefined> {
    this.screenshots += 1;
    const png = Buffer.from(await this.browser.takeScreenshot(), 'base64');
    const item = this.options.evidence.writeAndRegister('screenshot', `desktop-${String(this.screenshots).padStart(2, '0')}.png`, png, caption, meta);
    return item?.relPath;
  }

  private async currentUrl(): Promise<string | undefined> {
    return this.browser.getUrl().catch(() => undefined);
  }

  private redact(text: string): string {
    let out = text;
    for (const secret of this.options.redact ?? []) if (secret) out = out.split(secret).join('***');
    return out;
  }
}
