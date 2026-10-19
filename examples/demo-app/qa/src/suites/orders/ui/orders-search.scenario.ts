import { defineUiScenario } from '@qakit/runner';

export default defineUiScenario({
  name: 'orders-search',
  testCaseId: 'TC-ORD-U02',
  title: 'Searching the order list filters by customer',
  objective: 'Typing part of a customer name keeps only the matching rows, case-insensitively.',
  module: 'orders',
  async run(ctx) {
    const ui = await ctx.ui();
    await ui.fill({ domId: 'search' }, 'acme');
    const grid = await ui.readGrid({ columns: ['customer'] });

    ctx.check('A1', 'Two orders match "acme"', 2, grid.rows.length);
    const misses = grid.rows.filter((row) => !String(row.customer).toLowerCase().includes('acme'));
    ctx.check('A2', 'Every remaining row is an Acme customer', 0, misses.length);
    ctx.check('A3', 'The row counter agrees with the table', `${grid.rows.length} orders`, await ui.readText({ domId: 'count' }));
  },
});
