import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EvidenceStore } from '@qakit/core';
import type { Page } from 'playwright';
import type { DiagnosticsCollector } from './diagnostics.js';
import { UiDriver, englishUiDriverText } from './driver.js';
import type { BrowserNetworkRecorder } from './network-recorder.js';
import type { UiWidgets } from './widgets.js';

/** A page stub covering exactly what the widget-routed methods touch. */
function fakePage(classNames: string) {
  const calls: string[] = [];
  const element = {
    first: () => element,
    isVisible: async () => true,
    evaluate: async (fn: (node: unknown, arg: string[]) => unknown, arg: string[]) =>
      fn({ textContent: ' Save ', hasAttribute: () => false, getAttribute: () => null, className: classNames }, arg),
  };
  const page = {
    url: () => 'https://shop.example.test/orders',
    locator: () => element,
    getByRole: () => element,
    getByTestId: () => element,
    goto: async (url: string) => {
      calls.push(`goto ${url}`);
      return { status: () => 200 };
    },
  };
  return { page: page as unknown as Page, calls };
}

function driverWith(widgets: Partial<UiWidgets>, classNames = '', text = englishUiDriverText) {
  const { page, calls } = fakePage(classNames);
  const noop = async () => undefined;
  const allWidgets: UiWidgets = {
    fillInput: noop,
    selectOption: noop,
    readSelectValue: async () => '',
    switchTab: noop,
    gotoPage: noop,
    waitForSettled: noop,
    pickInModal: noop,
    confirmModal: noop,
    closeModalIfOpen: async () => false,
    readConfirmDialogText: noop,
    readFeedback: noop,
    readMessage: noop,
    activeTabPanel: () => {
      throw new Error('unused');
    },
    readGrid: async () => ({ columns: [], rows: [], domRowCount: 0 }),
    editGridCell: async () => ({ ok: true, before: '', after: '', matched: true }),
    countGridBodyRows: async () => 0,
    ...widgets,
  };
  const driver = new UiDriver({
    page,
    webBaseUrl: 'https://shop.example.test',
    evidence: {} as EvidenceStore,
    diagnostics: { counts: () => ({ pageErrors: 0 }) } as unknown as DiagnosticsCollector,
    network: { marker: () => 0, since: () => [], trace: () => [] } as unknown as BrowserNetworkRecorder,
    widgets: allWidgets,
    text,
  });
  return { driver, calls };
}

describe('UiDriver', () => {
  it('records navigation with the step wording and the response status', async () => {
    const { driver, calls } = driverWith({});
    await driver.goto('/orders/42');
    assert.deepEqual(calls, ['goto https://shop.example.test/orders/42']);
    const [step] = driver.recordedSteps();
    assert.equal(step?.title, 'Open screen /orders/42');
    assert.equal(step?.status, 200);
    assert.equal(step?.ok, true);
  });

  it('routes widget actions through the adapter and uses its default confirm label', async () => {
    const seen: string[] = [];
    const { driver } = driverWith(
      {
        switchTab: async (_page, label) => {
          seen.push(`tab:${label}`);
        },
        confirmModal: async (_page, label) => {
          seen.push(`confirm:${label}`);
        },
        pickInModal: async (_page, options) => {
          seen.push(`pick:${options.mode}:${options.keyword}:${options.timeoutMs}`);
        },
        closeModalIfOpen: async () => true,
      },
      '',
      { ...englishUiDriverText, defaultConfirmLabel: 'Accept', switchTab: (label) => `Tab ${label}` },
    );
    await driver.switchTab('Details');
    await driver.confirmModal();
    await driver.pickInModal({ mode: 'radio', keyword: 'A-1' });
    assert.equal(await driver.closeModal(), true);
    assert.deepEqual(seen, ['tab:Details', 'confirm:Accept', 'pick:radio:A-1:30000']);
    assert.deepEqual(
      driver.recordedSteps().map((s) => s.title),
      ['Tab Details', 'Click "Accept" in the dialog', 'Pick "A-1" in the dialog', 'Close the dialog if open'],
    );
    assert.deepEqual(driver.recordedSteps()[3]?.data.modalWasOpen, true);
  });

  it('records a thrown widget failure as a failed step and rethrows', async () => {
    const { driver } = driverWith({
      gotoPage: async () => {
        throw new Error('no pager');
      },
    });
    await assert.rejects(driver.gotoPage(3), /no pager/);
    const [step] = driver.recordedSteps();
    assert.equal(step?.ok, false);
    assert.equal(step?.data.error, 'no pager');
  });

  it('marks a refused cell edit as a failed step without throwing', async () => {
    const { driver } = driverWith({
      editGridCell: async () => ({ ok: false, before: '1', after: '1', matched: false, reason: 'read-only column' }),
    });
    const result = await driver.editGridCell({ column: 'qty', rowIndex: 0, value: '5' });
    assert.equal(result.ok, false);
    const [step] = driver.recordedSteps();
    assert.equal(step?.title, 'Type "5" into cell qty, row 1');
    assert.equal(step?.ok, false);
    assert.equal(step?.data.error, 'read-only column');
  });

  it('reads disabled state from the adapter class patterns', async () => {
    const libraryDisabled = await driverWith({ disabledClassPatterns: ['(^|\\s)lib-btn-disabled(\\s|$)'] }, 'lib-btn lib-btn-disabled').driver.readControlState({
      css: 'button',
    });
    assert.deepEqual(libraryDisabled, { disabled: true, visible: true, text: 'Save' });

    const defaultPatterns = await driverWith({}, 'lib-btn lib-btn-disabled').driver.readControlState({ css: 'button' });
    assert.equal(defaultPatterns.disabled, false, 'library classes are not disabled without the adapter pattern');
  });
});
