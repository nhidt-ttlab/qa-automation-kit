import { defineUiScenario } from '@qakit/runner';

export default defineUiScenario({
  name: 'orders-sign-in',
  testCaseId: 'TC-ORD-U01',
  title: 'Signing in opens the order list',
  objective: 'A user who signs in through the form lands on the order list, and the list shows the orders the API returns.',
  module: 'orders',
  async run(ctx) {
    const ui = await ctx.ui();
    ctx.check('A1', 'The browser left the login page', '/orders', new URL(ui.page.url()).pathname);

    const grid = await ui.readGrid({ columns: ['id', 'customer', 'status', 'total'] });
    const api = await ctx.http.request<Array<{ id: string }>>('shop', { method: 'GET', path: '/api/orders' });
    ctx.check('A2', 'The table shows as many rows as the API has orders', api.data?.length ?? -1, grid.rows.length);
    ctx.check('A3', 'The first row is the first order', api.data?.[0]?.id, grid.rows[0]?.id);
    await ui.screenshot('Order list after sign-in', { checkTestId: 'TC-ORD-U01 / A2' });
  },
});
