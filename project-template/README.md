# {{project}} — QA

Automated API and UI regression for {{project}}, built on the QA automation kit (`{{kitDir}}`).

```bash
npm install
npm run pw:install              # Chromium for UI scenarios
cp .env.example .env            # fill in URLs and credentials
npm run doctor                  # config, credentials, OpenAPI spec, web target
npm run suite                   # run every scenario under src/suites
npm run skills                  # install the QA skills into .claude/skills
```

- `qakit.config.yaml` — hosts, auth, modules, paths, safety switches.
- `src/adapter/index.ts` — sign-in and other app-specific code.
- `src/suites/<suite>/<api|ui>/*.scenario.ts` — scenarios (`defineApiScenario` / `defineUiScenario`; a UI scenario drives the web app with `ctx.ui()` or a desktop app with `ctx.desktop()`).
- `api/domains/`, `api/business-graph.yaml` — what the API MCP server knows about the business.
- `.qakit/knowledge/` — project facts the QA skills read.
- MCP servers: merge `mcp.json.snippet` into `.mcp.json`; add `CLAUDE.md.snippet` to `CLAUDE.md`.

Runs write Markdown reports to `reports/`, JSON artifacts to `outputs/`, evidence to `evidence/` and a
row per run to `db/runs.db`.
