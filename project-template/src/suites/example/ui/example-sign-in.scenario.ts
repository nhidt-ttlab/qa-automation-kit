import { defineUiScenario } from '@qakit/runner';

/** A first UI scenario: a browser signs in (per `web.authMode`) and lands past the login page. */
export default defineUiScenario({
  name: 'example-sign-in',
  testCaseId: 'TC-EX-U01',
  title: 'A user signs in through the web app',
  objective: 'The browser session the other UI scenarios depend on can be established.',
  module: 'example',
  async run(ctx) {
    const ui = await ctx.ui();
    const path = new URL(ui.page.url()).pathname;
    ctx.check('A1', 'The browser left the login page after signing in', true, !path.startsWith(ctx.web.loginPath));
    await ui.screenshot('After sign-in', { checkTestId: 'TC-EX-U01 / A1' });
  },
});
