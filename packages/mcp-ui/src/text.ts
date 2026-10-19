export type UiToolName =
  | 'ui_open_session'
  | 'ui_open_screen'
  | 'ui_describe_screen'
  | 'ui_act'
  | 'ui_read_grid'
  | 'ui_assert'
  | 'ui_capture_evidence'
  | 'ui_finish_run'
  | 'ui_close_session';

/** Descriptions of the tool input fields, as the agent sees them in the tool schema. */
export interface UiMcpFieldText {
  locatorDomId: string;
  locatorTestId: string;
  locatorRole: string;
  locatorName: string;
  locatorLabel: string;
  locatorText: string;
  locatorCss: string;
  locatorNth: string;
  locatorWithin: string;
  /** Validation message when a locator names no strategy at all. */
  locatorRequired: string;
  expectRequestUrlContains: string;
  expectSettled: string;
  openSessionAuthMode: string;
  openScreenPath: string;
  describeWithin: string;
  actTarget: string;
  actValue: string;
  actTabLabel: string;
  actPageNumber: string;
  actModalPickMode: string;
  actModalKeyword: string;
  actConfirmLabel: string;
  actReason: string;
  readGridColumns: string;
  /** Validation message when `ui_assert.testId` does not match `ids.checkRef`. */
  assertCheckRefFormat: string;
  assertLabel: string;
  captureLabel: string;
  captureCheckTestId: string;
  finishScenario: string;
  closePassed: string;
}

/** Why the policy refused a call — returned to the agent and written to the audit log. */
export interface UiMcpDenyText {
  unparseableUrl(url: string): string;
  hostNotAllowed(host: string, allowedHosts: readonly string[]): string;
  destructive(descriptor: string): string;
  secretValue: string;
  actionBudget(maxActions: number): string;
  timeBudget(minutes: number): string;
}

/** Errors aimed at the agent rather than a stack trace. */
export interface UiMcpErrorText {
  noSession: string;
  needTarget: string;
  needValue: string;
  needPageNumber: string;
  needModalPickMode: string;
  unsupportedAction(action: string): string;
}

/** Every string the UI MCP server shows an agent. A locale pack or a project supplies its own. */
export interface UiMcpText {
  tools: Record<UiToolName, string>;
  fields: UiMcpFieldText;
  deny: UiMcpDenyText;
  errors: UiMcpErrorText;
  sessionWritable: string;
  sessionReadOnly: string;
  describeHint: string;
  /** `keyData` lines of the report `ui_finish_run` writes. */
  finishKeyData(runId: string, checkCount: number): string[];
  /** Where to look at the finished run, e.g. the reporting app URL. */
  reviewHint?: string;
}

export interface UiMcpTextOverrides {
  tools?: Partial<UiMcpText['tools']>;
  fields?: Partial<UiMcpFieldText>;
  deny?: Partial<UiMcpDenyText>;
  errors?: Partial<UiMcpErrorText>;
  sessionWritable?: string;
  sessionReadOnly?: string;
  describeHint?: string;
  finishKeyData?: UiMcpText['finishKeyData'];
  reviewHint?: string;
}

/** `base` with `overrides` applied one group deep. */
export function mergeUiMcpText(base: UiMcpText, overrides: UiMcpTextOverrides): UiMcpText {
  return {
    ...base,
    ...overrides,
    tools: { ...base.tools, ...overrides.tools },
    fields: { ...base.fields, ...overrides.fields },
    deny: { ...base.deny, ...overrides.deny },
    errors: { ...base.errors, ...overrides.errors },
  };
}

