import type { BrowserContext, Request } from 'playwright';
import type { WebTarget } from './types.js';
import type { BlockedRequestRegistry } from './blocked-registry.js';

export interface GuardOptions {
  web: WebTarget;
  /**
   * Opt in to mutations. Default false — see the class comment on why this is not a
   * per-agent decision.
   */
  allowWrites?: boolean;
  /**
   * POST endpoints that only READ, let through in read-only mode. Opt-in per scenario, never a
   * default: each entry must be a lookup verified read-only on the backend (e.g. `/api/Phase/list`
   * is `PhaseController.GetListAsync`). Matched as a substring of the URL *path* only — a host
   * cannot be declared, so an entry can never open a whole service.
   */
  postLookups?: string[];
  /** Where deliberate aborts are recorded, so they aren't mistaken for product failures. */
  blocked?: BlockedRequestRegistry;
}

/** Requests the app must be allowed to make even in read-only mode, when `web.authPaths` names none. */
const AUTH_PATHS = [/\/connect\/token$/, /\/connect\/authorize/];

function authPathsOf(web: WebTarget): RegExp[] {
  return web.authPaths ? web.authPaths.map((source) => new RegExp(source)) : AUTH_PATHS;
}

/** The sign-in page's own address: a form posted to it carries the password. */
function isLoginPath(url: string, loginPath: string): boolean {
  const normalize = (path: string): string => path.replace(/\/+$/, '').toLowerCase();
  try {
    return normalize(new URL(url).pathname) === normalize(loginPath);
  } catch {
    return false;
  }
}

/**
 * True for a request whose body holds a password, a client secret, a code or a token: one to an auth
 * path or to the sign-in page. Such a body is never read into the blocked-request registry, which ends up
 * in the run's evidence — not when the guard blocks the request for its host, and not when it blocks a
 * sign-in form in read-only mode.
 */
function carriesCredentials(url: string, web: WebTarget, authPaths: RegExp[] = authPathsOf(web)): boolean {
  return authPaths.some((pattern) => pattern.test(url)) || isLoginPath(url, web.loginPath);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function isAllowedHost(url: string, allowed: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** POST only — a declared lookup path never opens PUT/PATCH/DELETE on the same route. */
function isDeclaredPostLookup(method: string, url: string, lookups: string[]): boolean {
  if (method !== 'POST' || lookups.length === 0) return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return lookups.some((entry) => entry.trim().length > 0 && pathname.includes(entry));
}

/**
 * Reads the body the page was about to send, immediately before the request is aborted
 * (plan `plan-vai-tro-phan-quyen-scenario-scripts.md` §3.5).
 *
 * ⚠️ **This does not let the request through.** `route.abort()` still runs, unchanged, on the very
 * next line of every caller. `request.postData()` is a synchronous read of a buffer Playwright
 * already holds; nothing here can reach the network.
 *
 * Why it exists: on a screen that writes on every toggle, the ONLY observable form of the rule
 * ("checking a child also grants its parent", "clearing the default clears the whole row") is the
 * payload. Without this, those assertions had to ship `NOT_EVALUATED` for a reason that was never
 * about the product — the harness simply could not see what the page intended to send.
 *
 * Returns `null` when there is no readable body: a `GET`, a binary or multipart body Playwright
 * cannot decode as text, or one too large to buffer. `null` therefore means **"could not read"**,
 * never "the page sent nothing" — an oracle that conflates the two turns a broken measurement into
 * a false FAIL.
 *
 * The try/catch is deliberate rather than defensive habit: a guard that throws aborts nothing, so
 * without it the read-only guarantee would hang on a diagnostic nicety succeeding.
 *
 * 🚫 Never called for a request that `carriesCredentials`: the body of `/connect/token` or of a sign-in
 * form holds the password, and the registry is written to the evidence folder. Anyone editing the guard
 * must keep it so.
 */
function readPostData(request: Request): string | null {
  try {
    return request.postData();
  } catch {
    return null;
  }
}

/**
 * Playwright rejects a `continue()`/`abort()` whose request no longer exists. Two races produce
 * this through no fault of the scenario:
 *
 * - **The request was already handled.** A page-level route can settle a request the context guard
 *   is still holding (`fallback()` hands it on, and the handler that resumes afterwards loses the
 *   race), and Playwright itself settles outstanding routes when a navigation cancels them.
 * - **The page, context or browser closed** while the handler was awaiting — a reload, a
 *   `close()`, or a worker terminating with its tab.
 *
 * The handler is `async`, so such a rejection surfaces as an **unhandled promise rejection**, which
 * takes down the whole process: no report is written and the scenario's `finally` cleanup never
 * runs, stranding live test data. That failure mode is strictly worse than the race it reports.
 *
 * Swallowing these does not weaken either control. `blocked.record(...)` happens *before* the
 * abort, so a blocked request is still reported; and a request that is already handled or whose
 * page is gone cannot be let through by this guard — there is nothing left to allow. Anything not
 * on this list rethrows, so a real routing bug still fails loudly.
 */
const SETTLED_ROUTE_ERRORS = [
  'Route is already handled',
  'Target page, context or browser has been closed',
  'Target closed',
  'Browser has been closed',
];

function isSettledRouteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return SETTLED_ROUTE_ERRORS.some((known) => message.includes(known));
}

/** Runs a route action, tolerating only the races in {@link SETTLED_ROUTE_ERRORS}. */
async function settleRoute(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isSettledRouteError(error)) throw error;
  }
}

/**
 * Two independent controls, both enforced at the Playwright route layer so neither can be
 * talked out of by an agent's reasoning:
 *
 * 1. Domain allowlist — the browser may only reach hosts in `web.allowedHosts`. Enforced
 *    here as well as at the MCP tool boundary, because a redirect can walk a session
 *    off-list without any tool call being made.
 *
 * 2. Read-only by default — every non-GET to a non-auth endpoint is aborted. Shared test
 *    environments usually run on a handful of shared accounts, and a browser poking at a create
 *    form has no single chokepoint that stamps a test-data marker on what it writes — so anything
 *    it creates is unmarked data that other scenarios then discover. A scenario that genuinely
 *    needs to write opts in explicitly and owns its cleanup.
 */
export async function installGuards(context: BrowserContext, options: GuardOptions): Promise<void> {
  const { web, allowWrites = false, postLookups = [], blocked } = options;
  const authPaths = authPathsOf(web);

  await context.route('**', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    const body = (): string | null => (carriesCredentials(url, web, authPaths) ? null : readPostData(request));

    if (!isAllowedHost(url, web.allowedHosts)) {
      blocked?.record(method, url, 'host not in allowedHosts', body());
      await settleRoute(() => route.abort('blockedbyclient'));
      return;
    }

    if (
      !allowWrites &&
      !SAFE_METHODS.has(method) &&
      !authPaths.some((p) => p.test(url)) &&
      !isDeclaredPostLookup(method, url, postLookups)
    ) {
      blocked?.record(method, url, 'read-only mode (set allowWrites to opt in)', body());
      await settleRoute(() => route.abort('blockedbyclient'));
      return;
    }

    await settleRoute(() => route.continue());
  });
}

/** Exported for the guard unit test — keeps the allowlist semantics pinned. */
export const __testing = { isAllowedHost, isDeclaredPostLookup, SAFE_METHODS, AUTH_PATHS, authPathsOf, carriesCredentials, isSettledRouteError, settleRoute };
