import type { Locator, Page } from 'playwright';
import type { EvidenceStore, RequestTraceEntry } from '@qakit/core';
import type { DiagnosticsCollector } from './diagnostics.js';
import { buildLocator, describeLocator, resolveLocator } from './locator.js';
import type { BrowserNetworkRecorder } from './network-recorder.js';
import type { GridSnapshot, LocatorSpec, UiDiagnostics, UiStepRecord } from './types.js';
import type { EditGridCellOptions, FeedbackOptions, GridCellEditResult, PickInModalOptions, ReadGridOptions, UiWidgets } from './widgets.js';

/** Step titles the driver records when a caller passes none — the report language of the run. */
export interface UiDriverText {
  goto(pathname: string): string;
  click(target: string): string;
  fill(value: string, target: string): string;
  press(key: string, target: string): string;
  selectOption(optionText: string, target: string): string;
  switchTab(tabLabel: string): string;
  gotoPage(pageNumber: number): string;
  readText(target: string): string;
  readSelectValue(target: string): string;
  countMatching(target: string): string;
  readControlState(target: string): string;
  /** `keyword` is undefined when the first row is picked. */
  pickInModal(keyword: string | undefined): string;
  confirmModal(label: string): string;
  closeModal: string;
  readGrid(columns: readonly string[]): string;
  editGridCell(value: string, column: string, rowNumber: number): string;
  /** The label `confirmModal` clicks when none is given. */
  defaultConfirmLabel: string;
}

export const englishUiDriverText: UiDriverText = {
  goto: (pathname) => `Open screen ${pathname}`,
  click: (target) => `Click ${target}`,
  fill: (value, target) => `Type "${value}" into ${target}`,
  press: (key, target) => `Press ${key} in ${target}`,
  selectOption: (optionText, target) => `Select "${optionText}" in ${target}`,
  switchTab: (tabLabel) => `Switch to tab "${tabLabel}"`,
  gotoPage: (pageNumber) => `Go to page ${pageNumber}`,
  readText: (target) => `Read text of ${target}`,
  readSelectValue: (target) => `Read selected value of ${target}`,
  countMatching: (target) => `Count elements matching ${target}`,
  readControlState: (target) => `Read control state of ${target}`,
  pickInModal: (keyword) => `Pick ${keyword ? `"${keyword}"` : 'the first row'} in the dialog`,
  confirmModal: (label) => `Click "${label}" in the dialog`,
  closeModal: 'Close the dialog if open',
  readGrid: (columns) => `Read grid (${columns.join(', ')})`,
  editGridCell: (value, column, rowNumber) => `Type "${value}" into cell ${column}, row ${rowNumber}`,
  defaultConfirmLabel: 'OK',
};

export interface UiDriverOptions {
  page: Page;
  webBaseUrl: string;
  evidence: EvidenceStore;
  diagnostics: DiagnosticsCollector;
  network: BrowserNetworkRecorder;
  widgets: UiWidgets;
  text?: UiDriverText;
  defaultTimeoutMs?: number;
}

/** What `readControlState` reports. `visible: false` yields `disabled: false` — absent is not disabled. */
export interface ControlState {
  disabled: boolean;
  visible: boolean;
  text: string;
}

/** Something to wait for after an action, so a step ends in a known state. */
export interface ExpectSpec {
  /** Wait for a response whose url contains this. */
  requestUrlContains?: string;
  requestMethod?: string;
  urlContains?: string;
  textVisible?: string;
  networkIdle?: boolean;
  /**
   * Wait for the widget library's own loading indicators to clear.
   *
   * Distinct from `networkIdle`, and usually the one you want: an app that dims an already-rendered
   * table while refetching lets a read land on the PREVIOUS query's rows while the network is
   * genuinely idle. Settling on the app's loading state closes that window.
   */
  settled?: boolean;
  timeoutMs?: number;
}

const DEFAULT_DISABLED_CLASS_PATTERNS = ['(^|\\s)disabled(\\s|$)'];

