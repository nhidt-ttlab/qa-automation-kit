import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { check, type PersistRunMeta, type ReportableResult, type RequestTraceEntry } from '@qakit/core';
import { describeLocator, mergeTraces, resolveLocator, type LocatorSpec, type UiDriver } from '@qakit/ui';
import type { UiPolicy } from './policy.js';
import type { UiToolSchemas } from './schemas.js';
import type { UiMcpSession } from './session.js';
import type { UiMcpText, UiToolName } from './text.js';

/**
 * Minimal element surface for the `evaluateAll` callback below, which is serialized and runs
 * in the page. Declared locally rather than adding "DOM" to the tsconfig `lib`, which would let
 * genuinely Node-side code reference browser globals by accident.
 */
interface PageElement {
  tagName: string;
  id: string;
  textContent: string | null;
  disabled?: boolean;
  placeholder?: string;
  getAttribute(name: string): string | null;
}

export interface UiRunWriteContext {
  trace: RequestTraceEntry[];
  runId: string;
  meta: PersistRunMeta;
  /** Manifest of the session's evidence folder. */
  evidenceManifestPath?: string;
}

export interface UiRunWriteResult {
  reportPath: string;
  outputPath: string;
  /** The stored run id, when the run reached the store. */
  runId?: string;
}

/** Writes the report files for a finished agent run and stores it. See `createRunWriter`. */
export type UiRunWriter = (result: ReportableResult, context: UiRunWriteContext) => UiRunWriteResult | Promise<UiRunWriteResult>;

function asToolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export interface UiToolDeps<Mode extends string = string, D extends UiDriver = UiDriver> {
  session: UiMcpSession<Mode, D>;
  policy: UiPolicy;
  text: UiMcpText;
  schemas: UiToolSchemas;
  writeRun: UiRunWriter;
  /** Environment name stored with a finished run. */
  environment: string;
  /** Counted by `ui_describe_screen` as `gridCount`. */
  gridSelector: string;
}

/**
 * Nine high-level tools, sized so ONE step-matrix row maps to ONE tool call.
 *
 * The alternative — a tool per Playwright primitive — lets the model invent its own step
 * decomposition, which is exactly what makes agent-driven UI tests unreproducible. Keeping the
 * granularity at the step level means an agent-produced run and a hand-coded scenario describe
 * the same thing, and `ui_finish_run` can emit the identical `ReportableResult`.
 */
