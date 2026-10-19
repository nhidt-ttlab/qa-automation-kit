import type { Locator, Page } from 'playwright';
import { resolveLocator } from './locator.js';
import type { GridRow, GridSnapshot, LocatorSpec } from './types.js';
import type { EditGridCellOptions, FeedbackOptions, GridCellEditResult, PickInModalOptions, ReadGridOptions, UiWidgets } from './widgets.js';

/**
 * Selectors the HTML adapter relies on. The defaults follow ARIA roles and native elements, so an
 * accessible app works unchanged; override them to point at a component library's markup.
 */
export interface HtmlWidgetOptions {
  /** Loading indicators that must disappear before a read. */
  busySelector?: string;
  /** Toast / notification surfaces. */
  feedbackSelector?: string;
  /** Open dialogs. The last match is treated as the topmost. */
  dialogSelector?: string;
  /** A data grid or table. */
  gridSelector?: string;
  /** Body rows of a grid (header rows excluded). */
  gridRowSelector?: string;
  /** Cells of a grid row. */
  gridCellSelector?: string;
  /** Column headers; a header's column id is its `data-col-id` attribute, else its text. */
  gridHeaderSelector?: string;
  /** The search box inside a picker dialog. */
  searchSelector?: string;
  /** Label `pickInModal` confirms with when none is given. */
  defaultConfirmLabel?: string;
}

const DEFAULTS: Required<HtmlWidgetOptions> = {
  busySelector: '[aria-busy="true"], [role="progressbar"]',
  feedbackSelector: '[role="status"], [role="alert"]',
  dialogSelector: '[role="dialog"]:visible, [role="alertdialog"]:visible, dialog[open]',
  gridSelector: '[role="grid"], table',
  gridRowSelector: 'tbody tr, [role="row"]:has([role="gridcell"])',
  gridCellSelector: 'td, [role="gridcell"], [role="cell"]',
  gridHeaderSelector: 'thead th, [role="columnheader"]',
  searchSelector: 'input[type="search"], [role="searchbox"]',
  defaultConfirmLabel: 'OK',
};

class HtmlWidgetError extends Error {}