/**
 * The one high-level API scenarios and agent tools both use.
 *
 * Every method records exactly one `UiStepRecord`, shaped so `{title, ok, status?, data?}` is
 * structurally a report step: the report writer, the run store and the technical appendix all
 * consume UI steps as-is.
 */
export class UiDriver {
  private readonly steps: UiStepRecord[] = [];
  private readonly timeout: number;
  private readonly widgets: UiWidgets;
  private readonly text: UiDriverText;

  constructor(private readonly options: UiDriverOptions) {
    this.timeout = options.defaultTimeoutMs ?? 30_000;
    this.widgets = options.widgets;
    this.text = options.text ?? englishUiDriverText;
  }

  get page(): Page {
    return this.options.page;
  }

  /** Records a step around `action`, capturing timing, triggered XHRs, and failures. */
  private async step<T>(
    title: string,
    action: () => Promise<{ value: T; data?: Record<string, unknown>; status?: number }>,
  ): Promise<T> {
    const startedAt = Date.now();
    const marker = this.options.network.marker();
    try {
      const { value, data, status } = await action();
      this.steps.push({
        title,
        ok: true,
        status,
        data: {
          url: this.page.url(),
          durationMs: Date.now() - startedAt,
          triggeredRequests: this.triggeredSince(marker),
          pageErrors: this.options.diagnostics.counts().pageErrors,
          ...data,
        },
      });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.steps.push({
        title,
        ok: false,
        data: {
          url: this.page.url(),
          durationMs: Date.now() - startedAt,
          triggeredRequests: this.triggeredSince(marker),
          pageErrors: this.options.diagnostics.counts().pageErrors,
          error: message,
        },
      });
      throw error;
    }
  }

  private triggeredSince(marker: number): string[] | undefined {
    const entries = this.options.network.since(marker);
    if (entries.length === 0) return undefined;
    return entries.map((e) => `${e.method} ${new URL(e.url).pathname}`);
  }

  /**
   * Arms the response wait BEFORE the action runs, and returns a settle function to await
   * afterwards. `page.waitForResponse` only sees responses that arrive after it is called, and a
   * SPA fires its list request during navigation — so arming after `page.goto()` would wait for a
   * second request that may never come.
   */
  private armExpect(expect?: ExpectSpec): () => Promise<number | undefined> {
    if (!expect) return async () => undefined;
    const timeout = expect.timeoutMs ?? this.timeout;

    // Wait on the RESPONSE, not the request: a fast double-trigger can cancel the first request,
    // and only the response proves completion.
    const responsePromise = expect.requestUrlContains
      ? this.page
          .waitForResponse(
            (r) =>
              r.url().includes(expect.requestUrlContains as string) &&
              (!expect.requestMethod || r.request().method() === expect.requestMethod),
            { timeout },
          )
          .then((r) => r.status())
      : undefined;
    // A no-op catch so a rejection before the caller awaits it is not an unhandled rejection.
    responsePromise?.catch(() => undefined);

    return async () => {
      const status = responsePromise ? await responsePromise : undefined;
      if (expect.urlContains) {
        await this.page.waitForURL((url) => url.toString().includes(expect.urlContains as string), { timeout });
      }
      if (expect.textVisible) {
        await this.page.getByText(expect.textVisible).first().waitFor({ state: 'visible', timeout });
      }
      if (expect.networkIdle) {
        await this.page.waitForLoadState('networkidle', { timeout }).catch(() => undefined);
      }
      // Last, deliberately: the loading indicator is raised by whatever the earlier waits were
      // waiting FOR, so settling before them would observe a page that had not started loading.
      if (expect.settled) {
        await this.widgets.waitForSettled(this.page, timeout);
      }
      return status;
    };
  }

