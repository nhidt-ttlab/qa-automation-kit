---
name: create-testcase-steps-ui
description: Create or update UI-assisted (browser/Playwright) test-step documents for web application screens — the `U`-series step matrix under the project's UI test-steps folder. Use when the user asks for UI test steps, Playwright test steps, a module CRUD map, or coverage for the UI-only SpecIDs a module's inventory excluded from the API suite. Also use when a hardening/refactor checklist (CSV or sheet) must be routed into test cases — this skill owns the routing step that assigns each row a module, SpecID and lane before any file is written.
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

# Create Testcase Steps — UI

Use this skill when the user wants **browser-driven, step-level test documents**: the `U`-series
files under `<paths.steps>/ui/<module.stepDir ?? module.docSlug ?? module.id>/`, which drive
Playwright through the real screen instead of calling endpoints.

This is the UI sibling of `create-testcase-steps`. That skill covers `API-driven` cases and stops
at the API boundary; this one covers what the API suite **structurally cannot** reach.

**Desktop windows are in this lane too.** When the project's config has a `desktop` block (an Electron
app driven through WebdriverIO), a screen may be a window of that app. Write its step docs here, in the
same `U` series and the same matrix. Name the window in the Screen column (e.g. `desktop: Diagnostics`),
and write Targets in the same `id=` / `testid=` / `role=…[name="…"]` / `text=` grammar. Resolve selectors
from the app's renderer source. Two differences change what you write:

- a desktop run has **no read-only guard**, so a data-changing step must say which writes switch gates it
  and how its data is cleaned up;
- it has **no network trace**, so a server-side effect is asserted by an API read after the window step.

Below, `<module-dir>` means `module.stepDir ?? module.docSlug ?? module.id` and `<doc-dir>` means
`module.docSlug ?? module.id`, for the module in `modules[]` that owns the rule.

Where each pass lives:

| Pass | Skill / guide | Output |
|---|---|---|
| Inventory | `create-testcase-inventory` | the module's test-case inventory under `<paths.featureDocs>/<doc-dir>/` (including the UI-only exclusion list) |
| Scenario | `create-testcase-scenarios` | the module's scenario doc(s) under `<paths.featureDocs>/<doc-dir>/` — **API-driven only** |
| Steps, API | `create-testcase-steps` | `<paths.steps>/api/<module-dir>/TC-<ID>-<slug>.md` |
| **Steps, UI (this skill)** | **this skill** | **`<paths.steps>/ui/<module-dir>/TC-<module.tcPrefix>-U<nn>-<slug>.md`** |
| CRUD map (optional pre-pass, this skill) | this skill | `<paths.steps>/ui/<module-dir>/CRUD-MAP.md` |
| Automation | `create-scenario-script`, following the UI-assisted and scenario sections of `templates/automation-guide.md` | `<paths.suites>/<module.suite ?? module.id>/ui/<slug>.scenario.ts` |

The knowledge file names the exact inventory, scenario and classification filenames for this project.

This skill does **not** write automation code and does **not** run scenarios.

## Three entry paths

A UI test-step doc arrives from one of three places. Identify which before writing anything — they
have different sources of truth.

**Path A — a UI-only SpecID.** The module's API/UI classification document (in
`<paths.featureDocs>/<doc-dir>/`) classified the row `UI`, so the inventory dropped it into its
UI-only list and the scenario pass excluded it by design. **There is no scenario doc for these.**
Source of truth = the inventory's UI-only row + the reason column of the classification document +
the live screen. Example: `TC-ORD-U01` — a row-number column generated on the client.

**Path B — the UI half of a rule that already has an API test case.** The scenario doc already
carries the business rule; you are adding a second verification layer, not a second rule. Source
of truth = the existing scenario section (reuse it, do not rewrite the rule) + the part of the
rule that the classification document marked as display behaviour. Example: `TC-ORD-U02` covers the
same four SpecIDs as `TC-ORD-L06` but reads the rendered cell instead of the DTO.