/** Compares a typed value with a rendered cell, ignoring number formatting such as thousand separators. */
function sameCellValue(typed: string, rendered: string): boolean {
  const asNumber = (raw: string): number | undefined => {
    const cleaned = raw.replace(/[^\d.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return undefined;
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : undefined;
  };
  const a = asNumber(typed);
  const b = asNumber(rendered);
  if (a !== undefined && b !== undefined) return a === b;
  return typed.trim() === rendered.trim();
}

/**
 * A widget adapter for plain, accessible HTML: native inputs and selects, ARIA listboxes, tabs,
 * dialogs, status regions and tables. The reference adapter for apps with no library-specific one,
 * and the pattern to copy when writing one.
 */
export function createHtmlWidgets(overrides: HtmlWidgetOptions = {}): UiWidgets {
  const o = { ...DEFAULTS, ...overrides };

  const settle = async (page: Page, timeoutMs: number): Promise<void> => {
    await page.locator(o.busySelector).first().waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => undefined);
  };
  const topDialog = (page: Page): Locator => page.locator(o.dialogSelector).last();
  const scopeOf = async (page: Page, within: LocatorSpec | undefined, timeoutMs: number): Promise<Page | Locator> =>
    within ? (await resolveLocator(page, within, timeoutMs)).locator : page;

  /** Index of `column` among the grid's headers, or -1. */
  const columnIndex = (grid: Locator, column: string): Promise<number> =>
    grid.evaluate(
      (node, args) =>
        Array.from(node.querySelectorAll(args.headerSelector)).findIndex(
          (header) => (header.getAttribute('data-col-id') ?? (header.textContent ?? '').trim()) === args.column,
        ),
      { headerSelector: o.gridHeaderSelector, column },
    );

  const confirmModal = async (page: Page, label: string, timeoutMs: number): Promise<void> => {
    const button = topDialog(page).getByRole('button', { name: label, exact: true }).last();
    await button.waitFor({ state: 'visible', timeout: timeoutMs });
    await button.click({ timeout: timeoutMs });
    await topDialog(page).waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => undefined);
    await settle(page, timeoutMs);
  };

  const readFeedback = async (page: Page, options: FeedbackOptions): Promise<string | undefined> => {
    const { pattern, pick = 'last', timeoutMs = 5_000 } = options;
    const base = page.locator(o.feedbackSelector);
    const filtered = pattern ? base.filter({ hasText: pattern }) : base;
    const target = pick === 'first' ? filtered.first() : filtered.last();
    try {
      await target.waitFor({ state: 'visible', timeout: timeoutMs });
      return (await target.innerText()).trim();
    } catch {
      return undefined;
    }
  };

  return {
    async fillInput(page, target, value, timeoutMs) {
      const { locator } = await resolveLocator(page, target, timeoutMs);
      const inner = locator.locator('input, textarea');
      const field = (await inner.count()) === 1 ? inner : locator;
      await field.fill(value, { timeout: timeoutMs });
    },

    async selectOption(page, trigger, optionText, timeoutMs) {
      const { locator } = await resolveLocator(page, trigger, timeoutMs);
      const tag = await locator.evaluate((node) => node.tagName.toLowerCase());
      if (tag === 'select') {
        await locator.selectOption({ label: optionText }, { timeout: timeoutMs });
        return;
      }
      await locator.click({ timeout: timeoutMs });
      const option = page.getByRole('option', { name: optionText, exact: true }).first();
      try {
        await option.waitFor({ state: 'visible', timeout: timeoutMs });
      } catch {
        throw new HtmlWidgetError(`No visible option "${optionText}" after opening ${JSON.stringify(trigger)}`);
      }
      await option.click({ timeout: timeoutMs });
    },

    async readSelectValue(page, target, timeoutMs) {
      const { locator } = await resolveLocator(page, target, timeoutMs);
      return locator.evaluate((node) => {
        if (node instanceof HTMLSelectElement) return node.selectedOptions[0]?.text.trim() ?? '';
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node.value;
        return (node.textContent ?? '').trim();
      });
    },

    async switchTab(page, tabLabel, timeoutMs) {
      await page.getByRole('tab', { name: tabLabel, exact: true }).first().click({ timeout: timeoutMs });
      await page
        .locator('[role="tab"][aria-selected="true"]', { hasText: tabLabel })
        .first()
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .catch(() => undefined);
    },

    async gotoPage(page, pageNumber, timeoutMs) {
      const nav = page.locator('nav, [role="navigation"]');
      const name = String(pageNumber);
      await nav
        .getByRole('button', { name, exact: true })
        .or(nav.getByRole('link', { name, exact: true }))
        .first()
        .click({ timeout: timeoutMs });
    },

    waitForSettled: settle,

    async pickInModal(page, options: PickInModalOptions) {
      const { mode, keyword, confirmLabel = o.defaultConfirmLabel, timeoutMs = 10_000 } = options;
      const modal = topDialog(page);
      await modal.waitFor({ state: 'visible', timeout: timeoutMs });
      await settle(page, timeoutMs);

      if (keyword) {
        const search = modal.locator(o.searchSelector).first();
        if (await search.isVisible().catch(() => false)) {
          await search.fill(keyword);
          await search.press('Enter');
          await settle(page, timeoutMs);
        }
      }

      const choose = async (row: Locator): Promise<void> => {
        await row.waitFor({ state: 'visible', timeout: timeoutMs });
        const control = row.locator('input[type="checkbox"], input[type="radio"]').first();
        if ((await control.count()) > 0) await control.check({ timeout: timeoutMs });
        else await row.click({ timeout: timeoutMs });
      };
      const rows = modal.locator(`${o.gridRowSelector}, [role="option"]`);

      if (mode === 'checkAll') {
        await modal.locator('thead input[type="checkbox"]').first().check({ timeout: timeoutMs });
      } else if (mode === 'exactRow' || mode === 'exactCell') {
        if (!keyword) throw new HtmlWidgetError(`pickInModal mode "${mode}" requires a keyword to match exactly against`);
        await choose(rows.filter({ has: page.getByText(keyword, { exact: true }) }).first());
      } else {
        await choose(keyword ? rows.filter({ hasText: keyword }).first() : rows.first());
      }

      await confirmModal(page, confirmLabel, timeoutMs);
    },

    confirmModal,

    async closeModalIfOpen(page, timeoutMs) {
      const modal = topDialog(page);
      if (!(await modal.isVisible().catch(() => false))) return false;
      const close = modal.getByRole('button', { name: /^(close|cancel|×)$/i }).first();
      if ((await close.count()) > 0) await close.click({ timeout: timeoutMs });
      else await page.keyboard.press('Escape');
      await topDialog(page).waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => undefined);
      await settle(page, timeoutMs);
      return true;
    },

    async readConfirmDialogText(page) {
      const dialog = page.locator('[role="alertdialog"]:visible, [role="dialog"]:visible').last();
      try {
        await dialog.waitFor({ state: 'visible', timeout: 5_000 });
        return (await dialog.innerText()).trim();
      } catch {
        return undefined;
      }
    },

    readFeedback,
    readMessage: (page) => readFeedback(page, {}),
    activeTabPanel: (page) => page.locator('[role="tabpanel"]:visible').first(),

    async readGrid(page, options: ReadGridOptions): Promise<GridSnapshot> {
      const { columns, maxRows, timeoutMs = 15_000 } = options;
      const grid = (await scopeOf(page, options.within, timeoutMs)).locator(o.gridSelector).first();
      await grid.waitFor({ state: 'visible', timeout: timeoutMs });
      const harvest = await grid.evaluate(
        (node, selectors) => ({
          ids: Array.from(node.querySelectorAll(selectors.header)).map(
            (header) => header.getAttribute('data-col-id') ?? (header.textContent ?? '').trim(),
          ),
          rows: Array.from(node.querySelectorAll(selectors.row)).map((row) =>
            Array.from(row.querySelectorAll(selectors.cell)).map((cell) => (cell.textContent ?? '').trim()),
          ),
        }),
        { header: o.gridHeaderSelector, row: o.gridRowSelector, cell: o.gridCellSelector },
      );
      const found = columns.filter((column) => harvest.ids.includes(column));
      const rows: GridRow[] = harvest.rows
        .slice(0, maxRows ?? harvest.rows.length)
        .map((cells) => Object.fromEntries(found.map((column) => [column, cells[harvest.ids.indexOf(column)] ?? ''])));
      return { columns: found, rows, domRowCount: harvest.rows.length };
    },

    async editGridCell(page, options: EditGridCellOptions): Promise<GridCellEditResult> {
      const { column, rowIndex, value, timeoutMs = 15_000 } = options;
      const grid = (await scopeOf(page, options.within, timeoutMs)).locator(o.gridSelector).first();
      await grid.waitFor({ state: 'visible', timeout: timeoutMs });

      const index = await columnIndex(grid, column);
      if (index < 0) return { ok: false, before: '', after: '', matched: false, reason: `no column "${column}" in the grid` };
      const cell = grid.locator(o.gridRowSelector).nth(rowIndex).locator(o.gridCellSelector).nth(index);
      if ((await cell.count()) === 0) {
        return { ok: false, before: '', after: '', matched: false, reason: `no cell for column "${column}" in row ${rowIndex}` };
      }

      const before = (await cell.innerText()).trim();
      await cell.dblclick({ timeout: timeoutMs });
      const editor = cell.locator('input, textarea, select, [contenteditable="true"]').first();
      const editing = await editor
        .waitFor({ state: 'visible', timeout: 1_000 })
        .then(() => true)
        .catch(() => false);
      if (!editing) {
        return { ok: false, before, after: before, matched: false, reason: `cell "${column}" in row ${rowIndex} did not enter edit mode` };
      }
      await editor.fill(value, { timeout: timeoutMs });
      await editor.press('Enter');
      await settle(page, timeoutMs);
      const after = (await cell.innerText()).trim();
      return { ok: true, before, after, matched: sameCellValue(value, after) };
    },

    async countGridBodyRows(page, within) {
      const grid = (await scopeOf(page, within, 15_000)).locator(o.gridSelector).first();
      const visible = await grid
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      return visible ? grid.locator(o.gridRowSelector).count() : 0;
    },
  };
}
