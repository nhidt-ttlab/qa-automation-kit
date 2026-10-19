import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ConfigError, projectConfigSchema, type LoadedProjectConfig, type ProjectAdapter } from '@qakit/core';
import { projectAuthModes, resolveUiBrowser, UI_BROWSER_ENV, UI_BROWSERS, uiBrowserType } from './project-browser.js';

/** `QAKIT_UI_BROWSER` → the Playwright engine and channel a browser/OS matrix run launches. */
describe('resolveUiBrowser', () => {
  it('defaults to the bundled Chromium when the variable is unset or empty', () => {
    assert.deepEqual(resolveUiBrowser({}), { name: 'chromium', engine: 'chromium' });
    assert.deepEqual(resolveUiBrowser({ [UI_BROWSER_ENV]: '' }), { name: 'chromium', engine: 'chromium' });
    assert.deepEqual(resolveUiBrowser({ [UI_BROWSER_ENV]: '  ' }), { name: 'chromium', engine: 'chromium' });
  });

  it('maps every allowed value to its engine and channel, ignoring case and spaces', () => {
    assert.deepEqual(resolveUiBrowser({ [UI_BROWSER_ENV]: 'chromium' }), { name: 'chromium', engine: 'chromium' });
    assert.deepEqual(resolveUiBrowser({ [UI_BROWSER_ENV]: 'chrome' }), { name: 'chrome', engine: 'chromium', channel: 'chrome' });
    assert.deepEqual(resolveUiBrowser({ [UI_BROWSER_ENV]: ' MSEdge ' }), { name: 'msedge', engine: 'chromium', channel: 'msedge' });
    assert.deepEqual(resolveUiBrowser({ [UI_BROWSER_ENV]: 'Firefox' }), { name: 'firefox', engine: 'firefox' });
  });

  it('refuses an unknown value with a ConfigError that names the allowed values', () => {
    assert.throws(
      () => resolveUiBrowser({ [UI_BROWSER_ENV]: 'safari' }),
      (error: unknown) => error instanceof ConfigError && error.message.includes('safari') && UI_BROWSERS.every((b) => error.message.includes(b)),
    );
  });

  it('launches the bundled builds through the matching Playwright browser type', async () => {
    assert.equal((await uiBrowserType(resolveUiBrowser({ [UI_BROWSER_ENV]: 'chromium' }))).name(), 'chromium');
    assert.equal((await uiBrowserType(resolveUiBrowser({ [UI_BROWSER_ENV]: 'chrome' }))).name(), 'chromium');
    assert.equal((await uiBrowserType(resolveUiBrowser({ [UI_BROWSER_ENV]: 'msedge' }))).name(), 'chromium');
    assert.equal((await uiBrowserType(resolveUiBrowser({ [UI_BROWSER_ENV]: 'firefox' }))).name(), 'firefox');
  });
});

/** Which sign-in a browser session opens with: what the config asks for, when the project can back it. */
describe('projectAuthModes', () => {
  const login = { type: 'jwt-login', loginPath: '/auth/login', usernameEnv: 'QA_USER', passwordEnv: 'QA_PASS' };
  const loaded = (web: Record<string, unknown>): LoadedProjectConfig =>
    ({
      config: projectConfigSchema.parse({
        project: 'demo-shop',
        apiSources: { shop: { baseUrl: 'https://shop.example.test', auth: login } },
        web: { baseUrl: 'https://shop.example.test', allowedHosts: ['shop.example.test'], apiSource: 'shop', ...web },
      }),
    }) as LoadedProjectConfig;
  const adapter: ProjectAdapter = { name: 'demo-shop', browser: { loginViaForm: async () => undefined } };

  it('signs in through the form by default when the adapter and the source can', () => {
    assert.deepEqual(projectAuthModes(loaded({}), adapter), { available: ['form', 'none'], defaultMode: 'form', warnings: [] });
  });

  it('opens sessions signed out when the config says none, with form sign-in still on offer', () => {
    assert.deepEqual(projectAuthModes(loaded({ authMode: 'none' }), adapter), { available: ['form', 'none'], defaultMode: 'none', warnings: [] });
  });

  it('falls back to none, and says so, when the wanted mode has no hook behind it', () => {
    const modes = projectAuthModes(loaded({}), undefined);
    assert.equal(modes.defaultMode, 'none');
    assert.match(modes.warnings.join(' '), /web.authMode "form" needs adapter browser hooks/);
  });
});
