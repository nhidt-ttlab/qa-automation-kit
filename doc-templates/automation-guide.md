# Test Case Authoring Guide

This is the guideline an AI (or human) should follow to produce a new regression test case in a project
that uses the QA automation kit, **in the same shape** as the project's reference test case (named in
`<paths.knowledge>/doc-templates.md`). Paths below are `qakit.config.yaml` keys, relative to the config
file's folder; `<module dir>` means `<module.stepDir ?? module.docSlug ?? module.id>`. A test case always
has up to **three artifacts**, produced in this order:

| # | Artifact | Location | Written by | When |
|---|---|---|---|---|
| 1 | Test-steps spec (`.md`) | `<paths.steps>/api/<module dir>/TC-<ID>-<slug>.md` | AI/human, from the feature doc | Before automation exists |
| 2 | Scenario automation (`.ts`) | `<paths.suites>/<module.suite>/<api\|ui>/<slug>.scenario.ts` | AI, while tracing real backend behavior | While/after building automation |
| 3a | Auto-generated QA/QC run report (`.md`) + JSON run artifact | `<paths.reports>/<domain>/<kind>/<TC-ID>/<timestamp>.md` + the same group folder under the harness's outputs tree (`<timestamp>.<runId>.json`) | **Generated automatically** by the kit's report pipeline (`@qakit/core`, `packages/core/src/report/`) through the harness's report wrapper — never hand-write this | Every time the scenario runs |
| 3b | Manual recap report (`.md`) | The project's recap-report folder (knowledge file), `TC-<ID>-<YYYYMMDD>.md` | AI, summarizing one or more runs for a human reader | After a run reveals something worth a written verdict (blocker, bug, PASS confirmation) |

Do not skip #1 to jump straight to code — the spec is what pins down the business rule and the
assertion IDs (`A1`, `A2`, ... matching `ids.assertion`) that the scenario's checks and the recap report
both reference.

Every run of #3a also (a) persists a row to the local SQLite run store (`reporting.sqlite`, best-effort)
and (b) becomes browsable in the local review dashboard, which writes human review decisions and
AI-assisted proposals next to the reports. Neither needs anything from the scenario author beyond
populating `overview`/`reportModel` well (§2.5) — they are downstream consumers of the same
`ReportableResult`, not something you write per test case.

Important: the persisted/generated run verdict is `PASS | PARTIAL | FAIL | BLOCKED | ERROR`. Use
`PARTIAL` when the run proves some assertions but other checkpoints remain blocked or `NOT_EVALUATED`; do
not collapse that shape into a misleading overall `PASS`.

---

## 1. Test-steps spec (`<paths.steps>/api/<module dir>/TC-<ID>-<slug>.md`)

Start from the `api-test-steps.md` template — copy it, don't reinvent the section list. Fill in, in order:

1. **Test overview** table — `Test case ID` (valid against `ids.testCase`), name, `Module`, link(s) to the
   source feature-extraction doc(s) under `<paths.featureDocs>`, `Covered SpecID`s, one-sentence
   `Primary rule`, `Test type` (`API-driven` unless UI interaction is unavoidable), and `Priority` when
   there's bug history to cite (e.g. `**High** (bug history #1201 / #1207)`).
2. **Business rule in one paragraph** — in the project's `locale`, business language only. No field
   names, no endpoints. State: precondition state → user action → expected system behavior, including
   the negative/boundary case if the rule has one (e.g. "must not exceed X").
3. **Traceability to API feature** — one row per covered `SpecID`, with *why this test needs it* spelled
   out (not just restated).
4. **Test data** — every dynamic value the steps will reference (`storeId`, `baselineXxx`,
   `orderIdA`, ...), with a one-line note on where it comes from (a prior step, a fixture,
   auto-discovery).
5. **Preconditions** — `P1`, `P2`, ... each with a concrete API/query to verify it and the expected
   evidence. Mark anything unverified as **`[to be confirmed]`** (the locale's marker) rather than
   guessing — see the §11 notes below.
6. **Step matrix** — one row per verifiable action, columns `Step | Phase | Action | API / actionId |
   Input | Expected result | Evidence to capture`. `Phase` is `Setup | Execute | Verify | Cleanup`. Never
   fold a verification into an action step — split them. When the exact `actionId`/endpoint isn't
   confirmed yet, write `[to be confirmed]` plus your best guess and the reasoning — don't silently
   assume a shape you haven't verified against source (`mcp__<mcp.apiServerName>__load_domain_api_registry`
   lists the real actions).
