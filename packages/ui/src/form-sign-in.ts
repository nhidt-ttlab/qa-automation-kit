import type { Page } from 'playwright';

/**
 * Browser sign-in through a page with one form holding the username and the password — an identity
 * provider's sign-in page, or an application's own. Selectors are structural, not tied to field names:
 * the form that has a password field, its first text or email field, its submit button.
 *
 * The form is a POST, so a read-only run blocks it unless the page's path is in `web.postLookups`.
 */
const FORM = 'form:has(input[type="password"])';
const PASSWORD = `${FORM} input[type="password"]`;
const USERNAME = `${FORM} input[type="email"], ${FORM} input[type="text"]`;
const SUBMIT = `${FORM} button[type="submit"], ${FORM} input[type="submit"]`;

export interface FormSignInOptions {
  username: string;
  password: string;
  timeoutMs?: number;
}

/** What the kit hands `browser.loginViaForm` when a session opens with `authMode: form`. */
export interface FormLoginOptions extends FormSignInOptions {
  webBaseUrl: string;
  loginPath: string;
}

/** True when the page shows a sign-in form. */
export async function onSignInPage(page: Page): Promise<boolean> {
  return (await page.locator(PASSWORD).count()) > 0;
}

/**
 * Fills and submits the sign-in form the page is showing, then waits until the form is gone: either the
 * application the user came from, or the provider's own page after a direct sign-in.
 */
export async function submitSignInForm(page: Page, options: FormSignInOptions): Promise<void> {
  const timeout = options.timeoutMs ?? 30_000;
  await page.locator(PASSWORD).waitFor({ state: 'visible', timeout });
  await page.locator(USERNAME).first().fill(options.username);
  await page.locator(PASSWORD).fill(options.password);
  await page.locator(SUBMIT).first().click();
  try {
    await page.waitForFunction((selector) => document.querySelector(selector) === null, PASSWORD, { timeout });
  } catch {
    // The password is deliberately not part of the message.
    throw new Error(`Sign-in as "${options.username}" did not leave the sign-in page: the credentials were rejected or the page did not respond.`);
  }
}

/**
 * Ready-made `browser` hooks for a project adapter whose sign-in page is such a form:
 * `browser: formSignInBrowserHooks()`.
 */
export function formSignInBrowserHooks(): {
  loginViaForm(page: Page, options: FormLoginOptions): Promise<void>;
  verifyLoggedIn(page: Page, loginPath: string): Promise<{ ok: boolean; reason?: string }>;
} {
  return {
    async loginViaForm(page, options) {
      await page.goto(new URL(options.loginPath, options.webBaseUrl).toString());
      await submitSignInForm(page, options);
    },
    async verifyLoggedIn(page, loginPath) {
      if (new URL(page.url()).pathname.startsWith(loginPath) || (await onSignInPage(page))) {
        return { ok: false, reason: 'the browser is on the sign-in page' };
      }
      return { ok: true };
    },
  };
}
