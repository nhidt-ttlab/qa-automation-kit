---
name: api-mcp
description: "Use when the user wants to call a backend business action from chat through the project's API MCP server — create, query or update a record (an order, a customer, a contract, a stock movement...), find out which API does something, or check what the API MCP server can do. Examples: \"Create an order for customer X\", \"Look up product SKU-123\", \"What API do I call to approve a contract?\", \"Check stock in warehouse Y through the API MCP\"."
---

## Project settings

This skill is part of the QA automation kit and works on any project that has a `qakit.config.yaml`.
Before starting:

1. Locate the project's `qakit.config.yaml` — the path named in the "QA automation kit" section of the
   project's `CLAUDE.md`, otherwise the repository root. Paths inside it are relative to its folder.
2. Read the settings this skill uses: `modules`, `paths`, `ids`, `locale`, `mcp` (tool names are
   `mcp__<serverName>__<tool>`), and `web` / `apiSources` where relevant.
3. Read the project knowledge for this skill, if present: `<paths.knowledge>/<skill-name>.md` and
   `<paths.knowledge>/project.md`. Knowledge files carry project facts — module scope, vocabulary,
   examples, known pitfalls — and win over this skill's generic examples. They do not relax this
   skill's process rules or quality gates.
4. Write documents in the project's `locale`. When a template exists for it, `templates/` holds the
   locale's version.

# API MCP server

Drives the project's API MCP server, registered as `mcp.apiServerName` (the kit's `@qakit/mcp-api`,
started with `qakit-mcp-api --config <qakit.config.yaml>`). It sits over the backends in `apiSources`
and their OpenAPI specs. It does **not** expose raw HTTP: it exposes a 5-tool workflow that discovers
the right business domain, resolves cross-domain dependencies, lazily loads only the relevant API
operations, and executes a previously issued action.

Never hit a backend's swagger or HTTP API directly, and never guess a `path` or `httpMethod` —
`execute_api_action` only accepts an `actionId` that `plan_task` or `load_domain_api_registry` issued.

## Confirm the server is connected

If unsure the server is wired up, run `claude mcp list` (or `/mcp`) and confirm the server named
`mcp.apiServerName` is connected. If it is missing, the project's MCP registration (`.mcp.json`) or the
kit build is the usual cause — the knowledge file names the exact command for this project.

## The 5 tools, in workflow order

Tool names are `mcp__<mcp.apiServerName>__<tool>`.

1. **`discover_domains({ keyword? })`** — list or keyword-search business domains. Metadata only, no
   network. The domains are the files in `api.domainsDir`.
2. **`resolve_domain_dependencies({ domainId, direction? })`** — cross-domain edges (from
   `api.businessGraph`) and their transitive closure.
3. **`load_domain_api_registry({ domainId, intent?, maxTools?, forceRefresh? })`** — loads the domain's
   OpenAPI spec (cached under `api.cacheDir`), ranks operations against `intent`, and returns the top
   `maxTools` candidates with resolved input schemas and their `actionId`s.
4. **`plan_task({ task, knownInputs?, maxDomains? })`** — the usual entry point for a free-text ask.
   Resolves the primary domain, orders its dependencies, picks the top-ranked operation per domain, and
   flags steps that are `blocked_missing_input` or `blocked_capability_not_implemented`.
5. **`execute_api_action({ actionId, pathParams?, query?, body?, planStepId?, confirm?, reason? })`** —
   executes an `actionId` from step 3 or 4. The result's `mode` tells you what happened:
   - `stub` — no credentials are configured for that backend; nothing was sent. The result shows the
     request that would have been made and which env vars enable a live call.
   - `denied` — the write gate refused it. Anything but a read needs writes enabled for the server
     (`api.allowWrites`, or its `api.allowWritesEnv` switch set to `1`); a destructive operation
     (DELETE, or a name matching `api.destructiveOperations`) also needs `confirm: true`. POST lookups
     matching `api.readOnlyPostPatterns` count as reads.
   - `live` — the request was sent; `ok` and `status` carry the outcome.
   Every execution is written to an audit log, so give a `reason`.

## Workflow

```
1. plan_task({ task: "<user's request in plain language>" })
     → primary domain, ordered steps, each step's actionId (or block reason)
2. For each step blocked_missing_input:
     - ask the user for the missing field, OR
     - resolve it via a lookup step already in the plan (e.g. look up customerId before creating the order)
3. execute_api_action({ actionId, pathParams, query, body, reason })
     → repeat per step, in the plan's dependency order
4. Report what ran live, what was stubbed and what was denied, and any remaining blocks
```

Skip straight to `discover_domains` / `load_domain_api_registry` when the user already names a domain
and operation ("call the product search endpoint") rather than describing an outcome — `plan_task` turns
a goal into a sequence of calls; it is not for browsing.

## Example: "Create an order for customer ACME with 2x SKU-123"

```
1. plan_task({ task: "Create an order for customer ACME with 2x SKU-123" })
   → primary domain: order (depends on: customer, product)
   → step 1: customer lookup   (actionId, ready)
   → step 2: product lookup    (actionId, ready)
   → step 3: order create      (actionId, blocked_missing_input: customerId, items)

2. execute_api_action({ actionId: <customer lookup>, query: { name: "ACME" }, reason: "resolve customerId" })
3. execute_api_action({ actionId: <product lookup>, query: { sku: "SKU-123" }, reason: "resolve productId" })
4. execute_api_action({ actionId: <order create>, body: { customerId, items: [{ productId, quantity: 2 }] },
                        reason: "user asked to create the order" })
   → live result; or `denied` when writes are off for this server — say so, do not retry around it
```

## Notes

- **Say which mode ran.** A `stub` or `denied` result created nothing; never tell the user a record was
  created unless the result is `live` with `ok: true`.
- **Writes are an explicit decision.** If a call is denied because writes are off, report it and let the
  user decide; do not look for another route to the same change. Pass `confirm: true` only after the user
  approved that exact destructive call.
- **New domain needed?** No code changes: add `<api.domainsDir>/<id>.yaml`, any edges to
  `api.businessGraph`, and — for a new backend — an `apiSources` entry in `qakit.config.yaml`.
  `qakit-api domains` can bootstrap domain files from the OpenAPI tags.
- **Testing the server offline:** point a source's `openapi.fileEnv` variable at a local spec file; the
  loader reads it instead of the network.
