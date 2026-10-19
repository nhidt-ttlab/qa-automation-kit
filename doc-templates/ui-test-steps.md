# Template: UI-assisted test steps

Use this template when `Test type` is `UI-assisted` or `Hybrid`. For a pure API testcase, use
[`api-test-steps.md`](api-test-steps.md).

The section structure (numbers and titles) of sections 1–10 is **kept identical** to the API-driven
template so every tool/skill can read both. Sections that differ are marked **[UI]**.

Conventions come from the automation guide (`automation-guide.md`, §1.5). Worked examples that have
actually run are listed in `<paths.knowledge>/doc-templates.md`.

---

## 0. Gate — should this UI testcase exist at all?

**[UI]** This section does not go into the output file; answer it **before** copying the template.
A browser test is an order of magnitude more expensive and brittle than an API test, so write one only
when there is a failure mode the API is blind to.

Write a UI testcase when the rule falls into one of these groups:

| Group | Example | Why the API cannot catch it |
|---|---|---|
| Rule produced entirely on the client | Row numbering, client-side pagination | No endpoint returns that value |
| Display layer of a rule that already has an API test | `DD/MM/YYYY` formatting, truncation when there are many lines | The API returns the raw value; formatting/truncation lives in the cell renderer |
| Column bound to the wrong source | A grid column's `field` points at the wrong DTO branch | Both sides of the API test are the same DTO ⇒ tautology |
| Browser-native platform flow | Sign-in, session bootstrap, permission-hidden menus | The contract lives in browser storage / the router, not in a response |

**Do not** write a UI testcase for sort / filter / search / pagination of a grid (that tests the grid
library, not the product), nor for any rule an API testcase already covers **at the same layer**.

If the source SpecID is classified `UI` with a reason in the module's API/UI classification document
(under `<paths.featureDocs>/<module>/`; its file name is in the knowledge file) — quote that reason
verbatim in section 3. It is the strongest evidence that this testcase should exist.

## ID and file location conventions

**[UI]**

- **IDs use a separate `U` series**: `TC-ORD-U01`, `TC-CUS-U01` — `TC-<module.tcPrefix>-U<nn>`, valid
  against `ids.testCase`. Do not reuse the ID of an API testcase even when it covers exactly the same
  rule and SpecID — if they share one, `TC-ORD-L06 / A2` carries two meanings depending on which run you
  look at, which breaks traceability in the run store and on the dashboard. Shared platform flows
  (sign-in, session) use the cross-cutting module declared in `modules`, with its own `A` series.
- **Location**: `<paths.steps>/ui/<module dir>/TC-<ID>-<slug>.md`, where `<module dir>` is
  `<module.stepDir ?? module.docSlug ?? module.id>` — the `ui/` folder sits next to `api/`. Shared flows
  live in the cross-cutting module's folder.
- **Matching scenario**: `<paths.suites>/<module.suite>/ui/<slug>.scenario.ts`, with its name declared in
  the project's UI scenario name registry (location in the knowledge file).

## Status

- Test step status: `Draft` or `Ready`
- Use `Draft` when any selector, rule, assertion, dependency or evidence path is still open, blocked,
  or still marked `[to be confirmed]`.
- Use `Ready` only when it runs end-to-end with concrete steps, concrete evidence and a clear pass/fail.
- If `Draft`, add a short banner under the title, e.g. `> **DRAFT** — ...`, naming exactly which
  assertion is pending and why.

## 1. Test overview

| Field | Content |
|---|---|
| Test case ID | `TC-<module.tcPrefix>-U<nn>` |
| Test case name | Business rule name, short |
| Test step status | `Draft` or `Ready` |
| Module | Example: `Orders — Order list` |
| Source feature doc | Relative link to the source (scenario section with an anchor, or the UI-only row in the inventory) + the module's API/UI classification document |
| Covered SpecID | Example: `ORD-7` |
| Primary rule | One sentence stating the rule being verified |
| Test type | `UI-assisted` or `Hybrid` |
| **[UI] UI target** | `<web.baseUrl>` of the environment, e.g. `https://shop.example.test` |
| **[UI] Screen path** | Example: `/stores/:storeId/orders` |
| **[UI] Auth mode** | `storage` (pre-seeded session) · `form` (real sign-in) · `none` (the scenario signs in itself) — default from `web.authMode` |
| Priority | Copy from the source if it has one |

**[UI] Relationship to the API testcase** — mandatory when an API testcase already covers the rule.
State at which layer the two differ; if you cannot, this is duplicate coverage and the testcase should
not exist:

| | `TC-<ID>` (API-driven) | `TC-<ID>` (UI-assisted) |
|---|---|---|
| What it compares | | |
| What defect it catches | | |
| Blind spot | | |

## 2. Business rule in one paragraph

Describe in business language: state before the action → event → expected result.
No technical field names, no endpoints, no selectors. The reader is a BA.

## 3. Traceability to API feature

