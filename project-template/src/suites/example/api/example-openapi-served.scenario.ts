import { defineApiScenario } from '@qakit/runner';

/** A first API scenario: the backend answers and publishes its OpenAPI document. Replace it with real ones. */
export default defineApiScenario({
  name: 'example-openapi-served',
  testCaseId: 'TC-EX-A01',
  title: 'The backend publishes its OpenAPI document',
  objective: 'The API is reachable and describes itself, so the API MCP server and docgen can use it.',
  module: 'example',
  async run(ctx) {
    const response = await ctx.http.request<{ openapi?: string; paths?: Record<string, unknown> }>('app', { method: 'GET', path: '/openapi.json' });
    ctx.step('GET /openapi.json', response.ok, { status: response.status });
    ctx.check('A1', 'The OpenAPI document is served', 200, response.status);
    ctx.check('A2', 'The document declares at least one path', true, Object.keys(response.data?.paths ?? {}).length > 0);
  },
});
