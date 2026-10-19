import { defineApiScenario } from '@qakit/runner';

interface Order {
  id: string;
  customer: string;
  status: string;
  total: number;
}

export default defineApiScenario({
  name: 'orders-list',
  testCaseId: 'TC-ORD-A01',
  title: 'The order list returns every order with its key fields',
  objective: 'A signed-in client can list orders, and each order carries id, customer, status and total.',
  module: 'orders',
  async run(ctx) {
    const response = await ctx.http.request<Order[]>('shop', { method: 'GET', path: '/api/orders' });
    ctx.step('List orders', response.ok, { status: response.status });
    ctx.check('A1', 'GET /api/orders succeeds for a signed-in client', 200, response.status);

    const orders = response.data ?? [];
    ctx.check('A2', 'The list is not empty', true, orders.length > 0);
    const incomplete = orders.filter((o) => !o.id || !o.customer || !o.status || typeof o.total !== 'number');
    ctx.check('A3', 'Every order has id, customer, status and a numeric total', 0, incomplete.length);
    ctx.highlight(`${orders.length} orders listed`);
  },
});
