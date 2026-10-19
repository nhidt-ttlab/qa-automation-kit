import path from 'node:path';
import { newRunId, type CheckResult, type EvidenceStore, type RequestTraceEntry } from '@qakit/core';
import type { UiDriver } from '@qakit/ui';
import { AuditLog } from './audit.js';

/** The browser a session drives — `createBrowserRuntime` plus the evidence store it writes to. */
export interface UiMcpRuntime<Mode extends string = string, D extends UiDriver = UiDriver> {
  ui(options?: { authMode?: Mode }): Promise<D>;
  evidence: EvidenceStore;
  networkTrace(): RequestTraceEntry[];
  close(passed: boolean): Promise<void>;
  evidenceDirDisplay(): string;
}

export interface OpenRuntimeArgs<Mode extends string = string> {
  scenario: string;
  runId: string;
  authMode: Mode;
  allowWrites: boolean;
}

export interface UiMcpSessionOptions<Mode extends string = string, D extends UiDriver = UiDriver> {
  openRuntime(args: OpenRuntimeArgs<Mode>): Promise<UiMcpRuntime<Mode, D>>;
  allowWrites: boolean;
  /** Audit logs go to `<auditRoot>/mcp-sessions/<runId>/audit.jsonl`. */
  auditRoot: string;
  noSessionMessage: string;
  scenario?: string;
}

/**
 * One agent-driven browser session.
 *
 * Deliberately explicit: `ui_open_session` starts it, `ui_close_session` ends it, and three
 * independent safety nets close it otherwise (SIGTERM/SIGINT, stdin EOF, idle timeout — see
 * `serveUiMcpOverStdio`). The alternative, an implicitly-created long-lived browser, leaks a
 * Chromium per client disconnect on Windows, because a stdio server cannot reliably reap a
 * grandchild process when its parent shell is killed.
 *
 * Deterministic scenario runs do NOT share this session: they build their own runtime with a
 * fresh context per run. A scenario's value is its clean starting state, which a browser an
 * agent has been exploring in cannot provide.
 */
export class UiMcpSession<Mode extends string = string, D extends UiDriver = UiDriver> {
  private runtime?: UiMcpRuntime<Mode, D>;
  private driverPromise?: Promise<D>;
  private lastActivityAt = Date.now();

  readonly runId = newRunId();
  readonly scenario: string;
  readonly audit: AuditLog;

  /** Checks accumulated across tool calls, assembled by `ui_finish_run`. */
  readonly checks: CheckResult[] = [];

  constructor(private readonly options: UiMcpSessionOptions<Mode, D>) {
    this.scenario = options.scenario ?? 'ui-mcp-session';
    this.audit = new AuditLog(path.join(options.auditRoot, 'mcp-sessions', this.runId, 'audit.jsonl'));
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  get idleMs(): number {
    return Date.now() - this.lastActivityAt;
  }

  get isOpen(): boolean {
    return this.runtime !== undefined;
  }

  async open(authMode: Mode): Promise<D> {
    if (!this.runtime) {
      this.runtime = await this.options.openRuntime({
        scenario: this.scenario,
        runId: this.runId,
        authMode,
        allowWrites: this.options.allowWrites,
      });
    }
    this.driverPromise ??= this.runtime.ui({ authMode });
    this.touch();
    return this.driverPromise;
  }

  /** Throws a message aimed at the agent, not a stack trace. */
  async requireDriver(): Promise<D> {
    if (!this.driverPromise) throw new Error(this.options.noSessionMessage);
    this.touch();
    return this.driverPromise;
  }

  get uiRuntime(): UiMcpRuntime<Mode, D> | undefined {
    return this.runtime;
  }

  /** Closes the browser and flushes evidence. Safe to call repeatedly. Returns the evidence folder, if a browser was open. */
  async close(passed: boolean): Promise<string | undefined> {
    const runtime = this.runtime;
    this.runtime = undefined;
    this.driverPromise = undefined;
    const evidenceDir = runtime?.evidenceDirDisplay();
    await runtime?.close(passed);
    return evidenceDir;
  }
}