Path B **requires** the "Relation to the API test case" comparison table in section 1. If you
cannot fill in *What is compared / What defect it catches / Blind spot* with three genuinely
different answers, the UI case is duplicate coverage — say so and stop instead of writing it.

**Path C — a hardening / refactor checklist (CSV or sheet).** The user hands over a checklist from
`<paths.checklists>` (the knowledge file lists real examples). These rows are **candidates, not
test cases**: they are end-to-end business flows written by QA, they carry no SpecID, and most of
them are not UI cases at all. A checklist row is never the source of truth for a test case — the
SpecID it maps to is.

Path C **requires routing before writing** (see *Routing*, below). Running the gate straight on
checklist rows and dropping whatever fails is the known failure mode: it silently discards rows
that belong to the API lane.

The CRUD map (see *Module CRUD map*) is not an entry path; it is a preparation pass that feeds
Path A/B/C files about forms.

## Routing — Path C only, and it runs BEFORE the gate

A checklist row must be resolved along three axes before it is allowed near the gate:

| Axis | Question | If unanswerable |
|---|---|---|
| **Module** | Which module owns this rule? Take the `id` from `modules[]` in the config (match on `featureCodes`) | Stop — a row routed to the wrong module lands its test case in the wrong folder and breaks the path-based join key |
| **SpecID** | Which SpecID(s) in that module's field-level spec under `<paths.featureDocs>/<doc-dir>/` state this rule? | **No SpecID ⇒ no test case.** It is a question for BA, recorded as such. Do not invent a rule to cover it |
| **Lane** | Does the verification need the browser (`UI`), or does the API reach it (`API`)? | Default is **API**. The UI lane must be earned, per the gate below |

Do not assume the checklist's own grouping is the module boundary. QA writes checklists from the
screen the tester sits on, so a row filed under "ORDERS" is routinely a warehouse or contract rule
observed from the order screen.

Write the result to `checklist-routing.md` next to the checklist, one row per checklist row:
`# | Row | Target module | SpecID | Lane | Verdict | Notes` (use the locale's column labels — see
the knowledge file). This file is a **required deliverable** of any Path C pass — it is the
hand-off to `create-testcase-steps`, and without it every row the gate rejects is lost.

## Gate — cases that must NOT be written

The gate decides **UI or not UI**. It does *not* decide whether a rule is testable at all — that is
the routing step's job, and it runs first.

Write a UI case only when the rule falls into a group where the API is blind:

| Group | Example | Why the API cannot catch it |
|---|---|---|
| Rule generated entirely on the client | row numbers, client-side pagination | no endpoint returns that value |
| Display layer of a rule that already has an API case | date format, truncation when many rows | the API returns the raw value; formatting lives in the cell renderer |
| Column bound to the wrong source | `field` points at the wrong DTO branch | both sides of an API test are the same DTO ⇒ tautology |
| Browser-native platform flow | sign-in, session restore, permission-hidden menus | the contract lives in storage/router, not in a response |
| Form wiring and validation | required field blocks save, no write request leaves the browser | the API test proves the endpoint contract, not that the form is bound to it |

Every gate verdict is one of **three** values. Never just two:

| Verdict | Meaning | Where the row goes next |
|---|---|---|
| `→ UI` | Real UI failure mode — write the file | this skill |
| `→ API lane` | Genuine rule, but the browser is the wrong instrument | `create-testcase-steps`, via `checklist-routing.md` |
| `✖ rejected` | Not a test case at all: duplicate coverage, or out of scope | nowhere — but record why |

**`→ API lane` is the default for anything the browser cannot do**, and it is a *routing* outcome,
not a rejection. In particular, **"needs to write data" is never a reason to drop a row.** The
non-GET guard is a property of the browser runtime (the kit's route guards, switched by
`safety.allowWritesEnv`), not of the product. The API lane writes freely and can run full
create → verify → delete lifecycles.

Refuse outright (`✖ rejected`, and record the reasoning) only when the rule is:

- Sort / filter / search / pagination on a grid. That is testing the grid library, not the
  product. (The knowledge file names any inventory note that already scopes this family out.)
