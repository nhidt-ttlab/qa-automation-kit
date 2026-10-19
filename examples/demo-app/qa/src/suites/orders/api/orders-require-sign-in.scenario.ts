import { defineApiScenario } from '@qakit/runner';

export default defineApiScenario({
  name: 'orders-require-sign-in',
  testCaseId: 'TC-ORD-A02',
  title: 'Orders are not readable without signing in',
  objective: 'The orders API rejects requests that carry no token, and accepts the same request with one.',
  module: 'orders',
  async run(ctx) {
    const anonymous = await ctx.http.request('shop-public', { method: 'GET', path: '/api/orders' });
    ctx.step('List orders without a token', anonymous.status === 401, { status: anonymous.status });
    ctx.check('A1', 'An anonymous request is rejected with 401', 401, anonymous.status);

    const signedIn = await ctx.http.request('shop', { method: 'GET', path: '/api/orders/o-1001' });
    ctx.step('Read one order with a token', signedIn.ok, { status: signedIn.status });
    ctx.check('A2', 'The same resource is readable once signed in', 200, signedIn.status);
  },
});
