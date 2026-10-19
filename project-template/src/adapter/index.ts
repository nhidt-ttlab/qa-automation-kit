import { defineProjectAdapter } from '@qakit/core';
import type { Page } from 'playwright';

interface FormLoginOptions {
  webBaseUrl: string;
  loginPath: string;
  username: string;
  password: string;
  timeoutMs: number;
}

/**
 * {{project}}'s adapter: the code half of the kit integration, loaded through `adapter:` in
 * qakit.config.yaml. Every member is optional — add what your app needs:
 *
 * - `browser.loginViaForm` / `browser.seedSession` / `browser.verifyLoggedIn` — how a browser signs in
 *   (`web.authMode: form | storage`).
 * - `reportWording`, `persistHooks`, `resolveArtifactGroup` — report language and run grouping.
 * - `mcpUi` — a full UI MCP setup, when the generic one (html widgets) is not enough.
 */
export default defineProjectAdapter({
  name: '{{project}}',
  browser: {
    // Adjust the selectors to your login page.
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
