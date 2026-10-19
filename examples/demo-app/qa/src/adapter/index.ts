import { defineProjectAdapter } from '@qakit/core';
import type { Page } from 'playwright';

interface FormLoginOptions {
  webBaseUrl: string;
  loginPath: string;
  username: string;
  password: string;
  timeoutMs: number;
}

/** The demo shop's adapter: only the login form is app-specific. */
export default defineProjectAdapter({
  name: 'demo-shop',
  browser: {
    async loginViaForm(page: Page, options: FormLoginOptions) {
      await page.goto(new URL(options.loginPath, options.webBaseUrl).toString());
      await page.fill('#username', options.username);
      await page.fill('#password', options.password);
      await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith(options.loginPath), { timeout: options.timeoutMs }),
        page.click('button[type="submit"]'),
      ]);
    },
  },
});
