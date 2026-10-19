import { z } from 'zod';
import type { UiMcpFieldText } from './text.js';

export interface LocatorSpecInput {
  domId?: string;
  testId?: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  css?: string;
  nth?: number;
  within?: LocatorSpecInput;
}

/** A non-empty list, as `z.enum` needs it. */
export type NonEmpty<T> = readonly [T, ...T[]];

export const DEFAULT_MODAL_PICK_MODES: NonEmpty<string> = ['radio', 'checkAll', 'exactRow', 'exactCell'];

/** `TC-ORD-U01 / A2` — the default of `ids.checkRef` in the project config. */
export const DEFAULT_CHECK_REF_PATTERN = /^TC-[A-Z0-9-]+ \/ A\d+[a-z]?$/;

export interface UiToolSchemaOptions {
  fields: UiMcpFieldText;
  /** `ui_assert.testId` must match; keeps the assertion-id chain (step doc -> report -> stored check) intact. */
  checkRefPattern?: RegExp;
  authModes?: NonEmpty<string>;
  defaultAuthMode?: string;
  modalPickModes?: NonEmpty<string>;
}

/** Input schemas of the UI tools, with descriptions and validation messages taken from `fields`. */
export function createUiToolSchemas(options: UiToolSchemaOptions) {
  const f = options.fields;
  const authModes = options.authModes ?? ['storage', 'form', 'none'];
  const defaultAuthMode = options.defaultAuthMode ?? authModes[0];
  const modalPickModes = options.modalPickModes ?? DEFAULT_MODAL_PICK_MODES;

  /**
   * Locator strategies, in the driver's resolution order. `domId` first: many apps label controls
   * with `id` but carry `data-testid` on only a few screens, so testid-first fails on most pages.
   */
  const LocatorSpecSchema: z.ZodType<LocatorSpecInput> = z.lazy(() =>
    z
      .object({
        domId: z.string().optional().describe(f.locatorDomId),
        testId: z.string().optional().describe(f.locatorTestId),
        role: z.string().optional().describe(f.locatorRole),
        name: z.string().optional().describe(f.locatorName),
        label: z.string().optional().describe(f.locatorLabel),
        placeholder: z.string().optional(),
        text: z.string().optional().describe(f.locatorText),
        css: z.string().optional().describe(f.locatorCss),
        nth: z.number().int().nonnegative().optional().describe(f.locatorNth),
        within: LocatorSpecSchema.optional().describe(f.locatorWithin),
      })
      .refine((s) => Boolean(s.domId || s.testId || s.role || s.label || s.placeholder || s.text || s.css), f.locatorRequired),
  );

  /** What to wait for after an action, so a step ends in a known state. */
  const ExpectSchema = z
    .object({
      requestUrlContains: z.string().optional().describe(f.expectRequestUrlContains),
      requestMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      urlContains: z.string().optional(),
      textVisible: z.string().optional(),
      networkIdle: z.boolean().optional(),
      settled: z.boolean().optional().describe(f.expectSettled),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
    })
    .optional();

  return {
    LocatorSpecSchema,
    ExpectSchema,
    OpenSessionSchema: z.object({
      authMode: z
        .enum(authModes as [string, ...string[]])
        .default(defaultAuthMode)
        .describe(f.openSessionAuthMode),
    }),
    OpenScreenSchema: z.object({
      path: z.string().describe(f.openScreenPath),
      expect: ExpectSchema,
    }),
    DescribeScreenSchema: z.object({
      within: LocatorSpecSchema.optional().describe(f.describeWithin),
      limit: z.number().int().positive().max(200).default(60),
    }),
    ActSchema: z.object({
      action: z.enum(['click', 'fill', 'press', 'select', 'switchTab', 'gotoPage', 'pickInModal', 'confirmModal', 'closeModal']),
      target: LocatorSpecSchema.optional().describe(f.actTarget),
      value: z.string().optional().describe(f.actValue),
      tabLabel: z.string().optional().describe(f.actTabLabel),
      pageNumber: z.number().int().positive().optional().describe(f.actPageNumber),
      modalPickMode: z
        .enum(modalPickModes as [string, ...string[]])
        .optional()
        .describe(f.actModalPickMode),
      modalKeyword: z.string().optional().describe(f.actModalKeyword),
      confirmLabel: z.string().optional().describe(f.actConfirmLabel),
      expect: ExpectSchema,
      reason: z.string().min(1).describe(f.actReason),
    }),
    ReadGridSchema: z.object({
      columns: z.array(z.string()).min(1).describe(f.readGridColumns),
      within: LocatorSpecSchema.optional(),
      maxRows: z.number().int().positive().max(500).optional(),
    }),
    AssertSchema: z.object({
      testId: z.string().regex(options.checkRefPattern ?? DEFAULT_CHECK_REF_PATTERN, f.assertCheckRefFormat),
      label: z.string().min(1).describe(f.assertLabel),
      expected: z.union([z.string(), z.number(), z.boolean()]),
      actual: z.union([z.string(), z.number(), z.boolean()]),
    }),
    CaptureEvidenceSchema: z.object({
      kind: z.enum(['screenshot', 'dom_snapshot', 'grid_snapshot']).default('screenshot'),
      label: z.string().min(1).describe(f.captureLabel),
      checkTestId: z.string().optional().describe(f.captureCheckTestId),
    }),
    FinishRunSchema: z.object({
      scenario: z.string().min(1).describe(f.finishScenario),
      testCaseId: z.string().min(1),
      testCaseName: z.string().min(1),
      objective: z.string().min(1),
      highlights: z.array(z.string()).optional(),
    }),
    CloseSessionSchema: z.object({
      passed: z.boolean().default(false).describe(f.closePassed),
    }),
  };
}

export type UiToolSchemas = ReturnType<typeof createUiToolSchemas>;