- Already covered by an API case at the **same** layer — a UI rerun of an API assertion buys
  nothing and costs flake.
- A business rule with no display component at all. It belongs in the API pass — that is
  `→ API lane`, not `✖ rejected`.

For form cases, an assertion is duplicate coverage when it can be stated as request/response
without the browser:

| May be asserted (UI) | Must not be asserted here (belongs to the API) |
|---|---|
| Which field is marked invalid | HTTP status of the request |
| Whether any write request left the browser | Error code in the response body |
| Save button `disabled` / `enabled` | Whether the record was created in the database |
| The form keeps the entered data after an error | Field value after backend normalisation |
| Whether a message is **displayed** | Message text defined by the backend |

### Every blocker must name its layer

When a candidate is held up, the blocker entry **must** state which layer it belongs to. A blocker
recorded without a layer gets read as "impossible" and the row dies:

| Layer | Meaning | Is it a real blocker? |
|---|---|---|
| `browser` | The browser driver lacks a verb, or the non-GET guard fires | **No** — reroute to the API lane |
| `API` | The endpoint genuinely does not exist | Yes, but verify against the OpenAPI spec (via the API MCP server, `mcp.apiServerName`) before claiming it |
| `environment data` | The endpoint works; the test environment has no data in the required shape | Yes — name the exact fixture that would unblock it |
| `product` | The feature does not exist in the product | Yes — this is a finding to report, not a test gap |

Before recording a `browser` blocker as terminal, check whether the API lane already has the
capability. File import (multipart upload) and file export (binary responses) are usually available
to the API harness's HTTP client even when the browser driver cannot do them — the knowledge file
confirms what this project's client supports. So they are **not** blocked project-wide, only in the
browser driver.

Reuse instead of duplicating: several UI-only SpecIDs are often the *same* rule on different grids
(a row-number column listed as five SpecIDs on five grids). Write **one** test case parameterized
over the grids, not five near-identical files — but only after the formula is confirmed identical
across them. Where two grids compute it differently, that divergence is an open question for BA,
not something to pick a winner on.

## Required inputs

Read these before writing any file:

1. `templates/automation-guide.md`, **UI-assisted test cases section** — the authoritative rules
   for UI-assisted cases.
2. `templates/ui-test-steps.md` — copy the section list, do not reinvent it. Its section 0 is the
   gate; its ID-conventions block is the ID contract.
3. The source for the path you are on (see **Three entry paths**), always including the module's
   API/UI classification document — its reason column is the evidence that the rule is UI at all.
4. Style references — existing step docs that have been run live. The knowledge file lists them
   (at least one Path A, one Path B with a filled relation table, and one platform flow with `Ready`
   status). Model new docs on them.
