# Tracing an API contract from live traffic

How to resolve an unconfirmed endpoint, enum value, field name or date format against what the
product actually puts on the wire — instead of against what a doc assumed.

Read this when step 2 of the workflow ("resolve every unconfirmed actionId … decisive: the backend
source") needs more than a name lookup: when you need the *payload shape*, not just proof the
endpoint exists.

Project facts — which repository backs which API source, the exact cache files, the capture
switches and any extractor script — are in the skill's knowledge file
(`<paths.knowledge>/create-scenario-script.md`).

## Why three sources, not one

No single source answers the whole question, and picking the wrong one is how a scenario ends up
failing on a validation error that names none of the fields you got wrong.

| Source | Answers | Cannot answer |
| --- | --- | --- |
| HAR (live traffic) | the exact wire payload a working screen sends: enum *values*, date format, which optional fields the UI actually populates | whether a field is required, what the enum member is called |
| OpenAPI spec — the API MCP server's cache, `<api.cacheDir>/<apiSources.<id>.mcpId ?? id>.json`, or the generated API docs under `<api.docs.outputDir>` | which fields the DTO declares, which are required, declared types | often the enum member **names** — many generators render an enum as a bare `enum: [0,1,2,3]` |
| Backend source (`apiSources.<id>.repository`) | the enum member names and their business meaning (a trailing comment often carries the user-facing label) | which value this screen actually sends |

Worked example — `POST /api/orders` sends `"channel": 1`:

- HAR alone: `1`. Meaningless.
- OpenAPI alone: `$ref → Shop.Orders.OrderChannel`, `enum: [0,1,2]`. Still unnamed.
- Source alone: `OrderChannel { Unknown, Web = 1, Phone = 2 }` — but nothing says the checkout
  screen picks `1`.

Joined: `channel: 1 → OrderChannel.Web`. That is the fact a scenario can be written against, and
the one that belongs in the step doc's Automation findings section with its file:line reference.

## Capturing a usable HAR

**A default harness run usually cannot produce one.** Two `@qakit/ui` defaults each remove half the
payload:

- The browser runtime's HAR mode defaults to `on` — headers and timings only; response and request
  bodies are omitted (Playwright `recordHar.content: 'omit'`). Only `full` embeds bodies.
- The route guard aborts every non-safe method unless writes are allowed — so the POST you want to
  trace never leaves the browser.

That is why evidence HARs from ordinary runs contain no write payloads. To capture one, start the UI
MCP server (or a scenario run) with the HAR mode set to `full` and writes allowed
(`safety.allowWritesEnv` = `1`). The knowledge file names the project's HAR-mode switch and the
command that starts the server. HAR modes are `off` | `on` (default) | `full`.

Drive the screen once, then read the run's `network.har` under `<paths.evidence>`.

Two cautions. Allowing writes creates real rows in the shared environment and nothing cleans them
up — capture the one action you need and stop; keep the switch out of shared configs and CI. And
`full` multiplies HAR size several-fold, so leave it off for regression runs.

A HAR saved by hand from the browser's DevTools works equally well and skips both cautions.

## Reading it

If the project has a HAR extractor script (the knowledge file says), use it. Otherwise follow the
same procedure by hand or with a short script:

1. Group the traffic by endpoint, templating id segments (`/orders/3f2a…` → `/orders/{id}`) so the
   path matches the OpenAPI spec.
2. Keep mutations (non-GET) by default; GETs carry no request payload to check.
3. For each endpoint, find the operation in the cached spec and resolve its request DTO: declared
   fields, required fields, declared formats.
4. For each field sent, compare against the DTO and resolve enum values to their member names from
   the backend source, noting the source file and line.
5. Flag every divergence using the categories below.

## What the warnings mean

Each divergence is a gap between the assumed contract and the observed one. None of them is a
product defect on its own.

- **Not declared in schema** — the UI sends a field the DTO does not have, so the backend ignores
  it. Usually frontend bookkeeping (`__isEmpty`, row indexes) or a client-side computed total
  (tax amount, total including tax on line items are typical). Do **not** copy these into a
  scenario payload, and never assert that the server persisted one.
- **Required but not sent** — the UI omits a field the spec marks required. Worth confirming: the
  framework's declared required-ness and the server-side validator do not always agree.
- **`format: date-time` but the wire value is not ISO-8601** — send the observed shape verbatim
  (e.g. `"2026-09-05 09:03:20.374"` rather than `2026-09-05T09:03:20.374Z`) when that is what the
  working screen sends.
- **Not a valid value of the enum** — the value is outside the declared range. Either the spec cache
  is stale or the enum genuinely changed; check the source before trusting either.
- **No spec operation for this path** — undocumented endpoint, or a stale cache. Refresh the cache
  (the API MCP server's `forceRefresh`, or regenerate the API docs) before concluding the endpoint
  is undocumented.

## Limits

- The spec cache is a **snapshot**, not live. A field missing from it may simply be newer than
  the file. Refresh before reporting a contract gap as a finding.
- Analyse `application/json` request bodies; multipart uploads can be listed but not diffed.
- Following nested objects two levels deep, with arrays represented by their first element, is
  enough for a line-item shape, not a full audit of every row.
- Enum parsing from source is reliable for plain integer, implicit and bit-flag (`1 << n`) members.
  An enum member that aliases another (`A = B`) should be skipped rather than guessed at.
- A resolved name is evidence about *this* capture. A different screen may send a different member
  of the same enum.