Take the SpecID ↔ field mapping **directly from the `SpecID | Field` table of the classification
document**, not by inferring from listing order. That table's reason column is the source for which part
of the rule is UI behavior — quote it verbatim.

| SpecID | Feature field / rule | **[UI]** Part the classification marks as UI | Why this test needs it |
|---|---|---|---|
| `ORD-xxx` | Field or rule name | Verbatim quote, or `—` if the rule is purely client-side | Reason |

## 4. Test data

| Key | Value | Notes |
|---|---|---|
| `storeId` | | Where it comes from: API probe, fixture, or a prior step |
| `<entity>Expected` | | **[UI] The oracle must be independent of the layer under test** — see section 9 |

**[UI]** Record the manual pin flag when the scenario lets you fix the data (e.g. `--order-id <id>`), so
whoever reruns it does not depend on auto-discovery landing on the same record again.

## 5. Preconditions

| ID | Condition | How to verify / prepare | Evidence |
|---|---|---|---|
| `P1` | **[UI] Permission:** `Orders.Order.Read` | The backend endpoint that lists the signed-in user's granted permissions | Response |
| `P2` | Minimum data to observe the rule | Call the list API, count `totalCount` | Response |

**[UI] Permission convention:** write the exact permission string the backend grants. Front ends
commonly **drop** ungranted tabs/menus entirely, so a missing permission looks identical to a broken
screen. Every precondition must be checked **over the API before opening a browser** (the project's
availability probe, named in the knowledge file) and return `BLOCKED`, **not** `FAIL`.

## 6. Step matrix

**[UI]** Compared with the API template: adds a `Target (selector)` column; renames `API / actionId` →
`API observed / actionId`.

| Step | Phase | Action | Target (selector) | API observed / actionId | Input | Expected result | Evidence to capture |
|---|---|---|---|---|---|---|---|
| `S1` | Setup | Find data satisfying the precondition | — | `shop::GET::/api/orders` | — | A record satisfies `P2` | network |
| `S2` | Setup | Read the source data used as oracle | — | `shop::GET::/api/orders/{id}` | | Baseline is not empty | network |
| `S3` | Execute | Open the screen | — | `shop::GET::/api/orders` | `storeId` | Grid is displayed | screenshot, network |
| `S4` | Execute | User action | `id=input-search-orders` | `shop::GET::/api/orders` (`wait: keyword=<order no>`) | | Action succeeds | screenshot, network |
| `S5` | Verify | Read back the rendered data | `css=[col-id="rowNumber"]` | — | — | Values follow the rule | grid-rows |
| `S6` | Verify | Check there is no JavaScript error | — | — | — | `pageErrors` = 0 | console, trace |

Authoring rules:

- One row = one verifiable action. Split `Execute` and `Verify`; hiding a verification inside an action
  step is a defect of the document.
- Edge cases get their own step group (`S6`–`S8`), not folded into the main case.
- Phase uses exactly: `Setup | Execute | Verify | Cleanup`.
- **[UI] `Action`** must map to a real driver verb of the kit's UI driver (`@qakit/ui`):
  `goto | click | fill | press | selectOption | switchTab | gotoPage | readText | readSelectValue |
  countMatching | readControlState | pickInModal | confirmModal | closeModal | readGrid | editGridCell`.
  An action the driver cannot perform means the step cannot be automated.
- **[UI] `Target (selector)`** uses the canonical form, scopes separated by ` >> `, index as `[n]`:
  `id=input-search-orders` · `testid=input-username-login` · `role=button[name="Sign in"]` ·
  `label=User name` · `placeholder=Search` · `text=Total by supplier` ·
  `css=.grid-pinned-left [col-id="rowNumber"]`
  - Order of preference `id` → `testid` → `role` → `label` → `placeholder` → `text` → `css`, matching the
    kit's `LocatorSpec` resolution order (`domId | testId | role | label | placeholder | text | css`).
    Projects that deviate record why in the knowledge file.
  - **A selector must be observed on the live screen or in the web app's source** — never invented from
    naming conventions. Probe with `mcp__<mcp.uiServerName>__ui_describe_screen`; see the UI test-steps
    skill, section "Resolving selectors".
  - Using `css=` must be justified in section 9.
  - Avoid `label`/`text` where possible: visible strings are bound to the translation files and break
    silently when someone rewords them.
- **[UI] `API observed / actionId`** is the request the UI is **expected to fire on its own** (observed
  evidence), not a request we call ourselves. Leave it empty for a purely client-side action (e.g. row
  numbering). When the step must wait for **exactly one** specific response rather than any request to
  the same path, write the wait condition in this cell: `… (wait: keyword=<order no>)`.
- **[UI] `Evidence to capture`** uses exactly this vocabulary, mapped 1–1 to the kit's `EvidenceKind`
  (`@qakit/core`):

  | Write in the document | `EvidenceKind` |
  |---|---|
  | `screenshot` | `screenshot` |
  | `dom` | `dom_snapshot` |
  | `grid-rows` | `grid_snapshot` |
  | `network` | `network_har` |
  | `console` | `console_log` |
  | `trace` | `trace_zip` |
  | `video` | `video` |