5. The harness contracts you must write against, not guess at (from the kit packages, or the
   project's own wrappers when the knowledge file names them):
   - `LocatorSpec` in `@qakit/ui` — selector strategies and priority; `UiDiagnostics`
   - `UiDriver` in `@qakit/ui` — the action verbs a step may use
   - the shared UI checks in `@qakit/ui` (`checkNoPageErrors`, `checkRequestObserved`,
     `checkNoEscapedWrites`, `checkFormBlocksSave`, …)
   - `EvidenceKind` in `@qakit/core` — the evidence vocabulary
6. `web` in the config: `baseUrl` (the UI target), `loginPath`, `authMode`, `widgets` (which widget
   adapters — e.g. a component library or a data-grid library — drive the screens; the knowledge
   file describes their quirks), `viewport`.

## Resolving selectors

This is the UI counterpart of resolving `actionId` in the API pass, and the same rule applies:
**observed, or `[needs confirmation]` — never guessed.** A selector invented from a naming
convention looks right in review and fails at run time.

Two ways to observe, in order of preference:

1. **The live screen, via the UI MCP server** (`mcp.uiServerName`). Session lifecycle:
   - `mcp__<mcp.uiServerName>__ui_open_session` with `authMode` = `web.authMode`
   - `mcp__<mcp.uiServerName>__ui_open_screen` with an app-relative path on `web.baseUrl`. Use the
     URL form that carries every scope the screen needs (for example a tenant or project segment) —
     apps often drop the selected scope when the URL does not carry it. The knowledge file documents
     the project's URL conventions.
   - `mcp__<mcp.uiServerName>__ui_describe_screen` for interactive controls with their real `id` /
     `testid` / role (pass `within` to scope to a tab panel or modal)
   - `mcp__<mcp.uiServerName>__ui_read_grid` for real column ids
   - `mcp__<mcp.uiServerName>__ui_act` only to reach a conditional control (open a modal, switch a
     tab) — always with a `reason` and an `expect` wait condition
   - `mcp__<mcp.uiServerName>__ui_capture_evidence` when a screenshot/DOM/grid snapshot of what you
     observed belongs in the doc's notes
   - `mcp__<mcp.uiServerName>__ui_close_session`

   `ui_assert` (its `testId` must match `ids.checkRef`) and `ui_finish_run` record a verdict run;
   they belong to exploratory runs, not to this authoring pass. Runs are read-only by default: every
   non-GET to an allowed host (`web.allowedHosts`) is aborted at the route layer unless
   `safety.allowWritesEnv` is set, and destructive-looking actions are refused.
2. **The web application source**, when the control is conditional or the grid is data-dependent:
   read the grid's column definitions to get column ids (a grid column id usually falls back to the
   bound `field` when no explicit id is set — the knowledge file names where column definitions and
   the shared grid component live).

If the UI MCP server cannot reach the target in this session, use the project's screen-control
probe script if it has one (the knowledge file names it and how to run it) before falling back to
`[needs confirmation]`.

`LocatorSpec` picks **one** strategy by priority; it does not AND its fields. A spec with both
`css` and `text` runs the higher-priority strategy page-wide and can match an element behind a
modal. Narrow with `within`, never by adding fields to the same spec.

Record every target in section 9's **Selector stability** table with the strategy used and whether
a `data-testid` should be requested from the web team. That table is the backlog that gets test ids
added.

## Module CRUD map — optional pre-pass for form cases

Before writing a batch of form (create / edit / delete / validation) cases for a module, write
`<paths.steps>/ui/<module-dir>/CRUD-MAP.md` from `templates/crud-map.md`.

- **It is not a step matrix.** It maps *what there is to test* and *where to aim*: screens with
  forms, their add/edit/delete/import routes, form fields, action buttons, candidate cases,
  blockers, and spec-vs-app divergences. No assertions, no steps, no test-case IDs.
- Every route, selector and required flag is **observed** (live screen or source) or
  `[needs confirmation]`. A route is the app-relative path observed to open the screen, not one
  inferred from the router config.
- Record required flags twice: as the app marks them and as the spec states them. **A mismatch is a
  finding, not a typo** — list it in the divergence section. A probe that reads only the component
  library's standard required marker undercounts: fields whose marker is drawn by hand are missed,
  so "not required" from a probe is not evidence until source confirms it.
- When several screens share one generic form shell, say so: their cases are parameterized over
  the entity key, not rewritten per screen.
- Candidate cases use two groups — **CRUD flow** (`C-1` create with all fields, `C-2` create with
  required fields only, `C-3` edit then reopen, `C-4` delete with confirm/cancel, `C-5` abandon a
  half-filled form creates nothing, `C-6` navigation and list refresh after save) and **form
  validation** (`D-1` required field blocks save, `D-2` cross-field constraint, `D-3` format / value
  range, `D-4` uniqueness warning, `D-5` control state, `D-6` server error shown in place). Mark
  which run read-only now and which wait for write access. Record every candidate the gate rejects,
  with the reason — dropping silently loses the trail.
- Include the exact probe command and target list used, so the next person reproduces the same set
  of screens.