7. **Assertions** — `A1`, `A2`, ... as one-line expressions with expected value (usually `true`). These
   IDs are load-bearing: the scenario's `check(...)` calls cite them as `ids.checkRef`
   (`'TC-ORD-R02 / A2'`) and the recap report references them directly, so keep them stable once
   automation exists.
8. **Pass / fail rule** — explicit PASS and FAIL conditions in terms of the assertion IDs. Call out any
   assertion that's conditional/best-effort (e.g. blocked by a flaky background job) and state it doesn't
   count against the main PASS/FAIL verdict.
9. **Notes for automation** — which steps already have a confirmed `actionId` vs. which need
   backend-source confirmation first, what values must be threaded between steps, cleanup notes.
10. **Open questions / `[to be confirmed]`** — a flat list of every unresolved assumption from the
    sections above, so the person/AI building automation knows exactly what to verify against source
    before coding it.
11. **Automation findings (source check ..., <date>)** — **added only after automation is built**, once
    you've actually traced the backend source. This section *corrects* the step matrix/assertions above
    rather than editing them in place, so the document keeps an honest record of "what we assumed" vs.
    "what we verified". Structure it as one bullet per correction:
    - What was assumed wrong (cite the step/section)
    - What's actually true, with the exact class/method/DTO field from source (never guess this — read
      the backend source (`apiSources.<source>.repository`) or verified live-call evidence, and say which)
    - Any wire-format gotcha (e.g. request field name ≠ response field name)
    - Anything still not automatable, and why

Write everything in the project's `locale` except code identifiers, endpoint paths, field names, and
error codes — those stay in their original casing/language so they're greppable against source.

---

## 1.5. UI-assisted test cases (browser-driven)

Most rows in the feature-extraction docs are `API`, but each module's API/UI classification document
(under `<paths.featureDocs>`; file name in the knowledge file) also classifies some rows as **UI** —
things no endpoint returns, which the API regression suite structurally cannot cover and which were
therefore dropped at the inventory stage. Those are coverable. The artifacts differ from §1/§2 as
follows:

| # | Artifact | Location |
|---|---|---|
| 1 | Test-steps spec | `<paths.steps>/ui/<module dir>/TC-<ID>-<slug>.md`, from the `ui-test-steps.md` template — authored with the UI test-steps skill |
| 2 | Scenario automation | `<paths.suites>/<module.suite>/ui/<slug>.scenario.ts`, name declared in the project's UI scenario name registry |
| 3 | Evidence (extra) | `<paths.evidence>/<domain>/<kind>/<TC-ID>/<runId>/` — screenshots, `trace.zip`, video, `network.har`, `console.json`, `manifest.json` |

Reports (§3) are unchanged: a UI run produces the same Markdown + JSON + SQLite row as an API run, because
the browser layer synthesizes the same `RequestTraceEntry` the report writer already consumes. The review
dashboard renders its screenshots inline.

Rules specific to UI-assisted cases:

- **Reserve a `U` series for the ID** (`TC-ORD-U01`, `TC-CUS-U01`) so UI cases never collide with the
  planned API numbering.
- **Check preconditions over the API before launching a browser.** Front ends commonly remove ungranted
  menu items entirely, so a missing permission is visually identical to a broken page. Probe granted
  permissions and data volume first, and return `BLOCKED` — never `FAIL` — when they fail.
- **Runs are read-only by default.** Every non-GET to the hosts in `web.allowedHosts` is aborted at the
  browser route layer unless `<safety.allowWritesEnv>` is `1`. Writing must be opted into explicitly,
  mark created data with `<safety.testDataMarker>`, and own its cleanup.
- **Assert on `pageErrors`, not `consoleErrors`.** Production bundles often strip `console.*` calls, so
  console errors can read 0 even when the app misbehaves. Uncaught exceptions survive minification.
- **Never infer dataset size from the DOM.** A grid that paginates client-side over a single server page
  holds at most the current page.

---

## 2. Scenario automation (`<paths.suites>/<module.suite>/<api|ui>/<slug>.scenario.ts`)

Use the project's reference scenario (knowledge file) as the reference implementation. Structure:

