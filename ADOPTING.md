# Adopting the QA automation kit

From an empty folder to scenarios, MCP servers and QA skills for your own web app with a REST/OpenAPI
backend. The kit's `examples/demo-app/qa` is a finished example of every step below.

## 0. Prerequisites

- Node 22.5 or newer (the run store uses `node:sqlite`).
- The kit built once: `pnpm install && pnpm build` in the kit folder.
- A running environment of your app you may test against, with a QA account.
- GitNexus, the code-intelligence index agents use for impact analysis and `detect_changes` before
  editing or committing (see [Install GitNexus](#install-gitnexus) below).

### Install GitNexus

Run once from the root of the repository that holds your app's source (not the `qa/` folder):

```bash
npx gitnexus analyze          # builds the index in .gitnexus/ and a runner at .gitnexus/run.cjs
```

On npm 11.x, if `npx` crashes during install (`node.target is null`), use `npm i -g gitnexus` and then
`gitnexus analyze`, or `bunx gitnexus@latest analyze`. Add `.gitnexus/` to `.gitignore`.

Register the MCP server so agents get the `impact`, `context`, `query` and `detect_changes` tools. Add
this to the repository's `.mcp.json`, next to the kit's servers from step 5:

```json
{ "mcpServers": { "gitnexus": { "command": "npx", "args": ["-y", "gitnexus@latest", "mcp"] } } }
```

Afterwards, refresh the index with `node .gitnexus/run.cjs analyze` whenever the code changes a lot,
and check it with `node .gitnexus/run.cjs status`.

## 1. Scaffold

```bash
node <kit>/packages/cli/dist/bin.js init qa --project my-shop --locale en
cd qa
npm install
npx playwright install chromium
cp .env.example .env    # fill in URLs and the QA account
```

`qa/` now holds `qakit.config.yaml`, an adapter stub, one example API and one example UI scenario,
domain files for the API MCP server, a knowledge folder and snippets for `.mcp.json` / `CLAUDE.md`.

## 2. Fill in the config

Open `qakit.config.yaml` (your editor validates it against `<kit>/schema/qakit.config.schema.json`):

- **`apiSources`** — one entry per backend: `baseUrl`, `openapi` (where the spec is served, or a local
  file via `fileEnv`) and `auth`: `none`, `static-bearer`, `api-key`, `oauth2-password`, `oidc-code`
  (OpenID Connect code flow, see [Testing single sign-on](#testing-single-sign-on)), `jwt-login`
  (login endpoint + JSON path of the token), `cookie-session`, or `reuse` another source's token.
  `repository` names the source repository (generated docs are grouped by it); `mcpId` renames the
  source for actionIds when you must keep an existing id.
- **`web`** — `baseUrl`, `loginPath`, `allowedHosts` (`host[:port]` of every origin the page may reach,
  API hosts included), `authMode` (`form`, `storage`, or `none` when each scenario signs in as whoever
  it needs), `widgets` (`html` works on accessible native
  markup), `postLookups` (POST endpoints that only read, such as a login, allowed in read-only runs),
  `authPaths` (the identity provider's protocol endpoints, when they are not `/connect/token` and
  `/connect/authorize`).
- **`modules`** — your business modules; `tcPrefix` drives test-case ids, `suite` the scenario folder.
- **`safety` / `api.allowWritesEnv`** — writes stay off unless the named env var is `1`. Keep them off for
  shared environments.
- **`ids`, `paths`, `reporting`, `mcp`** — id formats, where docs/steps/suites/knowledge live, the run
  store and tracker, and the MCP server names the skills use.

Then check it:

```bash
npx qakit doctor --config qakit.config.yaml            # add --browser to sign in through a real browser,
                                                       # --desktop to launch the desktop app
```

Doctor loads the config and adapter, resolves every source, fetches each OpenAPI spec, logs in, checks
the domain files and the web target, and tells you what to fix.

## 3. Teach the API MCP server your business

```bash
npx qakit api domains --config qakit.config.yaml   # one domain file per OpenAPI tag, in api.domainsDir
npx qakit api docgen --config qakit.config.yaml    # per-tag endpoint metadata + Markdown docs
```

Regroup the bootstrapped domains into real business domains, write capability summaries in your
users' words, and add cross-domain edges to `api.businessGraph` (an order requires a customer...). The
planner ranks operations by these words, so this is where its quality comes from.

## 4. Write the adapter (only what config cannot express)

`src/adapter/index.ts`:

- `browser.loginViaForm` for `authMode: form` (adjust the selectors), or `browser.seedSession` +
  `browser.verifyLoggedIn` for `authMode: storage` (put a token where your SPA expects it). When the
  sign-in page is one form with a username and a password, `browser: formSignInBrowserHooks()` from
  `@qakit/ui` is both hooks, with no selectors to adjust.
- Optional: `reportWording` (report language), `persistHooks` (extra data per stored run),
  `resolveArtifactGroup`, `mcpUi` (a full UI MCP setup — e.g. widget adapters for your component
  library when the `html` adapter is not enough).

## 5. Register the MCP servers

Merge `mcp.json.snippet` into the repository's `.mcp.json`:

- `<project>-api` — discovery, planning and write-gated execution over your OpenAPI specs.
- `<project>-ui` — a guarded browser an agent drives one test step at a time, with evidence and reports.

## 6. Install the QA skills and run the pipeline

```bash
npx qakit skills install --config qakit.config.yaml --target ../.claude/skills
```

Add `CLAUDE.md.snippet` to the repository's `CLAUDE.md` (it tells the skills where the config is), and
write project facts into `.qakit/knowledge/project.md` — vocabulary, environments and test data, UI
quirks, style references. Then the pipeline, one skill per stage:

1. `create-feature-extraction` — spec sheets → feature documents per module
2. `hardening-checklist` — edge-case checklist per feature
3. `create-testcase-inventory` → `create-testcase-scenarios`
4. `create-testcase-steps` (API) / `create-testcase-steps-ui` (UI) — executable step documents
5. `create-scenario-script` / `checklist-to-ui-automation` — `*.scenario.ts` scripts
6. `api-mcp` — call backend actions from chat through the API MCP server
7. `create-plan` — implementation plans for product changes, each with the step docs and scenario scripts that test it and the log points it adds
8. `add-debug-logging` — diagnostic logging written with the code, in the project's own logger conventions (`.qakit/knowledge/add-debug-logging.md`)
9. `investigate` — read-only diagnosis of a bug or a failed run: root cause, evidence, proposed fix and blast radius, no edits (`.qakit/knowledge/investigate.md`)
10. `handoff-pr` — finished work → verified commits, hand-off notes and the pull/merge request(s) (`.qakit/knowledge/handoff-pr.md`)

## 7. Run

```bash
npx qakit suite --config qakit.config.yaml --list
npx qakit suite --config qakit.config.yaml --kind api
npx qakit suite --config qakit.config.yaml --testcase TC-ORD-U01
```

Each run writes a Markdown report (`reports/`), a JSON artifact (`outputs/`), evidence (`evidence/`)
and a row in the SQLite run store. The reporting app (`apps/reporting-*`, see
[docs/reporting-app.md](docs/reporting-app.md)) imports that store into Postgres for review, defects and
tracker issues.

## Testing single sign-on

When your app signs in at an OpenID Connect identity provider, the kit can act as the browser does.

**Config.** Give the source an `oidc-code` auth block: `clientId`, `redirectUri` (one registered for the
client; a path is resolved against the source's `baseUrl`, and it is never called), `scope`, the QA
account's `usernameEnv` / `passwordEnv`, and where they apply `issuer` (when the provider is another
host), `clientSecretEnv` (leave out for a public client) and `authorizeParams` (a tenant or organization
hint). `ctx.http`, `qakit doctor` and the API MCP server then sign in through the real flow and keep the
token fresh. In `web`, put the provider's host in `allowedHosts`, its sign-in page in `loginPath`, and its
token and authorization endpoints in `authPaths` if they are not `/connect/token` and
`/connect/authorize`.

**Choosing the account outside the config.** `scope` and each `authorizeParams` value take a literal or
`{ env, default }`; a parameter that resolves to nothing is not sent. In an env file a value may point at
another variable, which a later file may define:

```sh
QA_USERNAME=${PERSONA_ALICE_USERNAME}     # .env; the persona is defined in a generated secrets file
QA_PASSWORD=${PERSONA_ALICE_PASSWORD}
```

With the two variables unset the source is anonymous. A reference to a variable that is not set is left as
written.

**Scenarios that need more than one fixed account** import the flow from `@qakit/core`:

```ts
const client = { clientId: 'shop-web', clientSecret: ctx.env.SHOP_WEB_CLIENT_SECRET, redirectUri: 'https://shop.example.test/signin-oidc', scope: 'openid offline_access shop' };
const session = await oidcSignIn({ issuer, client, username, password });   // tokens + signOut()
const next = await refreshOidcTokens(issuer, client, session.tokens.refreshToken!);
const refused = await oidcTokenRequest(issuer, client, { grant_type: 'refresh_token', refresh_token: session.tokens.refreshToken! });
await session.signOut();
```

Typical cases: the access token names one audience only; a refresh token works once; a signed-out
session's token is refused on the next request; another client's token is rejected.

**In the browser**, `submitSignInForm(page, { username, password })` from `@qakit/ui` fills the form the
page is showing and waits until it is gone; `onSignInPage(page)` tells whether a password prompt is on
screen. The single sign-on case itself is a UI scenario in one browser context: sign in to the first
application, open the second, and assert that no sign-in form appeared, that the second application set
its own session cookie for its own host, and that no cookie holds a token.

The sign-in form is a POST, so a read-only run blocks it: run such scenarios with writes allowed, or list
the sign-in path in `web.postLookups`. The guard never records the body of a request to `loginPath` or to
an `authPaths` endpoint, blocked or not.

**Limits.** The HTTP flow reads a server-rendered page with one form holding the username and the
password. A sign-in page built by JavaScript can only be driven in the browser. A username-then-password
sequence, MFA, a consent screen and sign-in through an external provider are not handled by either
helper; write those steps in your project.

## Testing a desktop app

An Electron app is tested in the UI lane: add a `desktop` block to the config, and a UI scenario gets the app from
`ctx.desktop()` the way it gets a browser from `ctx.ui()`. Setup, the driver's verbs and how a desktop run differs
from a browser run (no read-only guard, no network trace) are in [docs/desktop-testing.md](docs/desktop-testing.md).

## Contributing back

A fix that is not about your project belongs in the kit, not in your copy: change it here, add a test,
rebuild, and every project picks it up through its `file:` dependency. `test/no-project-strings.test.ts`
keeps project names out of the kit; project facts go in the project's config, adapter and knowledge.