Error-message assertions come in two levels. **Hard, structural**: "exactly one error attached to
field X" and "zero write requests" — independent of wording. **Soft, content**: the exact string,
recorded as observed from the app, marked `[needs confirmation]`, listed in section 10, and excluded
from the verdict until BA confirms it. Reversing the two levels produces a wall of false reds when
the web team edits a translation.

## Traceability contract

Filename starts with the TC id verbatim (`TC-<module.tcPrefix>-U<nn>-<slug>.md`, matching
`ids.testCase`); directory is `<paths.steps>/ui/<module-dir>/`. Cross-cutting platform flows (sign-in,
session) go under the cross-cutting module's folder with its `tcPrefix` (see `modules[].description`
and the knowledge file). No frontmatter — the path is the join key.

> **Do not widen the inventory gap.** If the module's test-case inventory does not declare the
> `TC-*-U*` ids, every UI test case has **no source of truth**: it cannot be traced back to a SpecID,
> and the UI-only items the classification document sets aside are never picked up by any later
> layer.
>
> When you write UI steps, say explicitly in the report which SpecIDs they cover, so the inventory
> can be corrected later. Do not let the step file remain the only record.

## Hard rules

- **1 test case = 1 file**, one business rule. Never merge, split, or renumber.
- **`U`-series IDs only.** Never reuse an API test case's ID even for the identical rule and
  SpecID: assertion references (`ids.checkRef`, e.g. `TC-ORD-U02 / A2`) are load-bearing in the run
  store and on the dashboard, and a shared ID makes `TC-ORD-L06 / A2` mean two different things
  depending on the run. Keep the `U` range sequential per module; do not carve sub-ranges by case
  type — track the type in the module checklist instead.
- **Do not invent** selectors, column ids, endpoints, permission strings, or field names. Not
  observed ⇒ `[needs confirmation]`.
- **Every case asserts `pageErrors` = 0** as its last assertion, via `checkNoPageErrors`. Never
  assert on `consoleErrors` against a deployed target — production builds commonly strip application
  console calls, so it reads 0 even when the app is broken. Uncaught exceptions survive minification.
- **Preconditions are probed over the API before the browser opens**, and a failed precondition is
  `BLOCKED`, never `FAIL`. Apps commonly remove ungranted menu items and tabs entirely, so a missing
  permission is visually identical to a broken page. The knowledge file names the permission
  endpoint and the permission-string format.
- **The oracle must be independent of the layer under test.** Comparing a rendered cell against
  the same screen's own list response compares the list with itself — take the baseline from the
  detail endpoint or another source, and say in section 9 where it came from.
- **Split Setup / Execute / Verify.** Verification folded into an action step is a document defect.
- **Boundary cases get their own steps**, not an extra clause on the main step.
- **Missing data is not a failure.** An assertion that cannot be observed is `NOT_EVALUATED` with
  the specific data needed to unblock it; only wrong product behaviour is `FAIL`.
- **Values compared in a check are normalised conclusions.** Run-varying details (HTTP status, final
  path) go into step data, not into the compared string.
- **Do not write section 11 (`Automation findings`).** It exists only after automation has traced
  real behaviour.
- **Do not edit the inventory or scenario docs from this pass.** Record divergences in
  `Open questions` and let a separate pass update the source of truth.

## Expected output structure

Per file, sections 1–10 of `templates/ui-test-steps.md`, in order, with the template's headings in
the project's locale:

1. Title + `> **DRAFT**` banner naming which assertions are still open and why (status `Draft` while
   anything is unconfirmed; `Ready` only when it runs end-to-end with concrete evidence)
2. `## 1. Test overview` — plus the `[UI]` rows (`UI target` = `web.baseUrl`, `Screen path`,
   `Auth mode`) and, on path B, the "Relation to the API test case" table
3. `## 2. Business rule in one paragraph` — business language, no selectors, no endpoints
4. `## 3. Traceability to API feature` — SpecID ↔ field taken from the `SpecID | Field` table of the
   classification document, with its reason quoted verbatim for the UI part
