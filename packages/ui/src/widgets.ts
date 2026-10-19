import type { Locator, Page } from 'playwright';
import type { GridSnapshot, LocatorSpec } from './types.js';

export interface ReadGridOptions {
  /** Scope to one grid — a tab panel, a modal. Omit when the page has exactly one grid. */
  within?: LocatorSpec;
  /** Column ids to read. Ask only for what you assert on: virtualized grids pay per column. */
  columns: string[];
  maxRows?: number;
  timeoutMs?: number;
}

export interface EditGridCellOptions {
  /** Scope to one grid. */
  within?: LocatorSpec;
  /** Column id of the cell to edit. */
  column: string;
  /** Body row index (pinned rows are never targeted). */
  rowIndex: number;
  /** What to type. Numbers go in unformatted: editors apply their own formatting. */
  value: string;
  /** How the cell's editor takes input, in the widget library's own terms (e.g. `input`, `select`). */
  editor?: string;
  timeoutMs?: number;
}

export interface GridCellEditResult {
  /** The editor opened, took the value, and closed. False means the cell never entered edit mode. */
  ok: boolean;
  /** Rendered text before the edit. */
  before: string;
  /** Rendered text after the edit — still formatted by the column. */
  after: string;
  /** `after` carries `value` once formatting is normalized away. The caller's real oracle. */
  matched: boolean;
  /** Why `ok` is false. Undefined when it is true. */
  reason?: string;
}

export interface PickInModalOptions {
  /** How the modal's list expresses "this row is chosen", in the widget library's terms. */
  mode: string;
  keyword?: string;
  confirmLabel?: string;
  timeoutMs?: number;
}

export interface FeedbackOptions {
  pattern?: RegExp;
  pick?: 'first' | 'last';
  timeoutMs?: number;
}

/**
 * The component-library half of the driver: how this app's inputs, selects, tabs, pagination,
 * loading indicators, modals, toasts and data grids behave. The driver owns step recording,
 * expectations and evidence; a widget adapter owns the DOM quirks of one UI library.
 */
export interface UiWidgets {
  fillInput(page: Page, target: LocatorSpec, value: string, timeoutMs: number): Promise<void>;
  selectOption(page: Page, trigger: LocatorSpec, optionText: string, timeoutMs: number): Promise<void>;
  /** The value a select currently displays; `''` when empty. */
  readSelectValue(page: Page, target: LocatorSpec, timeoutMs: number): Promise<string>;
  switchTab(page: Page, tabLabel: string, timeoutMs: number): Promise<void>;
  gotoPage(page: Page, pageNumber: number, timeoutMs: number): Promise<void>;
  /** Waits for the library's own loading indicators to clear. Never throws on timeout. */
  waitForSettled(page: Page, timeoutMs: number): Promise<void>;
  pickInModal(page: Page, options: PickInModalOptions): Promise<void>;
  confirmModal(page: Page, label: string, timeoutMs: number): Promise<void>;
  /** Dismisses an open modal; `true` when one was actually there. */
  closeModalIfOpen(page: Page, timeoutMs: number): Promise<boolean>;
  readConfirmDialogText(page: Page): Promise<string | undefined>;
  /** Latest toast or notification, optionally narrowed by `pattern`. */
  readFeedback(page: Page, options: FeedbackOptions): Promise<string | undefined>;
  readMessage(page: Page): Promise<string | undefined>;
  activeTabPanel(page: Page): Locator;
  readGrid(page: Page, options: ReadGridOptions): Promise<GridSnapshot>;
  /** Never throws on a cell that refuses to edit — `ok: false` with a reason. */
  editGridCell(page: Page, options: EditGridCellOptions): Promise<GridCellEditResult>;
  countGridBodyRows(page: Page, within?: LocatorSpec): Promise<number>;
  /**
   * Regular-expression sources matched against a control's class list to decide it is disabled,
   * on top of the native `disabled` attribute and `aria-disabled`.
   */
  disabledClassPatterns?: readonly string[];
}