export const englishUiMcpText: UiMcpText = {
  tools: {
    ui_open_session:
      'Opens a browser session (headless Chromium) and signs in. Call this before any other tool. ' +
      'authMode picks how: a session seeded from the harness token, the real login form, or no sign-in.',
    ui_open_screen: 'Navigates to a screen by app-relative path. Only hosts on the allowlist are reachable.',
    ui_describe_screen:
      'Semantic snapshot of the screen: the interactive controls with role, name, id and testid. ' +
      'Use it to learn what can be done on this screen before calling ui_act.',
    ui_act:
      'Performs ONE user action (click/fill/press/select/switchTab/gotoPage/pickInModal/confirmModal/closeModal), ' +
      'with an optional wait condition. The reason field is required and is recorded in the audit log.',
    ui_read_grid:
      'Reads a data grid by column id. NOTE: the number of rows in the DOM is NOT the dataset size — grids ' +
      'virtualize rows and paginate.',
    ui_assert:
      'Records one check, tied to an assertion id from the test-step doc (e.g. "TC-ORD-U01 / A1"). ' +
      'Values are compared with ===, so normalize them before passing them in.',
    ui_capture_evidence: 'Captures evidence (screenshot / DOM) into the session evidence store, linked to an assertion if given.',
    ui_finish_run:
      'Ends the run: builds a ReportableResult from the recorded steps and checks, then writes the Markdown/JSON ' +
      'report and stores the run — the same shape as a hand-written scenario.',
    ui_close_session: 'Closes the browser and writes the evidence manifest. passed=false keeps the trace and video (retain-on-failure).',
  },
  fields: {
    locatorDomId: '#id — try this first when the app gives controls stable ids',
    locatorTestId: '[data-testid=...]',
    locatorRole: 'ARIA role',
    locatorName: 'Accessible name, used with role',
    locatorLabel: 'Form label. Depends on the UI language — prefer domId or testId',
    locatorText: 'Visible text. Same language caveat as label',
    locatorCss: 'Raw CSS — last resort; justify it in the step doc',
    locatorNth: 'Only for a deliberately non-unique target',
    locatorWithin: 'Scope to a tab panel, modal or grid',
    locatorRequired: 'Give at least one locator strategy (domId, testId, role, label, placeholder, text, css).',
    expectRequestUrlContains: 'Wait for a response whose URL contains this',
    expectSettled:
      "Wait for the widget library's loading indicators to clear. Usually more reliable than networkIdle: " +
      "a table that is already rendered can still show the previous query's data while it reloads.",
    openSessionAuthMode: 'storage seeds the session from the harness token (fast); form drives the real login page',
    openScreenPath: 'App-relative path, e.g. /orders/42',
    describeWithin: 'Limit the snapshot to one region',
    actTarget: 'Required for click/fill/press/select',
    actValue: 'Text for fill, key for press, option text for select',
    actTabLabel: 'For switchTab',
    actPageNumber: 'For gotoPage',
    actModalPickMode:
      'For pickInModal. radio: single-select table. checkAll: select the whole page. exactRow: match the keyword ' +
      'EXACTLY, then tick that row (search is usually a substring match). exactCell: click the matching cell ' +
      '(tables without a checkbox column).',
    actModalKeyword: 'Keyword to search for in the dialog; required for exactRow/exactCell',
    actConfirmLabel: 'Label of the dialog confirm button (defaults to the driver confirm label)',
    actReason: 'Why this action — recorded in the audit log',
    readGridColumns: 'Column ids, e.g. ["sku","qty"]',
    assertCheckRefFormat: 'Required format: "TC-XX-Y01 / A2"',
    assertLabel: 'Business-readable description',
    captureLabel: 'Caption',
    captureCheckTestId: 'Assertion this evidence proves, e.g. "TC-ORD-U01 / A1"',
    finishScenario: 'Scenario key for the report and DB row, e.g. ui-orders-list',
    closePassed: 'Drives retain-on-failure for trace and video',
  },
  deny: {
    unparseableUrl: (url) => `Could not parse the URL "${url}".`,
    hostNotAllowed: (host, allowedHosts) => `Host "${host}" is not in allowedHosts (${allowedHosts.join(', ')}).`,
    destructive: (descriptor) =>
      `"${descriptor}" looks like an action that changes or approves data. ` +
      'The harness does not clean up data created through the UI, so this kind of action must be enabled explicitly ' +
      '(allowWrites + allowDestructive).',
    secretValue: 'The value contains a secret (password/token) — refused so it cannot leak through a tool result.',
    actionBudget: (maxActions) => `Exceeded the limit of ${maxActions} actions in one session.`,
    timeBudget: (minutes) => `Exceeded the ${minutes}-minute time limit for one session.`,
  },
  errors: {
    noSession: 'No browser session is open. Call ui_open_session first.',
    needTarget: 'This action needs the target field.',
    needValue: 'This action needs the value field.',
    needPageNumber: 'gotoPage needs pageNumber.',
    needModalPickMode: 'pickInModal needs modalPickMode.',
    unsupportedAction: (action) => `Unsupported action: ${action}`,
  },
  sessionWritable: 'WARNING: this session may write data to the target environment.',
  sessionReadOnly: 'Read-only session: every non-GET request to the app is blocked at the route layer.',
  describeHint: 'Prefer domId, then testId. Visible labels depend on the UI language, so avoid label/text as the primary key.',
  finishKeyData: (runId, checkCount) => [`Agent-driven session (runId ${runId})`, `Checks recorded: ${checkCount}`],
};