5. `## 4. Test data` — including manual pin flags where the scenario supports them
6. `## 5. Preconditions` — each with an API probe and `BLOCKED` semantics
7. `## 6. Step matrix` — `Step | Phase | Action | Target (selector) | API observed / actionId |
   Input | Expected result | Evidence to capture`
   - `Phase` is exactly `Setup | Execute | Verify | Cleanup`.
   - `Action` maps to a real driver verb: `goto | click | fill | press | select | switchTab |
     gotoPage | readText | readSelectValue | countMatching | readControlState | pickInModal |
     confirmModal | closeModal | readGrid | editGridCell`. An action the driver cannot perform means
     the step cannot be automated — say so.
   - `Target (selector)` uses the canonical form, scopes separated by ` >> `, index as `[n]`:
     `id=input-search-orders` · `testid=input-username` · `role=button[name="Sign in"]` ·
     `label=Username` · `text=Totals by supplier` · `css=.grid-pinned-left [col-id="rowNumber"]`.
     Priority `id` → `testid` → `role` → `label` → `placeholder` → `text` → `css`, matching
     `LocatorSpec`. Every `css=` is justified in section 9. Avoid `label`/`text` where possible —
     visible strings are bound to translation files and break silently when wording changes.
   - `API observed / actionId` is the request the UI is **expected to fire on its own** (observed
     evidence), not a request we send, written as the API MCP's actionId
     (`<apiSource>::<METHOD>::<path>`, e.g. `shop::GET::/api/orders/{id}`). Leave it empty for a
     purely client-side action. When the step must wait for **one specific** response, write the
     wait condition in the cell: `… (wait: keyword=<order number>)`.
   - `Evidence to capture` uses the fixed vocabulary, 1:1 with `EvidenceKind`: `screenshot` →
     `screenshot` · `dom` → `dom_snapshot` · `grid-rows` → `grid_snapshot` · `network` →
     `network_har` · `console` → `console_log` · `trace` → `trace_zip` · `video` → `video`.
