import type { WebTarget } from '@qakit/ui';
import { englishUiMcpText, type UiMcpDenyText } from './text.js';

/**
 * Guard rails for the agent-facing tool surface.
 *
 * These sit ON TOP of the route-level guards in `@qakit/ui` (`installGuards`), not instead of them.
 * The route handler is what actually makes an escape impossible (a redirect can reach a host no
 * tool call ever named); this layer exists so a denial is *explained* to the agent and *recorded*
 * in the audit log, rather than surfacing as an opaque network abort.
 */
export interface UiPolicyConfig {
  web: WebTarget;
  /** Tool names the agent may call. A disabled tool is never registered, so it isn't listed. */
  enabledTools?: string[];
  /** Opt in to mutations. Off by default — see `installGuards` for why. */
  allowWrites?: boolean;
  /** Allow clicking controls whose label looks destructive. Requires allowWrites too. */
  allowDestructive?: boolean;
  maxActionsPerSession?: number;
  maxSessionMs?: number;
  /** Never let this value be typed into the page or echoed back through a tool result. */
  secretValues?: string[];
  /** Labels of actions that mutate or approve records. Defaults to English; a locale pack adds its own words. */
  destructiveLabel?: RegExp;
  text?: UiMcpDenyText;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

const ALLOWED = { allowed: true } as const;

/** Matched against a control's accessible name, id, the value typed and the confirm label chosen. */
export const ENGLISH_DESTRUCTIVE_LABEL = /delete|remove|cancel|approve|submit/i;

export class UiPolicy {
  private actionCount = 0;
  private startedAt = Date.now();
  private readonly text: UiMcpDenyText;
  private readonly destructiveLabel: RegExp;

  constructor(private readonly config: UiPolicyConfig) {
    this.text = config.text ?? englishUiMcpText.deny;
    this.destructiveLabel = config.destructiveLabel ?? ENGLISH_DESTRUCTIVE_LABEL;
  }

  /**
   * Opens a new budget window. Called by `ui_open_session`, which is the only event that
   * legitimately starts one.
   *
   * The policy is constructed once per MCP-server *process*, but the budget it enforces is
   * per-*session*. Measured from process start instead, `checkBudget()` would deny every tool
   * roughly ten minutes after boot — `ui_open_session` included, a lockout no agent could recover
   * from. Within a session the guard rail is unchanged, and reopening a session to earn a fresh
   * window costs a real browser launch and a re-login, so it is not a cheap way around the budget.
   */
  startSession(): void {
    this.actionCount = 0;
    this.startedAt = Date.now();
  }

  get allowWrites(): boolean {
    return this.config.allowWrites === true;
  }

  isToolEnabled(name: string): boolean {
    return this.config.enabledTools === undefined || this.config.enabledTools.includes(name);
  }

  /** Host must be on the allowlist. Dot-boundary suffix match — `evil-app.example` must not pass for `app.example`. */
  checkNavigation(url: string): PolicyDecision {
    let host: string;
    try {
      host = new URL(url, this.config.web.baseUrl).host;
    } catch {
      return { allowed: false, reason: this.text.unparseableUrl(url) };
    }
    const ok = this.config.web.allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
    return ok ? ALLOWED : { allowed: false, reason: this.text.hostNotAllowed(host, this.config.web.allowedHosts) };
  }

  /**
   * Denies clicks on controls that look like they mutate or approve a record.
   *
   * Deliberately matched on the *label the user sees* rather than on the request, because by
   * the time a request exists the click has already happened — a confirm dialog may have been
   * dismissed, or an optimistic UI update already applied.
   */
  checkDestructive(descriptor: string): PolicyDecision {
    if (this.config.allowDestructive === true && this.allowWrites) return ALLOWED;
    if (!this.destructiveLabel.test(descriptor)) return ALLOWED;
    return { allowed: false, reason: this.text.destructive(descriptor) };
  }

  /** A secret must never be typed into the page, where it could be echoed back in a result. */
  checkValue(value: string | undefined): PolicyDecision {
    if (!value) return ALLOWED;
    const hit = (this.config.secretValues ?? []).some((secret) => secret.length > 0 && value.includes(secret));
    return hit ? { allowed: false, reason: this.text.secretValue } : ALLOWED;
  }

  /** Stops a runaway agent loop from grinding against the target indefinitely. */
  checkBudget(): PolicyDecision {
    const maxActions = this.config.maxActionsPerSession ?? 200;
    const maxMs = this.config.maxSessionMs ?? 10 * 60_000;
    if (this.actionCount >= maxActions) {
      return { allowed: false, reason: this.text.actionBudget(maxActions) };
    }
    if (Date.now() - this.startedAt > maxMs) {
      return { allowed: false, reason: this.text.timeBudget(Math.round(maxMs / 60_000)) };
    }
    return ALLOWED;
  }

  recordAction(): void {
    this.actionCount += 1;
  }

  get actionsUsed(): number {
    return this.actionCount;
  }
}
