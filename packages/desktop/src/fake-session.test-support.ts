import type { DesktopBrowser, DesktopElement } from './types.js';

export interface FakeElementInit {
  tag?: string;
  text?: string;
  value?: string;
  role?: string;
  attributes?: Record<string, string>;
  displayed?: boolean;
  enabled?: boolean;
  children?: Record<string, FakeElement[]>;
}

/** An element whose answers are fixed up front; records what was done to it. */
export class FakeElement implements DesktopElement {
  readonly actions: string[] = [];
  constructor(private readonly init: FakeElementInit = {}) {}
  async click() {
    this.actions.push('click');
  }
  async setValue(value: string) {
    this.actions.push(`setValue:${value}`);
  }
  async clearValue() {
    this.actions.push('clearValue');
  }
  async getText() {
    return this.init.text ?? '';
  }
  async getValue() {
    return this.init.value ?? '';
  }
  async getTagName() {
    return this.init.tag ?? 'div';
  }
  async getAttribute(name: string) {
    return this.init.attributes?.[name] ?? null;
  }
  async getComputedRole() {
    return this.init.role ?? 'generic';
  }
  async isDisplayed() {
    return this.init.displayed ?? true;
  }
  async isEnabled() {
    return this.init.enabled ?? true;
  }
  async $$(selector: string) {
    return this.init.children?.[selector] ?? [];
  }
}

/** A session that answers `$$` from a selector → elements map; selectors not in it match nothing. */
export class FakeBrowser implements DesktopBrowser {
  readonly keysSent: Array<string | string[]> = [];
  readonly queried: string[] = [];
  mainCalls: unknown[][] = [];
  windows: Array<{ handle: string; title: string; url: string }> = [{ handle: 'w1', title: 'Main', url: 'file:///app/index.html' }];
  private current = 'w1';

  constructor(public dom: Record<string, FakeElement[]> = {}) {}

  async $$(selector: string) {
    this.queried.push(selector);
    return this.dom[selector] ?? [];
  }
  async keys(value: string | string[]) {
    this.keysSent.push(value);
  }
  async getTitle() {
    return this.windows.find((w) => w.handle === this.current)?.title ?? '';
  }
  async getUrl() {
    return this.windows.find((w) => w.handle === this.current)?.url ?? '';
  }
  async takeScreenshot() {
    return Buffer.from('png-bytes').toString('base64');
  }
  async getWindowHandles() {
    return this.windows.map((w) => w.handle);
  }
  async switchToWindow(handle: string) {
    this.current = handle;
  }
  async execute<T>(): Promise<T> {
    return undefined as T;
  }
  electron = {
    execute: async <T>(script: unknown, ...args: unknown[]): Promise<T> => {
      this.mainCalls.push([script, ...args]);
      return (typeof script === 'function' ? (script as (e: unknown, ...a: unknown[]) => T)({ app: { getName: () => 'fake-app' } }, ...args) : undefined) as T;
    },
  };
}
