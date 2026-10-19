import type { BrowserContext, Page } from 'playwright';
import type { BlockedRequestRegistry } from './blocked-registry.js';
import { type UiDiagnostics, emptyDiagnostics } from './types.js';

/**
 * Collects everything the browser reports that the DOM does not: uncaught exceptions,
 * requests that never completed, and HTTP error responses.
 *
 * IMPORTANT — what "console errors" is worth against a deployed build: many production
 * bundlers are configured to strip `console.*` calls (e.g. terser's `drop_console`), so
 * `consoleErrors` can be empty on a test environment even when the app is genuinely
 * misbehaving, and only fills up against a local dev build. `pageErrors` (uncaught
 * exceptions) survives minification and is the signal to assert on. Scenarios should prefer
 * `checkNoPageErrors` over `checkNoConsoleErrors` for anything running against a deployment.
 */
export class DiagnosticsCollector {
  private readonly diagnostics: UiDiagnostics = emptyDiagnostics();

  constructor(private readonly blocked?: BlockedRequestRegistry) {}

  attach(page: Page): void {
    page.on('console', (message) => {
      const type = message.type();
      if (type !== 'error' && type !== 'warning') return;
      const location = message.location();
      const entry = {
        type,
        text: message.text(),
        location: location.url ? `${location.url}:${location.lineNumber}` : undefined,
        timestamp: new Date().toISOString(),
      };
      if (type === 'error') this.diagnostics.consoleErrors.push(entry);
      else this.diagnostics.consoleWarnings.push(entry);
    });

    page.on('pageerror', (error) => {
      this.diagnostics.pageErrors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    });

    page.on('requestfailed', (request) => {
      // A request the guards aborted on purpose is not a product failure. Checked against
      // the registry rather than the Chromium error string, which would also swallow a
      // genuine ERR_BLOCKED_BY_CLIENT from something else.
      if (this.blocked?.has(request.method(), request.url())) return;
      this.diagnostics.failedRequests.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText,
        timestamp: new Date().toISOString(),
      });
    });

    page.on('response', (response) => {
      if (response.status() < 400) return;
      this.diagnostics.httpErrorResponses.push({
        url: response.url(),
        status: response.status(),
        timestamp: new Date().toISOString(),
      });
    });

    // An unexpected window.confirm/alert blocks the page forever in Playwright unless
    // something handles it. Dismiss and record rather than hang the run.
    //
    // `beforeunload` is the one type where dismissing is the wrong default: dismissing it means
    // "stay on this page", so it *cancels* the navigation the scenario just asked for and
    // `page.reload()`/`goto()`/`close()` hangs until it times out — the same hang this handler
    // exists to prevent, only harder to read, because the failure surfaces on the navigation call
    // rather than on the dialog. Accepting is what a user who clicks "Leave" does, and it is the
    // only reading under which a test can exercise an app that warns before losing work. The
    // dialog is recorded either way, so a scenario can still assert that the warning appeared.
    page.on('dialog', (dialog) => {
      this.diagnostics.dialogs.push({
        type: dialog.type(),
        message: dialog.message(),
        timestamp: new Date().toISOString(),
      });
      const settled = dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
      void settled.catch(() => undefined);
    });
  }

  attachContext(context: BrowserContext): void {
    context.on('page', (page) => this.attach(page));
  }

  snapshot(): UiDiagnostics {
    return {
      consoleErrors: [...this.diagnostics.consoleErrors],
      consoleWarnings: [...this.diagnostics.consoleWarnings],
      pageErrors: [...this.diagnostics.pageErrors],
      failedRequests: [...this.diagnostics.failedRequests],
      httpErrorResponses: [...this.diagnostics.httpErrorResponses],
      dialogs: [...this.diagnostics.dialogs],
      blockedRequests: this.blocked?.list() ?? [],
    };
  }

  /** Live counts for a step record, without cloning the whole payload each time. */
  counts(): { pageErrors: number; consoleErrors: number; failedRequests: number } {
    return {
      pageErrors: this.diagnostics.pageErrors.length,
      consoleErrors: this.diagnostics.consoleErrors.length,
      failedRequests: this.diagnostics.failedRequests.length,
    };
  }
}