8. `## 7. Assertions` — stable IDs matching `ids.assertion`, `pageerror` assertion last. When the
   case came from a hardening checklist, add a `Checklist row` column mapping each assertion to its
   checklist row id (`—` for the scenario's own preconditions), so the doc records the mapping the
   scenario encodes. Put the row id in that column and **only** there — do not paste the sheet's
   `Expected Result` text or its priority into the doc: the scenario reads both from the checklist
   through the project's checklist import (the knowledge file names the command), and a second
   hand-copy is exactly what drifts. One assertion may answer several rows; list them all. Drop the
   column when the case did not come from a checklist
9. `## 8. Pass / fail rule` — in assertion IDs, spelling out `NOT_EVALUATED` and `BLOCKED`; the run
   verdict vocabulary is `PASS | PARTIAL | FAIL | BLOCKED | ERROR`, and a partially provable case is
   never collapsed into `PASS`
10. `## 9. Notes for automation` — with the `[UI]` sub-blocks: Independent oracle · Wait conditions ·
    Reading the data grid (when a grid is read) · Selector stability · Read-only mode
11. `## 10. Open questions / [needs confirmation]` — each item states what is unknown, why it could
    not be observed, and what unblocks it; "no data to observe" and "product is wrong" are never
    mixed

What the `[UI]` sub-blocks of section 9 must say:

- **Independent oracle** — where the baseline comes from and why it is not the layer under test.
- **Wait conditions** — the exact response to wait for (with percent-encoded query parameters) and
  every debounce / trigger condition of the control. Waiting on a bare path is wrong when the page
  fires an unfiltered request to the same path on mount: the wait is satisfied instantly and the
  grid is read before it updates.
- **Reading the data grid** — how column ids were derived (from column definitions, not header
  labels); how pinned columns are merged (many grid libraries render pinned columns in a separate
  row container sharing the row index — merge by row index, not DOM order, or the pinned column is
  lost); that dataset size is never inferred from DOM row count (grids that paginate client-side
  over one server page hold at most the current page); and the explicit viewport (`web.viewport`),
  because column virtualisation and height-from-window layouts render a different grid at another
  size.
- **Selector stability** — `Target | Strategy used | Recommendation` for every `css=` or bare `id`
  target.
- **Read-only mode** — the harness aborts non-GET requests by default; there is typically one shared
  QA credential and UI-created data is not cleaned up automatically. If the case must write, say so,
  name the explicit opt-in (`safety.allowWritesEnv`), stamp created records with
  `safety.testDataMarker`, and describe cleanup.

## Recommended workflow

1. Establish the entry path (A, B or C) and the exact source rows. Count the test cases you intend
   to write; that count is the scope boundary.
2. **Path C only — route first, gate second.** Resolve module + SpecID + lane for every checklist
   row and write `checklist-routing.md`. A row with no SpecID never becomes a test case; it becomes
   a BA question.
3. Run the gate on each candidate that routing sent to the UI lane. Report what you dropped and why
   **before** generating files — for most modules the UI-only list shrinks by more than half. Use
   all three verdicts; anything blocked at the `browser` layer is `→ API lane`, not `✖ rejected`.
4. For a batch of form cases, write or refresh the module's `CRUD-MAP.md` first.
5. Observe selectors live (see **Resolving selectors**) and note the column ids, control `id`s, and
   the request each action triggers. Do this before writing, not after — the step matrix is
   unwritable without it.
6. Write the files, path B ones alongside the API case they pair with so the relation table can be
   filled from the real scenario section.
7. Update the UI checklist: the module's `<paths.steps>/ui/<module-dir>/CHECKLIST.md` and, when
   the project keeps one, the overview `<paths.steps>/ui/CHECKLIST.md` (create them from the shape
   of the API checklist, `<paths.steps>/api/CHECKLIST.md`, if they do not exist yet). Record each
   case's type (display / validation / CRUD).
8. Close with a summary: files written, which are `DRAFT`, which assertions are `NOT_EVALUATED`
   and what data would unblock each, which SpecIDs each file covers, and which candidates the gate
   rejected. **Every row sent to `→ API lane` is named explicitly**, with its module and SpecID, as
   a hand-off — not buried in a count of what was dropped. A rejected row and a rerouted row are
   different outcomes and must never be reported in the same bucket.

## Verification before declaring done

- Path C: `checklist-routing.md` exists and accounts for **every** source row — routed, rerouted or
  rejected. Rows out must equal rows in.
- Path C: no row was rejected solely because it writes data, imports a file, or downloads a file.
  Those are `browser`-layer blockers and belong to the API lane.
- Every ID is `U`-series, matches `ids.testCase`, and collides with nothing in
  `<paths.steps>/api/`.
- Every selector in every file was observed, or is explicitly `[needs confirmation]`.
- Every action maps to a real driver verb; every evidence token maps to a real `EvidenceKind`.
- Every file ends its assertion table with the `pageerror` check.
- Path B files all carry a filled-in relation table.
- Every `NOT_EVALUATED` assertion names the concrete data or BA decision that would resolve it.
- A `CRUD-MAP.md`, when written, has no test-case IDs, assertions or steps, and every
  spec-vs-app required-flag mismatch is in its divergence section.

## Avoid

- Writing a UI case for a rule the API suite already covers at the same layer
- Deriving a column id from a column header label rather than from `field` / `colId` in source
- Waiting on a bare path (`/api/orders`) when the page fires an unfiltered request of its own on
  mount — the wait satisfies instantly and the grid is read before it updates
- Inferring dataset size from DOM row count
- Leaving the viewport implicit — use `web.viewport`
- Turning "the environment has no data for this" into a `FAIL`
- Filling coverage gaps with self-invented test cases, or writing five files for one rule that
  repeats across grids
- Treating a checklist row's own grouping as its module — QA files rows by the screen they sat on,
  not by the module that owns the rule
- Reporting rerouted rows and rejected rows in one bucket, or closing a Path C pass without
  `checklist-routing.md`
- Predicting UI defects from the web source alone — the deployed build can differ from the checkout;
  measure on the live screen