export function registerUiTools<Mode extends string, D extends UiDriver>(server: McpServer, deps: UiToolDeps<Mode, D>): void {
  const { session, policy, text, schemas } = deps;

  const guarded = async <T>(
    tool: UiToolName,
    input: unknown,
    reason: string | undefined,
    run: () => Promise<T>,
  ): Promise<ReturnType<typeof asToolResult>> => {
    const startedAt = Date.now();
    const budget = policy.checkBudget();
    if (!budget.allowed) {
      session.audit.record({ tool, input, reason, outcome: 'denied', denyReason: budget.reason });
      return asToolResult({ ok: false, denied: true, reason: budget.reason });
    }
    try {
      const value = await run();
      policy.recordAction();
      session.audit.record({ tool, input, reason, outcome: 'ok', durationMs: Date.now() - startedAt });
      return asToolResult(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.audit.record({ tool, input, reason, outcome: 'error', denyReason: message, durationMs: Date.now() - startedAt });
      return asToolResult({ ok: false, error: message });
    }
  };

  const deny = (tool: UiToolName, input: unknown, reason: string): ReturnType<typeof asToolResult> => {
    session.audit.record({ tool, input, outcome: 'denied', denyReason: reason });
    return asToolResult({ ok: false, denied: true, reason });
  };

  const register = (name: UiToolName, schema: { shape: object }, handler: (args: never) => unknown): void => {
    if (!policy.isToolEnabled(name)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).tool(name, text.tools[name], (schema as any).shape, handler);
  };

  const requireTarget = (target: LocatorSpec | undefined): LocatorSpec => {
    if (!target) throw new Error(text.errors.needTarget);
    return target;
  };

  const requireValue = (value: string | undefined): string => {
    if (value === undefined) throw new Error(text.errors.needValue);
    return value;
  };

  register('ui_open_session', schemas.OpenSessionSchema, async (args: { authMode: Mode }) => {
    // Before `guarded`, because `guarded` is what enforces the budget: opening a session is the
    // event that *starts* a budget window, so it must not be gated on the previous one. Gating it
    // made an expired window unrecoverable — see UiPolicy.startSession.
    policy.startSession();
    return guarded('ui_open_session', args, undefined, async () => {
      const driver = await session.open(args.authMode);
      return {
        ok: true,
        runId: session.runId,
        url: driver.page.url(),
        readOnly: !policy.allowWrites,
        note: policy.allowWrites ? text.sessionWritable : text.sessionReadOnly,
      };
    });
  });

  register('ui_open_screen', schemas.OpenScreenSchema, async (args: { path: string; expect?: Record<string, unknown> }) => {
    const decision = policy.checkNavigation(args.path);
    if (!decision.allowed) return deny('ui_open_screen', args, decision.reason!);
    return guarded('ui_open_screen', args, undefined, async () => {
      const driver = await session.requireDriver();
      await driver.goto(args.path, undefined, args.expect as never);
      return { ok: true, url: driver.page.url() };
    });
  });

  register('ui_describe_screen', schemas.DescribeScreenSchema, async (args: { within?: LocatorSpec; limit: number }) =>
    guarded('ui_describe_screen', args, undefined, async () => {
      const driver = await session.requireDriver();
      const scope = args.within ? (await resolveLocator(driver.page, args.within)).locator : driver.page;
      const elements = await scope
        .locator('button, a[href], input, select, textarea, [role="tab"], [role="button"]')
        .evaluateAll(
          (nodes, limit) =>
            nodes.slice(0, limit as number).map((node) => {
              const el = node as unknown as PageElement;
              return {
                tag: el.tagName.toLowerCase(),
                role: el.getAttribute('role') ?? undefined,
                name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 80) || undefined,
                domId: el.id || undefined,
                testId: el.getAttribute('data-testid') ?? undefined,
                placeholder: el.placeholder || undefined,
                disabled: el.disabled === true || undefined,
              };
            }),
          args.limit,
        );
      const grids = await driver.page.locator(deps.gridSelector).count();
      return { ok: true, url: driver.page.url(), elements, gridCount: grids, hint: text.describeHint };
    }),
  );

  register(
    'ui_act',
    schemas.ActSchema,
    async (args: {
      action: string;
      target?: LocatorSpec;
      value?: string;
      tabLabel?: string;
      pageNumber?: number;
      modalPickMode?: string;
      modalKeyword?: string;
      confirmLabel?: string;
      expect?: Record<string, unknown>;
      reason: string;
    }) => {
      const secret = policy.checkValue(args.value);
      if (!secret.allowed) return deny('ui_act', { ...args, value: '[REDACTED]' }, secret.reason!);

      // Destructive check runs on the label BEFORE the click: once a request exists, the
      // click already happened and an optimistic UI update may already be applied.
      //
      // confirmLabel is in here deliberately. A picker's plain "OK" is benign and passes, while
      // "Approve" / "Submit" on the same modal machinery is exactly what the policy is meant to
      // stop — so the label the agent chose has to be part of the descriptor.
      const descriptor = [args.target ? describeLocator(args.target) : '', args.tabLabel ?? '', args.value ?? '', args.confirmLabel ?? '']
        .filter(Boolean)
        .join(' ');
      const destructive = policy.checkDestructive(descriptor);
      if (!destructive.allowed) return deny('ui_act', args, destructive.reason!);

      return guarded('ui_act', args, args.reason, async () => {
        const driver = await session.requireDriver();
        const expect = args.expect as never;
        switch (args.action) {
          case 'click':
            await driver.click(requireTarget(args.target), undefined, expect);
            break;
          case 'fill':
            await driver.fill(requireTarget(args.target), requireValue(args.value), undefined, expect);
            break;
          case 'press':
            await driver.press(requireTarget(args.target), requireValue(args.value), undefined, expect);
            break;
          case 'select':
            await driver.selectOption(requireTarget(args.target), requireValue(args.value), undefined, expect);
            break;
          case 'switchTab':
            await driver.switchTab(requireValue(args.tabLabel), expect);
            break;
          case 'gotoPage':
            if (args.pageNumber === undefined) throw new Error(text.errors.needPageNumber);
            await driver.gotoPage(args.pageNumber, expect);
            break;
          case 'pickInModal':
            if (args.modalPickMode === undefined) throw new Error(text.errors.needModalPickMode);
            await driver.pickInModal({ mode: args.modalPickMode, keyword: args.modalKeyword, confirmLabel: args.confirmLabel }, undefined, expect);
            break;
          case 'confirmModal':
            await driver.confirmModal(args.confirmLabel, undefined, expect);
            break;
          case 'closeModal':
            await driver.closeModal();
            break;
          default:
            throw new Error(text.errors.unsupportedAction(args.action));
        }
        const lastStep = driver.recordedSteps().at(-1);
        return { ok: true, url: driver.page.url(), step: lastStep?.title, resolvedBy: lastStep?.data.locator?.resolvedBy };
      });
    },
  );

  register('ui_read_grid', schemas.ReadGridSchema, async (args: { columns: string[]; within?: LocatorSpec; maxRows?: number }) =>
    guarded('ui_read_grid', args, undefined, async () => {
      const driver = await session.requireDriver();
      const snapshot = await driver.readGrid(args);
      return { ok: true, ...snapshot };
    }),
  );

  register(
    'ui_assert',
    schemas.AssertSchema,
    async (args: { testId: string; label: string; expected: string | number | boolean; actual: string | number | boolean }) =>
      guarded('ui_assert', args, undefined, async () => {
        const result = check(args.label, args.expected, args.actual, args.testId);
        session.checks.push(result);
        return { ok: true, passed: result.passed, testId: args.testId, expected: args.expected, actual: args.actual };
      }),
  );

  register('ui_capture_evidence', schemas.CaptureEvidenceSchema, async (args: { kind: string; label: string; checkTestId?: string }) =>
    guarded('ui_capture_evidence', args, undefined, async () => {
      const driver = await session.requireDriver();
      if (args.kind === 'dom_snapshot') {
        const html = await driver.page.content();
        const item = session.uiRuntime?.evidence.writeAndRegister('dom_snapshot', `dom-${Date.now().toString(36)}.html`, html, args.label, {
          checkTestId: args.checkTestId,
        });
        return { ok: true, relPath: item?.relPath };
      }
      const relPath = await driver.screenshot(args.label, { checkTestId: args.checkTestId });
      return { ok: true, relPath };
    }),
  );

  register(
    'ui_finish_run',
    schemas.FinishRunSchema,
    async (args: { scenario: string; testCaseId: string; testCaseName: string; objective: string; highlights?: string[] }) =>
      guarded('ui_finish_run', args, undefined, async () => {
        const driver = await session.requireDriver();
        const evaluated = session.checks.filter((c) => c.expected !== 'NOT_EVALUATED');
        const passed = evaluated.length > 0 && evaluated.every((c) => c.passed);

        const result = {
          scenario: args.scenario,
          dryRun: false,
          passed,
          checks: session.checks,
          steps: driver.recordedSteps(),
          overview: {
            testCaseId: args.testCaseId,
            testCaseName: args.testCaseName,
            objective: args.objective,
            keyData: text.finishKeyData(session.runId, session.checks.length),
            highlights: args.highlights,
          },
        } as ReportableResult;

        const written = await deps.writeRun(result, {
          trace: mergeTraces(driver.networkTrace()),
          runId: session.runId,
          meta: { environment: deps.environment, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
          evidenceManifestPath: session.uiRuntime?.evidence.manifestPath,
        });
        return {
          ok: true,
          passed,
          reportPath: written.reportPath,
          outputPath: written.outputPath,
          runId: written.runId ?? session.runId,
          auditLog: session.audit.path,
          review: text.reviewHint,
        };
      }),
  );

  register('ui_close_session', schemas.CloseSessionSchema, async (args: { passed: boolean }) =>
    guarded('ui_close_session', args, undefined, async () => {
      const evidence = await session.close(args.passed);
      return { ok: true, evidence, auditLog: session.audit.path };
    }),
  );
}
