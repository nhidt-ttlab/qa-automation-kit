# QA automation kit

A reusable test-automation stack for web products with a REST/OpenAPI backend:

- **API MCP server**: lets an agent discover and call backend operations straight from the project's OpenAPI spec.
- **UI MCP server**: a guarded Playwright browser an agent drives one step at a time, with evidence capture and run reports.
- **Desktop apps**: Electron applications driven through WebdriverIO in the same UI scenarios ([docs/desktop-testing.md](docs/desktop-testing.md)).
- **Scenario harness**: `*.scenario.ts` API and UI regression scenarios with verdicts, evidence and a SQLite run store.
- **Reporting app**: tracks runs, defects and resolutions, with tracker integration.
- **QA skills**: take a spec through checklist, test-case inventory, scenarios and test steps to automation scripts.

A project uses the kit through two seams. **`qakit.config.yaml`** declares hosts, auth, the module registry, paths and safety switches. **`ProjectAdapter`** holds code-level hooks for anything config can't express: browser session seeding, widget adapters, data providers and report wording.

## Status

**All phases done.** Every package below is extracted, adopted by the first consuming project, and exercised end to end against `examples/demo-app`. Start a new project with [ADOPTING.md](ADOPTING.md); the day-to-day workflow (spec → test steps → scripts → tasks, and what to do when a feature changes) is in [docs/usage-guidelines.md](docs/usage-guidelines.md); the design is in [docs/adr/0001-kit-architecture.md](docs/adr/0001-kit-architecture.md).