### 2.1 Header constants
```ts
const TEST_CASE_ID = 'TC-ORD-Rxx';
const TEST_CASE_NAME = '<short name matching the spec title, in the project locale>';
const TEST_OBJECTIVE = '<one sentence covering every rule this run validates>';
```

Keep `TEST_CASE_ID` a string literal: harness tooling scans scenario files for it to group artifacts.

### 2.2 Options / Result interfaces
- `<Slug>Options`: at minimum `{ <fixture selector>, dryRun?, cleanup? }` plus any override useful for
  manual pinning (e.g. `productSku`, `orderId`) so a flaky auto-discovery can be bypassed.
- `<Slug>Result`: `{ scenario, dryRun, passed, blocked?, blockedReason?, payload(A/B)?,
  payload(A/B)Context?, createdOrder(A/B)?, checks?, steps, error?, overview?, reportModel? }`. It must
  structurally satisfy the kit's `ReportableResult` (`@qakit/core`, `report/result.ts`). `CheckResult`
  and `check` come from `@qakit/core` (`assertions.ts`), usually through the harness's assertions
  re-export. `steps` entries have the kit's `ReportStep` shape (`{ title, ok, status?, data? }`) — reuse
  the harness's shared step type if it has one; don't invent a divergent shape.
  `reportModel?: QaReportModelOverride` (`@qakit/core`, `report/model.ts`) is optional but recommended —
  see §2.5.

### 2.3 Top-of-function JSDoc block
Before the exported `run...Scenario` function, write a JSDoc comment that documents:
- Which testcase doc this implements, and a one-line note on where the doc's assumed step matrix diverges
  from the real backend contract (if it does) — this is where source-tracing results belong in the code,
  mirroring §11 of the spec.
- The exact backend class/method/DTO fields involved, with file references, so a future reader never has
  to re-derive them.