  async goto(pathOrUrl: string, title?: string, expect?: ExpectSpec): Promise<void> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : new URL(pathOrUrl, this.options.webBaseUrl).toString();
    await this.step(title ?? this.text.goto(new URL(url).pathname), async () => {
      const settle = this.armExpect(expect);
      const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout });
      const status = (await settle()) ?? response?.status();
      return { value: undefined, status, data: { targetUrl: url } };
    });
  }

  async click(target: LocatorSpec, title?: string, expect?: ExpectSpec): Promise<void> {
    await this.step(title ?? this.text.click(describeLocator(target)), async () => {
      const { locator, resolved } = await resolveLocator(this.page, target, this.timeout);
      const settle = this.armExpect(expect);
      await locator.click({ timeout: this.timeout });
      const status = await settle();
      return {
        value: undefined,
        status,
        data: { locator: { spec: target, resolvedBy: resolved.strategy, matched: resolved.matched } },
      };
    });
  }

  async fill(target: LocatorSpec, value: string, title?: string, expect?: ExpectSpec): Promise<void> {
    await this.step(title ?? this.text.fill(value, describeLocator(target)), async () => {
      const { resolved } = await resolveLocator(this.page, target, this.timeout);
      const settle = this.armExpect(expect);
      await this.widgets.fillInput(this.page, target, value, this.timeout);
      const status = await settle();
      return {
        value: undefined,
        status,
        data: { locator: { spec: target, resolvedBy: resolved.strategy, matched: resolved.matched }, inputValue: value },
      };
    });
  }

  async press(target: LocatorSpec, key: string, title?: string, expect?: ExpectSpec): Promise<void> {
    await this.step(title ?? this.text.press(key, describeLocator(target)), async () => {
      const { locator, resolved } = await resolveLocator(this.page, target, this.timeout);
      const inner = locator.locator('input');
      const field = (await inner.count()) === 1 ? inner : locator;
      const settle = this.armExpect(expect);
      await field.press(key, { timeout: this.timeout });
      const status = await settle();
      return {
        value: undefined,
        status,
        data: { locator: { spec: target, resolvedBy: resolved.strategy, matched: resolved.matched }, key },
      };
    });
  }

  async selectOption(target: LocatorSpec, optionText: string, title?: string, expect?: ExpectSpec): Promise<void> {
    await this.step(title ?? this.text.selectOption(optionText, describeLocator(target)), async () => {
      const settle = this.armExpect(expect);
      await this.widgets.selectOption(this.page, target, optionText, this.timeout);
      const status = await settle();
      return { value: undefined, status, data: { optionText } };
    });
  }

  async switchTab(tabLabel: string, expect?: ExpectSpec): Promise<void> {
    await this.step(this.text.switchTab(tabLabel), async () => {
      const settle = this.armExpect(expect);
      await this.widgets.switchTab(this.page, tabLabel, this.timeout);
      const status = await settle();
      return { value: undefined, status, data: { tabLabel } };
    });
  }

  async gotoPage(pageNumber: number, expect?: ExpectSpec): Promise<void> {
    await this.step(this.text.gotoPage(pageNumber), async () => {
      const settle = this.armExpect(expect);
      await this.widgets.gotoPage(this.page, pageNumber, this.timeout);
      const status = await settle();
      return { value: undefined, status, data: { pageNumber } };
    });
  }

  async readText(target: LocatorSpec, title?: string): Promise<string> {
    return this.step(title ?? this.text.readText(describeLocator(target)), async () => {
      const { locator, resolved } = await resolveLocator(this.page, target, this.timeout);
      const value = (await locator.innerText()).trim();
      return {
        value,
        data: { locator: { spec: target, resolvedBy: resolved.strategy, matched: resolved.matched }, text: value },
      };
    });
  }

  /** Reads the value a select currently displays — often not the text of the element the id lands on. */
  async readSelectValue(target: LocatorSpec, title?: string): Promise<string> {
    return this.step(title ?? this.text.readSelectValue(describeLocator(target)), async () => {
      const { resolved } = await resolveLocator(this.page, target, this.timeout);
      const value = await this.widgets.readSelectValue(this.page, target, this.timeout);
      return {
        value,
        data: {
          locator: { spec: target, resolvedBy: resolved.strategy, matched: resolved.matched },
          selectedValue: value,
          empty: value === '',
        },
      };
    });
  }

  /**
   * How many elements a selector matches right now. Deliberately not resolved through
   * `resolveLocator`, which waits for and asserts a match: zero is a legitimate answer here.
   */
  countMatching(target: LocatorSpec, title?: string): Promise<number> {
    return this.step(title ?? this.text.countMatching(describeLocator(target)), async () => {
      const count = await buildLocator(this.page, target).count();
      return { value: count, data: { locator: { spec: target }, count } };
    });
  }

  /**
   * Whether a control is currently disabled, and what it reads. UI libraries mark disabled controls
   * with the native attribute, `aria-disabled`, or a class — a single check reports a control as
   * enabled when the user cannot touch it, so every source is checked once here.
   */
  async readControlState(target: LocatorSpec, title?: string): Promise<ControlState> {
    return this.step(title ?? this.text.readControlState(describeLocator(target)), async () => {
      const locator = buildLocator(this.page, target).first();
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) {
        const absent: ControlState = { disabled: false, visible: false, text: '' };
        return { value: absent, data: { locator: { spec: target }, visible } };
      }
      const patterns = [...(this.widgets.disabledClassPatterns ?? DEFAULT_DISABLED_CLASS_PATTERNS)];
      const state = await locator.evaluate((node, classPatterns) => {
        const el = node as unknown as {
          textContent: string | null;
          hasAttribute(name: string): boolean;
          getAttribute(name: string): string | null;
          className: string;
        };
        const className = typeof el.className === 'string' ? el.className : '';
        return {
          nativeDisabled: el.hasAttribute('disabled'),
          ariaDisabled: el.getAttribute('aria-disabled') === 'true',
          classDisabled: classPatterns.some((pattern) => new RegExp(pattern).test(className)),
          text: (el.textContent ?? '').trim().slice(0, 120),
        };
      }, patterns);
      const disabled = state.nativeDisabled || state.ariaDisabled || state.classDisabled;
      return {
        value: { disabled, visible: true, text: state.text },
        // The three sources are kept in the step data, so the report says which one fired.
        data: { locator: { spec: target }, disabled, visible: true, ...state },
      };
    });
  }

  /** Searches a picker modal, selects a row, and confirms. */
  async pickInModal(options: Omit<PickInModalOptions, 'timeoutMs'>, title?: string, expect?: ExpectSpec): Promise<void> {
    await this.step(title ?? this.text.pickInModal(options.keyword), async () => {
      const settle = this.armExpect(expect);
      await this.widgets.pickInModal(this.page, { ...options, timeoutMs: this.timeout });
      const status = await settle();
      return { value: undefined, status, data: { mode: options.mode, keyword: options.keyword } };
    });
  }

  /** Clicks a modal's confirming button and waits for it to close. */
  async confirmModal(label = this.text.defaultConfirmLabel, title?: string, expect?: ExpectSpec): Promise<void> {
    await this.step(title ?? this.text.confirmModal(label), async () => {
      const settle = this.armExpect(expect);
      await this.widgets.confirmModal(this.page, label, this.timeout);
      const status = await settle();
      return { value: undefined, status, data: { confirmLabel: label } };
    });
  }

  /** Dismisses an open modal. Records whether one was actually there. */
  async closeModal(title?: string): Promise<boolean> {
    return this.step(title ?? this.text.closeModal, async () => {
      const wasOpen = await this.widgets.closeModalIfOpen(this.page, this.timeout);
      return { value: wasOpen, data: { modalWasOpen: wasOpen } };
    });
  }

  /** The body text of a confirmation dialog — for asserting a guard fired. */
  readConfirmDialog(): Promise<string | undefined> {
    return this.widgets.readConfirmDialogText(this.page);
  }

  /** Reads the latest toast OR notification. */
  readFeedback(options: FeedbackOptions = {}): Promise<string | undefined> {
    return this.widgets.readFeedback(this.page, options);
  }

  /** Waits for the widget library's loading indicators to clear, outside of an `expect`. */
  settle(timeoutMs?: number): Promise<void> {
    return this.widgets.waitForSettled(this.page, timeoutMs ?? this.timeout);
  }

  async readGrid(options: ReadGridOptions, title?: string): Promise<GridSnapshot> {
    return this.step(title ?? this.text.readGrid(options.columns), async () => {
      const snapshot = await this.widgets.readGrid(this.page, options);
      return {
        value: snapshot,
        data: { columns: snapshot.columns, domRowCount: snapshot.domRowCount, rows: snapshot.rows },
      };
    });
  }

  /**
   * Types a value into one editable grid cell and commits it. Does NOT throw when the cell refuses
   * to edit — `result.ok === false` with a reason, because "this column is not editable" is a finding
   * a scenario must be able to report as a check. The step is still recorded, and marked failed.
   */
  async editGridCell(options: EditGridCellOptions, title?: string): Promise<GridCellEditResult> {
    const label = title ?? this.text.editGridCell(options.value, options.column, options.rowIndex + 1);
    const result = await this.step(label, async () => {
      const value = await this.widgets.editGridCell(this.page, options);
      return {
        value,
        data: {
          column: options.column,
          rowIndex: options.rowIndex,
          typed: options.value,
          before: value.before,
          after: value.after,
          matched: value.matched,
          ...(value.reason ? { error: value.reason } : {}),
        },
      };
    });
    // `step` only marks a failure when the action throws, and this one deliberately does not.
    if (!result.ok) {
      const step = this.steps[this.steps.length - 1];
      if (step) step.ok = false;
    }
    return result;
  }

  /** Body rows a grid renders right now, excluding pinned rows. */
  countGridBodyRows(within?: LocatorSpec): Promise<number> {
    return this.widgets.countGridBodyRows(this.page, within);
  }

  async readToast(): Promise<string | undefined> {
    return this.widgets.readMessage(this.page);
  }

  activeTabPanel(): Locator {
    return this.widgets.activeTabPanel(this.page);
  }

  /** Screenshot into the evidence store, linked to the step just recorded. */
  async screenshot(label: string, meta: { checkTestId?: string } = {}): Promise<string | undefined> {
    const index = this.steps.length;
    const filename = `S${String(index).padStart(2, '0')}-${label.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()}.png`;
    const target = this.options.evidence.reserve('screenshot', filename);
    await this.page.screenshot({ path: target, fullPage: false });
    const item = this.options.evidence.register('screenshot', target, label, {
      stepIndex: index > 0 ? index - 1 : 0,
      ...meta,
    });
    const step = index > 0 ? this.steps[index - 1] : undefined;
    if (item && step) {
      step.data.evidence = [...(step.data.evidence ?? []), item.relPath];
    }
    return item?.relPath;
  }

  /** Records an observation that produced no browser action — a computed check, a probe. */
  note(title: string, data: Record<string, unknown> = {}): void {
    this.steps.push({ title, ok: true, data: { url: this.page.url(), ...data } });
  }

  /** Records a step that failed without throwing — e.g. a precondition that came back false. */
  noteFailure(title: string, error: string, data: Record<string, unknown> = {}): void {
    this.steps.push({ title, ok: false, data: { url: this.page.url(), error, ...data } });
  }

  recordedSteps(): UiStepRecord[] {
    return this.steps;
  }

  networkTrace(): RequestTraceEntry[] {
    return this.options.network.trace();
  }

  diagnostics(): UiDiagnostics {
    return this.options.diagnostics.snapshot();
  }

  waitForResponse(urlContains: string, timeoutMs?: number): Promise<{ status: number; url: string; body: unknown }> {
    return this.page
      .waitForResponse((r) => r.url().includes(urlContains), { timeout: timeoutMs ?? this.timeout })
      .then(async (response) => ({
        status: response.status(),
        url: response.url(),
        body: await response.json().catch(() => undefined),
      }));
  }
}