## 7. Assertions

| Assertion ID | Expression | Expected | Checklist row |
|---|---|---|---|
| `A1` | | `true` | `TC_nn` |
| `A2` | **[to be confirmed]** ... | `NOT_EVALUATED` | `TC_nn`, `TC_mm` |
| `An` | No uncaught JavaScript error (`pageerror`) during the whole session | `true` | — |

- The `Checklist row` column holds **only the row id** from the checklist under `<paths.checklists>`.
  Do not copy the sheet's `Expected Result` or `Priority` columns here: the scenario reads them straight
  from the CSV through the project's checklist import step, and a second hand-made copy is exactly what
  drifts. An assertion not derived from the checklist gets `—`; do not invent a row for it.
- Drop the column entirely when the testcase does not come from a hardening checklist.

- IDs are short and stable — automation `check()`, the run store's check rows and the report all cite
  them. The accepted format is `ids.checkRef`: `TC-ORD-U01 / A1` (a lowercase suffix is allowed: `A2b`).
- **[UI] Every UI testcase ends with a `pageerror` = 0 assertion.** This is what a UI test adds over an
  API test: "the page threw a React error but still looks fine". Use `checkNoPageErrors`, **not**
  `checkNoConsoleErrors` (`@qakit/ui`, `createUiChecks`) — production bundles often strip `console.*`
  calls, so console errors can read 0 even when the app is broken, while uncaught exceptions survive
  minification. Whether this project strips them is recorded in the knowledge file.
- Comparison in `check()` uses `===`, so the compared value must be a **normalized conclusion**. Details
  that vary per run (HTTP status, final path) go into `step.data`, not into the compared string —
  otherwise every run FAILs even when the behavior is correct.

## 8. Pass / fail rule

- `PASS` when every mandatory assertion holds and mandatory evidence is captured.
- `FAIL` when a mandatory assertion is false.
- `BLOCKED` when a permission or prerequisite data is missing — **not counted as FAIL**.
- `NOT_EVALUATED` for an assertion that cannot be observed (missing data, rule not settled). Name the
  assertion and why, and **do not count it in the verdict**.
- Verdict vocabulary: `PASS | PARTIAL | FAIL | BLOCKED | ERROR`. Do not collapse a case that was only
  partially verified into a `PASS` shape.

## 9. Notes for automation

- Scenario: `<slug>.scenario.ts`, run with the project's single-scenario command (see the knowledge
  file).
- Dynamic values passed between steps.
- Cleanup steps if data is created.

**[UI] Independent oracle** — the value compared against **must not come from the layer under test**.
Comparing a rendered cell with the list response of the same screen compares the list with itself. The
baseline must come from the detail endpoint, a fixture, or another data source — and say here which.

**[UI] Wait conditions** — the number one source of flakes. A generic wait on a path
(`/api/orders`) is **wrong and fails silently** when the page fires a request to the same path on
mount: the wait is satisfied immediately while the real request has not been sent yet. State here which
response to wait for (with its percent-encoded query parameter), and every debounce/trigger condition of
the control (e.g. a search box that only fires on Enter, then debounces).

**[UI] Reading a data grid** — when the testcase reads a grid (widget adapters in `web.widgets`), state
here:

- How column ids are derived (e.g. from `field` when no explicit column id is set) — cite the web app
  source.
- Where **pinned/frozen** columns are rendered. Many grid libraries render them in a separate DOM
  container that shares the row index with the main container; the grid reader must merge by row index,
  not DOM order, or it loses exactly the pinned column under test.
- **Never infer dataset size from the number of DOM rows**: a grid that paginates client-side over one
  server page holds at most the current page.
- Column virtualization and viewport-dependent grid height mean **the viewport must be set explicitly**
  (`web.viewport`); a default viewport renders a different grid.

**[UI] Selector stability** — list every target that had to use `css=` or a bare `id`, with an
assessment of whether to ask the web team for a `data-testid`. This section is the backlog for gradually
adding test ids to the application; without it selectors rot unnoticed.

| Target | Strategy used | Proposal |
|---|---|---|
| | | |

**[UI] Read-only mode** — by default the kit's route guard aborts every non-GET request to the hosts in
`web.allowedHosts` (verified read-only POST lookups can be let through per scenario). Writes open only
when `<safety.allowWritesEnv>` is `1`, and data a UI run creates should carry `<safety.testDataMarker>`.
If the testcase must write data, say so here, opt in explicitly, and describe the cleanup.

## 10. Open questions / `[to be confirmed]`

A flat list of every unconfirmed assumption from the sections above. Each item states: what is unknown,
why it could not be observed, and **what is needed to resolve it** (specific data to create, a specific
question for the BA). "Not enough data to observe" is different from "the product is wrong" — never mix
the two.

## 11. Automation findings

**Do not write this in this pass.** Section 11 only exists after the scenario has actually run and
source tracing corrected something in the sections above (see the automation guide, §4 step 6).