- Any **wire gotcha** in bold, verified live with a date (`WIRE GOTCHA (verified live, YYYY-MM-DD)`).
- How the scenario is split into parts (e.g. "Part A: always runs, no approval needed" / "Part B:
  best-effort, needs approval") and what each part covers.
- `TODO [to be confirmed]` for anything intentionally not covered, with the reason.

This comment is not decorative — it's the only place the "why" of the implementation lives, so write it
as if the next reader has the testcase doc open but not the backend source.

**Architecture boundary (state it explicitly, in a comment above the imports):** a scenario only
resolves data, calls the product's APIs (or drives the browser), and returns its `<Slug>Result`
(steps/checks/overview/reportModel). It must never import the run store, call the persistence function,
or depend on `node:sqlite` — persisting the run is the reporting pipeline's job, which runs *after* this
function returns and is deliberately best-effort (a DB failure must never fail the scenario or block the
Markdown/JSON report from being written). The harness enforces this with an architecture fitness test
(knowledge file).

### 2.4 Function body pattern
1. Resolve prerequisites via the context's data provider, push a `steps.push({ title, ok, status, data })`
   for every meaningful call (discovery, resolution, and every HTTP call the flow makes).
2. If a required precondition isn't met (e.g. no fixture data satisfies `P1`), **return a `blocked`
   result immediately** with a concrete `blockedReason` telling the operator exactly what to fix — never
   fabricate data to force a pass.
3. Honor `options.dryRun`: build the payload(s), return early with `passed: true` and an `overview` that
   says "Dry run: input prepared, no order created." — no live mutation.
4. Boundary/negative checks first (independent of any record created), then the main positive path, using
   the shared `check(label, expected, actual, testId)` helper. The `testId` string must be
   `'<TEST_CASE_ID> / <assertion ID>'` (valid against `ids.checkRef`) matching the spec's §7.
   - Match on the stable error code (the project's error-code extractor / `ReportWording.extractError`),
     never the localized message string.
5. Wrap the live-mutation portion in `try { ... } catch (err) { failed = ... }` so a thrown error still
   reaches cleanup and a report gets written.
6. Treat flaky/known-environment issues (background jobs, approval workflow flakiness) as `blocked`, not
   `failed` — record a human-readable `blockedReason*` and let the checks that *did* run still count
   toward `passed`. Combine several partial blocker reasons into one `blockedReason` at the end.
7. **Cleanup always runs** (unless `options.cleanup === false`), even after a thrown error, and is
   defensive per record (skip if already cancelled, log failure without throwing).
8. Compute `passed` as the scenario's hard-failure signal, not as the final QA verdict. The final verdict
   is derived later by the kit's `deriveVerdict(...)` (`@qakit/core`, `report/verdict.ts`) from `checks`,
   `blocked`, and the `NOT_EVALUATED` marker convention:
   - use `passed = false` for a confirmed product defect or hard execution failure
   - keep `passed = true` when the proven part of the scenario succeeded, even if some other checkpoints
     are blocked or `NOT_EVALUATED`
   - set `blocked` / `blockedReason` for environment, fixture, permission, or unresolved-contract blockers
   - mark unevaluated assertions with the literal string `NOT_EVALUATED` in `expected` and/or `actual`
   This is what lets the final report/DB verdict become `PARTIAL` instead of an incorrect `PASS`.
9. Build `overview` via a local `buildOverview({...})` helper (see §2.5) — only skip it when the run
   crashed (`failed` truthy) before enough context exists to build one. Optionally also build
   `reportModel` via a local `buildReportModelOverride({...})` helper (see §2.5) — same skip condition.

### 2.5 `overview` and `reportModel`: the two report inputs a scenario supplies

The write path always builds a generic `QaReportModel` from the scenario's `steps`/`checks`/`overview`
(the report kit's `buildDefaultReportModel`), then merges the scenario's own `reportModel` override on top
(`mergeReportModel` — override fields win, everything unset keeps the generic value). **`overview` is still
required** — it feeds the generic fallback (report header, key-data list, business-scenario/defect-statement
fallback) even when a scenario supplies a full `reportModel`. **`reportModel` is optional** — write one when
the generic, mechanically-derived fallback wouldn't tell the real business story as well as a hand-curated
one would (this is what distinguishes the reference scenario: every section of its Markdown report is
scenario-authored, not generic).

#### `buildOverview` → `ReportOverview` (`@qakit/core`, `report/result.ts`)
A separate function at the bottom of the file, taking exactly the fields needed to render it:
```ts
interface ReportOverview {
  testCaseId: string;
  testCaseName: string;
  objective: string;
  keyData?: string[];       // "Label `value`" strings: store, customer, product, order numbers
  highlights?: string[];    // 1 bullet per rule this run covers, most important first, in the project locale
  attention?: string;       // the single most important failure/blocker, or undefined if clean
}
```
Rules for filling it:
- `keyData`: every identifying value a reviewer needs to find this run's data in the environment — names
  resolved from ids (not raw ids alone) and every record number created.
- `highlights`: derive each bullet from a specific `checks` entry via `findCheck(label)` — phrase the PASS
  case and the FAIL case explicitly (don't just say "checked X"; say what was confirmed or what broke).
  For a suspected regression matching known bug history, say so explicitly ("SUSPECTED BUG ... — matches
  bug history #xxxx").
- `attention`: pick the single worst thing — a confirmed bug > an unverified blocker > the first failing
  check — never leave it empty when something is wrong.

#### `buildReportModelOverride` → `QaReportModelOverride` (`@qakit/core`, `report/model.ts`)
A separate function at the bottom of the file, deriving every field from the same `checks`/blocker state
`buildOverview` reads. All fields are optional — set only the ones worth curating:
```ts
interface QaReportModelOverride {
  header?: Pick<QaReportHeader, 'relatedBugs'>;  // e.g. ['#1201', '#1207']
  qaSummary?: {
    businessScenario: string; verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED';
    severity?: string; reproducibility?: string; defectStatement?: string; impactedArea?: string;
  };
  expectedVsActual?: QaCheckpointRow[];   // { checkpoint, expected, actual, result } — the KEY checks only
  reproSteps?: string[];                  // minimal repro, business language, numbered by the renderer
  passedScope?: string[];                 // what's confirmed correct, one bullet per rule
  defectDetails?: { observedMismatch?: string; probableFailingRule?: string; regressionNote?: string; suspectedComponent?: string };
  conclusion?: string;                    // one closing paragraph, keyed off the verdict
}
```
Rules for filling it:
- `qaSummary.verdict`: keep it aligned with the actual derived outcome from `deriveVerdict(...)`, not a
  simplified `passed ? PASS : FAIL` shortcut. In particular:
  - use `PARTIAL` when some checks truly passed but other checkpoints are blocked or `NOT_EVALUATED`
  - use `BLOCKED` only when the testcase could not produce meaningful passing evidence for the graded part
  - use `FAIL` for a confirmed wrong behavior
  Never leave it out of sync with the scenario's own `passed`/`blocked` fields and checklist evidence.
- `expectedVsActual`: build via `KEY_CHECK_LABELS.map(findCheck).filter(Boolean).map(...)` — pick the
  checks that tell the story, not every check (the full checklist still renders in the technical appendix
  regardless). Use the project wording's `describeCheck`/`formatCheckValue` (exported by the harness's
  report wrapper) so labels/values match what the appendix shows.
- `defectDetails`/`conclusion`: only populate with a confirmed finding — when nothing failed outright,
  leave `defectDetails` `{}` and let `conclusion` state the clean PASS/BLOCKED outcome instead of
  inventing a defect.
- Leave a field unset (not an empty value) to fall back to the generic builder — `mergeReportModel` only
  overrides fields you actually set.

### 2.6 Naming & registration
- File name: `<slug>.scenario.ts`, kebab-case, matching the concept not the test-case ID (multiple test
  cases can share infrastructure but each distinct rule usually gets its own scenario file). It lives in
  `<paths.suites>/<module.suite>/<api|ui>/`.
- Register the scenario the way the project's harness requires (knowledge file): typically a name in the
  scenario name registry, a handler entry in the suite folder's barrel, and a regenerated scenario-group
  index. Run any scenario through the harness's generic single-scenario command; aggregate slices
  (all / api / ui / per module) select off the scenario-group index and pick a new scenario up
  automatically — do not add a per-scenario script.

---

## 3. Reports

### 3a. Auto-generated QA/QC run report — do not hand-author

Every scenario run writes `<paths.reports>/<domain>/<kind>/<TC-ID>/<timestamp>.md` plus a machine-readable
JSON run artifact in the same group folder of the outputs tree. The generic builders, renderer, verdict
rules and run artifact live in the kit (`@qakit/core`, `packages/core/src/report/`: `createReportKit`,
`ReportWording`, `deriveVerdict`, `mergeReportModel`); the harness binds them to the project's wording in
its report wrapper and calls the write path from its CLI (locations in the knowledge file). **Never
hand-write or hand-edit the generated `.md`/`.json`** — instead, make sure the scenario populates the fields
that feed it (§2.2/§2.5):

- `overview` + `reportModel` → drive the generic `buildDefaultReportModel` merged with the scenario's own
  `reportModel` override, then rendered by `renderQaMarkdown` into the 9-section Markdown report: **1**
  Report Header, **2** QA/QC Decision Summary, **3** Expected vs Actual, **4** Business Reproduction
  Steps, **5** Scope of What Passed, **6** Defect Details, **7** Evidence Summary, **8** Technical
  Appendix (the full checklist/evidence/steps tables — see below), **9** Final Conclusion.
- `steps` → feeds both §4's generic repro-step fallback and the full Steps table in §8's Technical
  Appendix, translated to business language by the wording's `describeStep`. **If your scenario introduces
  a genuinely new step-title shape**, add a matching rule to the project's step wording table so it
  doesn't fall through to the generic fallback translation.
- `checks` → feeds §3's Expected vs Actual (via `reportModel.expectedVsActual` if set, else the generic
  top-N-failing-then-passing fallback) and the full checklist in §8. Add matching rules to the project's
  check wording table (read by `describeCheck`) for any new check label so it reads as a business sentence
  instead of the raw label.
- `payload(A/B)` + `payload(A/B)Context` → renders the payload section(s) in §8's Technical Appendix with
  resolved names, not raw ids (through the wording's appendix hooks).
- Every HTTP call made through the harness HTTP client is captured automatically into the trace/evidence
  table (§7's Evidence Summary and §8's full call table). If your call hits a brand-new endpoint, add a
  purpose rule to the project's API-call wording table (read by `describeApiCall`) so the table shows a
  real purpose instead of a raw `METHOD /path`.

If a report renders with untranslated step/check labels, a generic/empty §2-§6 that a curated
`reportModel` should have filled in, or "(not set)" fields that should have data, that's a signal to go
fix the scenario or the wording tables — not to edit the generated `.md` file.

**Also happens automatically, no scenario action needed:** the write path persists the same run to the
SQLite run store (`reporting.sqlite`) right after the files are written — best-effort, so a DB failure is
logged and never fails the scenario or blocks the Markdown/JSON from landing on disk. The run then becomes
browsable via the local review dashboard, which reads the outputs/reports trees and writes human review
decisions plus AI-assisted proposals into sibling trees grouped the same way. None of this changes what a
scenario author writes — it consumes the same `ReportableResult`/`QaReportModel` this section describes.

The generated report and DB row distinguish:
- `PASS`: every graded checkpoint is proven correct
- `PARTIAL`: some evidence is proven, but at least one remaining checkpoint is blocked or `NOT_EVALUATED`
- `BLOCKED`: the graded part could not be meaningfully exercised yet
- `FAIL`: a graded checkpoint is definitively wrong

### 3b. Manual recap report (`<recap-report folder>/TC-<ID>-<YYYYMMDD>.md`)

Write this once a run (or a short investigation across a couple of runs) produces a verdict worth
summarizing for a non-technical reader, or when the automated run is `BLOCKED`/`FAIL` and needs a
human-readable diagnosis beyond what the auto-generated report shows. Reference recaps are listed in the
knowledge file. Shape:

```markdown
# TC-<ID> — <short name> (<date>)

## 1. Summary
| Field | Value |
|---|---|
| Test case | `TC-<ID>` — <one-line rule statement> |
| Result | **PASS** / **FAIL** / **BLOCKED (environment)** — one-line qualifier |
| Automation | [`<slug>.scenario.ts`](relative link) — run: <single-scenario command> <slug> |
| Run artifact (latest) | [`<artifact>.json`](relative link to the outputs tree) |
| Test records | record numbers created, and their cleanup status |

## 2. Assertion results (<context: which run, which payload variant>)
| Assertion | Result | Evidence |
|---|---|---|
| `A1` ... | **PASS**/**FAIL**/**BLOCKED** | concrete numbers/values, not prose |

## 3. Environment blockers   ← only if something is blocked
### <BLOCKER-ID> (known / NEW, <date>): <short description>
- What happened (concrete error text/HTTP status)
- Whether it's a harness bug or an environment/backend issue — state how you know (e.g. "a prior
  PASSing run against the same data now fails identically ⇒ not the harness")
- Downstream consequence (which assertions this blocks)

## 4. Execution conditions & confirmed field names
- Environment constraints discovered while running (e.g. "only 1 store available with ≥2 warehouses")
- Exact field names verified from responses, so the next run doesn't have to rediscover them

## 5. Conclusions & recommendations
1. Numbered conclusions on what's proven vs unproven
2. What backend/infra needs fixing, referencing blocker IDs
3. Exact retry command
4. Any residual coverage gap and what data/fixture would close it
```

Rules:
- Every assertion row must cite a **number or concrete value**, not "OK"/"looks fine".
- Every BLOCKED/FAIL claim must be traceable to the auto-generated report or JSON artifact — link it,
  don't restate numbers from memory.
- If a blocker might be a harness bug rather than a real product defect, say what you checked to rule that
  out (e.g. rerunning a previously-passing scenario against the same data).
- End with a concrete next action (a retry command, a data fixture to prepare, a source file to read) —
  never end on an open question with no proposed resolution.

---

## 4. End-to-end checklist for a new test case

1. Read the relevant testcase inventory/scenario source doc(s) under `<paths.featureDocs>/<module>/` first.
2. Copy the `api-test-steps.md` template → `<paths.steps>/api/<module dir>/TC-<ID>-<slug>.md`, fill
   sections 1–10.
3. Trace the actual backend (the source repository in `apiSources.<source>.repository`, or verified live
   calls through `mcp__<mcp.apiServerName>__execute_api_action`) for every `[to be confirmed]` before
   writing code — never encode a guessed contract into the scenario.
4. Write `<slug>.scenario.ts` in `<paths.suites>/<module.suite>/<api|ui>/` following §2 above; run it in
   dry-run mode first to sanity-check the payload before hitting live endpoints.
5. Run it live; if step-title or check-label translations are missing from the project's wording tables,
   add them. If the generic `QaReportModel` fallback doesn't tell the business story well, add a
   `buildReportModelOverride` (§2.5).
6. Append §11 "Automation findings" to the test-steps doc with what source-tracing corrected.
7. If the run is clean and matches expectations, you're done — the auto-generated report is the record. If
   it's `PARTIAL`/`BLOCKED`/`FAIL`/found-a-bug, write the manual recap report per §3b, especially when the
   blocker split needs to be explained to a human reader.
