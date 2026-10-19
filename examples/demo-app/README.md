# Demo shop

The QA automation kit's own end-to-end target: a dependency-free Node server with a login, an OpenAPI
document, an orders/products API and two plain HTML pages. It proves the kit works on a project that
has nothing in common with the first project it was extracted from.

```bash
node server.mjs            # http://127.0.0.1:4600, user qa / secret (DEMO_PORT, DEMO_USERNAME, DEMO_PASSWORD)
```

`qa/` is a QA project for it, shaped like `qakit init` output:

- `qa/qakit.config.yaml` — two api sources (authenticated and public), the web target, form sign-in.
- `qa/src/adapter/index.ts` — the login form.
- `qa/src/suites/orders/{api,ui}/` — two API and two UI scenarios.
- `qa/api/` — domains and business graph for the API MCP server.

```bash
cd qa
DEMO_PORT=4731 node ../server.mjs &
DEMO_SHOP_USERNAME=qa DEMO_SHOP_PASSWORD=secret npx qakit doctor --config qakit.config.yaml
DEMO_SHOP_USERNAME=qa DEMO_SHOP_PASSWORD=secret npx qakit suite --config qakit.config.yaml
```

The kit's `test/demo-e2e.test.ts` does the same on every `pnpm test`.