| Package | Status |
|---|---|
| `packages/core`: config, auth, HTTP, runner, evidence, reports, store | config (+ `.env` loading, `extensions`), `ProjectAdapter` + `loadProjectAdapter`, logger, assertions, auth providers, the OIDC code flow over HTTP (`runOidcCodeFlow`, `oidcSignIn`, `oidcTokenRequest`), HTTP client, evidence store, report pipeline (`createReportKit` + `ReportWording`), SQLite run store (`sql/schema.sql`, `openRunStore`, `writeRunToStore`, `loadRunFromStore`), runner (`createArtifactLayout`, `selectScenarios`, `parseBatchArgs`, `cleanArtifactTrees`, `runLifecycle`, `renderBatchSummary`) |
| `packages/ui`: Playwright driver, runtime, guards, diagnostics, UI checks, `UiWidgets` + `createHtmlWidgets` (ARIA/native), form sign-in (`submitSignInForm`, `formSignInBrowserHooks`) | done — library adapters (Ant Design, AG Grid) still live in the first consuming project |
| `packages/desktop`: Electron apps through WebdriverIO's Electron service — `DesktopDriver` (step-doc locators, main-process `executeMain`, screenshots), `createDesktopRuntime` / `openProjectDesktop` (lazy launch, process logs, the app always closed), the config's `desktop` block | done — `ctx.desktop()` in UI scenarios, `qakit doctor --desktop`; see [docs/desktop-testing.md](docs/desktop-testing.md) |
| `packages/mcp-api`: OpenAPI-driven API MCP server with a write gate | done — `qakit-mcp-api --config`: domain registry, business graph, OpenAPI loader + ranking, planner, action registry, executor with write gate (`api.allowWrites[Env]`, `readOnlyPostPatterns`, `confirm` for destructive operations) and audit log; `qakit-api docgen` / `domains` (from OpenAPI tags, or `--from-metadata` with a mapping) / `field-deps` |
| `packages/mcp-ui`: browser MCP server | done — `qakit-mcp-ui --config <qakit.config.yaml> [--env <name>]`; nine step-sized `ui_*` tools, `UiPolicy` (host allowlist, destructive labels, secrets, budget), JSONL audit log, run writer; project parts via the adapter's `mcpUi` hook, or a generic setup (html widgets, `browser` sign-in hooks) |
| `packages/locale-*`: UI wording, destructive-action labels, doc headings | `locale-vi`: browser step titles, UI check wording (`createUiChecks`), UI MCP wording, destructive-action labels (exported as `locale`) |
| `packages/runner`: `defineApiScenario` / `defineUiScenario`, discovery under `paths.suites`, `runScenario` (HTTP with the sources' credentials, lazy browser and desktop app, reports + run store) | done — `qakit-suite` |
| `packages/cli`: `qakit init / doctor / skills install / suite / api / mcp-api / mcp-ui` | done — `doctor --desktop` launches the desktop app once |
| `apps/reporting-*`: reporting API and web app | done — `apps/reporting-{api,web,shared}` (NestJS + Prisma, React, shared DTOs), deployable from a project folder via `REPORTING_DATA_DIR` / `REPORTING_WEB_ENV_DIR`, runner switch names via `RUNNER_*`, Redmine behind `IssueTracker`; see [docs/reporting-app.md](docs/reporting-app.md) |
| `skills/` | done — 12 skills (feature extraction → inventory → scenarios → API/UI steps → scenario scripts, checklist automation, hardening checklist, API MCP, implementation plans with acceptance-test and logging sections, diagnostic logging, hand-off + pull/merge request); English, reading `qakit.config.yaml` and `<paths.knowledge>`; Vietnamese method files as a `locale-vi` overlay; installed with `qakit skills install` |
| `doc-templates/` | done — `api-test-steps`, `ui-test-steps`, `crud-map`, `automation-guide` (Vietnamese in `packages/locale-vi/doc-templates/`) |
| `project-template/` | done — what `qakit init` writes |
| `examples/demo-app` | done — dependency-free shop + `qa/` project; `test/demo-e2e.test.ts` runs doctor and 2 API + 2 UI scenarios |

## Commands

```sh
pnpm install
pnpm build          # tsc -b
pnpm typecheck
pnpm test           # unit tests + kit fitness tests
pnpm schema:build   # regenerate schema/qakit.config.schema.json from the zod schema
```

Requires Node 22.5 or newer, because the run store uses `node:sqlite`.

## Project config at a glance

```yaml
# yaml-language-server: $schema=<path-to-kit>/schema/qakit.config.schema.json
project: demo-shop
locale: en
modules:
  - { id: orders, tcPrefix: ORD }
apiSources:
  shop:
    baseUrl: { env: SHOP_BASE_URL, default: https://shop.example.test }
    openapi: { path: /openapi.json }
    auth: { type: jwt-login, loginPath: /auth/login, tokenJsonPath: data.accessToken,
            usernameEnv: QA_USERNAME, passwordEnv: QA_PASSWORD }
web:
  baseUrl: https://shop.example.test
  allowedHosts: [shop.example.test]
  widgets: [html]
safety:
  allowWritesEnv: QA_ALLOW_WRITES   # writes stay off unless this is 1
```

Auth types: `none`, `static-bearer`, `api-key`, `oauth2-password`, `oidc-code` (authorization code + PKCE, signing in at the identity provider's form), `jwt-login`, `cookie-session`, and `reuse` (take another source's token).

An environment overlay, `qakit.config.<env>.yaml`, is merged over the base file when that environment is selected with `QAKIT_ENV` or the `environment` option.

## Single sign-on (OpenID Connect)

For a product behind an identity provider, the kit signs in the way a browser does, with no password grant and no test-only client:

```yaml
apiSources:
  shop:
    baseUrl: https://shop.example.test
    auth: { type: oidc-code, issuer: https://sso.example.test, clientId: shop-web,
            clientSecretEnv: SHOP_WEB_CLIENT_SECRET, redirectUri: /signin-oidc, scope: openid offline_access shop,
            usernameEnv: QA_USERNAME, passwordEnv: QA_PASSWORD }
web:
  loginPath: /Account/Login                                    # the provider's sign-in page
  allowedHosts: [example.test]                                 # the application and the provider
  authPaths: ['/connect/token$', '/connect/authorize']         # the provider's protocol endpoints (these are the defaults)
```

- **One account for `ctx.http` and the API MCP server:** the `oidc-code` auth type above. The token is cached and refreshed. `scope` and each `authorizeParams` value may be `{ env, default }`, and a value in an env file may point at another variable as `${NAME}`, so the account, its tenant and its scope are chosen in `.env` without copying a password.
- **Several people, audiences or sessions in one scenario:** call `runOidcCodeFlow`, `oidcSignIn` (keeps the session, for sign-out), `refreshOidcTokens` and `oidcTokenRequest` (a refusal is returned, not thrown) from `@qakit/core`.
- **In the browser:** `submitSignInForm` and `onSignInPage` from `@qakit/ui`; an adapter gets both hooks with `browser: formSignInBrowserHooks()`. One browser context visiting two applications is how a scenario shows that the second one asks for no password.

The HTTP flow and the browser helper sign in at a server-rendered page with one form holding the username and the password. A sign-in page built by JavaScript works in the browser only; a username-then-password sequence, MFA or a consent screen needs the project's own steps. See [ADOPTING.md](ADOPTING.md#testing-single-sign-on).

## Rules for contributors

- The kit stays project-neutral. `test/no-project-strings.test.ts` fails when a consuming project's name, hosts or routes appear outside `packages/locale-*` and `docs/adr/`.
- A generic fix lands here, not in a consuming project's copy.
- `schema/qakit.config.schema.json` is generated; `test/schema-sync.test.ts` fails if it drifts.
