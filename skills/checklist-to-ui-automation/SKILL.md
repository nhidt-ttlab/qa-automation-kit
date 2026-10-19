---
name: checklist-to-ui-automation
description: Run the end-to-end pipeline that turns a QA hardening checklist (CSV or sheet) into runnable UI automation — routing every row, grouping rows into UI scenarios, writing the `U`-series step docs, and coding the `*.scenario.ts` that executes them. Use when the user hands over a checklist CSV and wants UI test steps, UI scenarios and/or automation scripts from it, or says things like "extract UI/scenario/script from this CSV", "automate this checklist", "generate UI tests from the checklist". Also use when resuming that pipeline midway — e.g. step docs exist and only the scripts are missing, or the scripts already run green but the report does not yet name which checklist row each assertion answers.
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

# Checklist → UI automation (end to end)

Use this skill when a **QA hardening checklist** (`<paths.checklists>/*.csv`) has to become **running
UI automation**. It orchestrates six passes, adds the three things none of the sub-skills owns — the
**coverage check** between passes, the **UI automation pitfalls** that cost live runs, and the
**trace back to the sheet** that closes the loop — and defines what "done" means at each hand-off.

Do not use it for a single test case whose step doc already exists and only needs automating: that is
`create-scenario-script` alone.

Throughout, `<module>` is a `modules[]` entry from the config, and:

- `<stepDir>` = `<module.stepDir ?? module.docSlug ?? module.id>`
- `<suite>` = `<module.suite>` (several modules may share one suite folder)
- a UI test case id is `TC-<module.tcPrefix>-U<nn>` and must match `ids.testCase`
- an assertion id matches `ids.assertion` (e.g. `A2`), and a check reference — test case plus
  assertion, e.g. `TC-ORD-U01 / A2` — matches `ids.checkRef`
- `<SHEET>` is the checklist's own sheet id (usually the feature code the sheet was written for; see
  `module.featureCodes`)

Project commands (import, run, list, typecheck, registration) and the project's harness helper names
are not config keys; take them from the knowledge file. Where this skill says "the import command" or
"the trace helper", the knowledge file names the real one.

## The six passes

| # | Pass | Skill that owns the detail | Output |
|---|---|---|---|
| 1 | **Routing** | `create-testcase-steps-ui` §Routing | `<paths.checklists>/checklist-routing-<SHEET>.md` or a §1 routing table |
| 2 | **Scenario grouping** | this skill (§Grouping) | scenario table: `SC-<SHEET>-U<nn>` ↔ many checklist row ids |
| 3 | **Step docs** | `create-testcase-steps-ui` | `<paths.steps>/ui/<stepDir>/TC-<module.tcPrefix>-U<nn>-<slug>.md` |
| 4 | **Scripts** | `create-scenario-script` | `<paths.suites>/<suite>/ui/<slug>.scenario.ts` |
| 5 | **Trace back to the sheet** | this skill (§Pass 5) | report names the checklist row each assertion answers |
| 6 | **Persist & verify** | this skill (§Pass 6) | the `csv_*` columns confirmed present in the run store (`reporting.sqlite`) |

Each pass has a gate. **Do not start a pass until the previous one's gate is answered in writing** —
skipping the gate is how rows get silently dropped and how duplicate coverage gets written.

## Pass 1 — Routing: every row, three axes

A checklist row is a **candidate, not a test case**. Resolve three axes before anything is written:
**module · SpecID · lane**. `create-testcase-steps-ui` §Routing has the rules; the contract is:

- **Rows out = rows in.** Publish a table with one row per checklist row and verify the count with a
  script, not by eye.
- Verdicts are `→ UI` · `→ API lane` · `✖ duplicate` · `? BA` (write the labels in the project's
  `locale`; the knowledge file gives the wording). `✖ duplicate` means **an existing UI case already
  covers it** — never that an API case does; see §The coverage check. **"Needs to write data" is never
  a rejection** — it is a `browser`-layer limit, so the row goes `→ API lane`.
- **No SpecID ⇒ no test case.** It becomes a BA question, recorded as such.
- Do not trust the checklist's own grouping as the module boundary. QA files rows by the screen they
  sat on; the module is decided by `modules[].featureCodes` and the spec, not by the sheet's layout.

**Verify with code, every time:**

```bash
node -e "…parse the checklist CSV and the routing table…; console.log('total',n,'missing',missing)"
```

## Pass 2 — Grouping into scenarios

Group `→ UI` rows into scenarios so that **one scenario = one cluster of rules on one screen**, run
in a single browser session without rebuilding data between rows.

| Rule | Why |
|---|---|
| A scenario carries **many** checklist row ids | that is the user-visible shape they asked for |
| Group by **screen + rule cluster**, not by checklist section | checklist sections mix screens |
| Order scenarios so shared setup runs once | permission probe → read-only → edit-mode cluster |
| One scenario must be **runnable end to end** | if it needs two logins or two scopes, split it |

Publish the mapping as a table with columns `Scenario | Checklist ID | Test IDs | Objective | SpecID |
Screen | Priority` (headings in the project's `locale`), and keep it consistent with the routing table —
verify by script.

### The coverage check — what the **UI lane** already answers

**Before writing any step doc, check what the UI lane already covers.** This is not optional and it
is not cheap to skip:

```bash
ls <paths.steps>/ui/<stepDir>/                              # existing U-series
grep -n "Primary rule" <paths.steps>/ui/<stepDir>/TC-*.md   # use the heading the locale's template uses
sed -n '/Excluded cases/,/^##/p' <paths.steps>/ui/<stepDir>/CRUD-MAP.md
```

`CRUD-MAP.md` follows `templates/crud-map.md`; its excluded-cases section is where a prior pass
records the clusters it gated out. The knowledge file gives the localized heading text to grep for.

**An API test case covering the same rule is not a reason to skip the row.** Deliberate policy, not
an oversight: an API case proves the server enforces the rule, a UI case proves the operator can see
it enforced — the screen can bind the wrong field, swallow the error, or disable the wrong control
while the endpoint behaves perfectly. Different layer, different evidence. When you find one, **cite
it in §1 as related coverage and write the UI case anyway**. Never open `<paths.steps>/api/` looking
for a reason to reject.

Three outcomes, all of which happen in practice:

1. **An existing UI case already covers the row** ⇒ verdict `✖ duplicate`, cite it. This is the only
   shape of duplicate this pipeline rejects.
2. **A prior pass gated the cluster out** (`CRUD-MAP.md`, excluded-cases section). Either accept it,
   or **overturn it explicitly with a reason written into the step doc's §1**. Never overturn silently.
3. **Your own routing reason is factually wrong.** Check the claim before relying on it — e.g. "the
   client builds this tree" is checkable in one grep of the web source, and being wrong means writing
   a duplicate.

## Pass 3 — Step docs

`create-testcase-steps-ui` owns the shape (`templates/ui-test-steps.md`). Additions this pipeline
requires:

- **Path B needs a filled relation table.** If you cannot state three genuinely different answers for
  *What it compares / What defect it catches / Blind spot* **against the other UI cases**, the case is
  duplicate coverage inside the UI lane — drop it. An API case is never what makes it duplicate.
- **A case that closes an open question of an API case is high-value.** When an API step doc says its
  own expectation is *not settled yet*, a UI case that supplies the value or the timing is the
  opposite of duplicate. Say so in §1.
- **Name every blocker's layer**: `browser` · `API` · `test data` · `product` · `source` (missing
  spec). A blocker without a layer reads as "impossible" and the row dies. Write the layer names in
  the project's `locale` (the knowledge file gives them).

## Pass 4 — Scripts

`create-scenario-script` owns the shape, the four rings, registration and verdict semantics. Read
**`references/ui-automation-pitfalls.md`** before writing the first assertion — it lists the failure
modes that cost live runs, generic form first; the project's own evidence for each lives in the
knowledge file under the same numbers.

### Observe the screen before you code against it

Selectors, column ids, tab labels, request paths and permission strings come from observation, not
from memory or from a guess based on the widget library. When the UI MCP server is registered, use it
read-only to confirm them on the real screen before they go into a shared module:

| Tool | Use it for |
|---|---|
| `mcp__<mcp.uiServerName>__ui_open_session` / `ui_open_screen` | open a guarded browser on `web.baseUrl` (hosts limited to `web.allowedHosts`) |
| `mcp__<mcp.uiServerName>__ui_describe_screen` | the controls, tabs and labels actually rendered |
| `mcp__<mcp.uiServerName>__ui_read_grid` | the real column ids and row values of a grid |
| `mcp__<mcp.uiServerName>__ui_act` / `ui_assert` | a single read-only interaction (switch a tab, open a dropdown) and its effect |
| `mcp__<mcp.uiServerName>__ui_capture_evidence` | a screenshot or DOM snippet to cite in the step doc |
| `mcp__<mcp.uiServerName>__ui_finish_run` / `ui_close_session` | close the run and the session |

The widget adapters loaded for the project are listed in `web.widgets`; their quirks are in the
knowledge file. Writes through the browser stay behind `safety.allowWritesEnv` — never switch it on to
"just look". What you did not observe stays marked as needing confirmation, and its assertion ships
`NOT_EVALUATED`.

### Write the suite's measurement module first, then the scenarios

A checklist pass produces **a dozen or more scenarios on one screen**, and they share far more than
they differ: the same permission probe, the same fixture resolution, the same tab labels and column-id
vocabulary, the same "zero renders as a dash" parsing. Writing them file by file guarantees they
drift — and each copy re-learns the same selector caveat.

| File (under `<paths.suites>/<suite>/ui/`) | Holds | Never holds |
|---|---|---|
| `<prefix>-ui-shared.ts` | measurement primitives: screen path, tab specs, column names, permission probe, fixture resolution, grid readers, number parsing, tolerance, verdict plumbing | any rule, any expectation |
| `<prefix>-ui-families.ts` *(only when ≥ 3 scenarios are one rule × N tabs)* | the whole run function, parameterised by tab | per-test-case identity |
| `<slug>.scenario.ts` | `TEST_CASE_ID`, `FEATURE_ID`, `TEST_OBJECTIVE`, the checklist map, the doc comment arguing why the case exists | measurement code the suite already shares |

`<prefix>` is the lower-cased `module.tcPrefix` (or the suite's established short name). A typical
large sheet ends up as two or three families plus a handful of one-offs, and the family scenario files
are short — they carry only their own identity and coverage wording. The knowledge file names a real
suite built this way.

**Write one scenario end to end first** and make it the template the rest copy — including the
subagents, if the pass is fanned out. Handing writers a real file beats handing them a description.

### Two wiring facts that fail silently

- **`checklistId` must be a string literal inside each `*.scenario.ts`.** A checklist importer that
  finds the cited sheets by scanning file **text** (for `checklistId: '<SHEET>'`) cannot see a shared
  constant: `checklistId: SHEET_ID` compiles, runs, and leaves the sheet **out of the import** — every
  row then resolves to nothing. Verify with the project's import command and read the sheet list it
  prints.
- **`blockedReason` alone reaches nobody.** Runners and report builders commonly print and render
  `result.error` for a blocked run. A blocked result must set **both** `blockedReason` and `error`, or
  the operator sees a bare `RESULT: BLOCKED` with no reason — the exact failure that makes a run look
  like a broken scenario instead of a missing fixture. Confirm which field the project's runner reads
  (knowledge file).

### Verify the fixture before you believe a BLOCKED

Step docs pin a fixture (a project, a store, a customer) measured weeks earlier; shared test
environments move. Before debugging a scenario that reports BLOCKED, probe the data directly — a
five-line probe script that calls the module's API flow. Make sure the probe loads the environment
(credentials, base URLs) first: an unauthenticated request against many web backends returns the HTML
login page with HTTP 200, which looks exactly like "no data". Often the pinned fixture has lost its
rows and the scenario was right.

### When the row needs an import file

Some rules only fire on an upload — an import validation, a code generated on approval, a rejected
row. Build the workbook **in memory** (e.g. with `exceljs`); never read the customer's sample
workbooks at run time. Those are real files, kept as column evidence: a run that opens one depends on
a file outside the package and on values belonging to a different tenant or project.

Copy the header row into a TS constant and build from that — the knowledge file names the project's
worked example. Read **`references/excel-upload-data.md`** before writing the first cell: the column
labels are load-bearing, and one wrong label fails the upload for a harness reason that reads exactly
like a product bug.

### Registration

Registration is a fixed sequence of edits **in the project's order**, then a regeneration of any
generated scenario index, then the gates:

```bash
# 1. add the scenario name to the project's scenario-type registry
# 2. export the scenario from the suite's barrel: <paths.suites>/<suite>/ui/index.ts
# 3. regenerate the generated scenario/group index, if the project has one (a fitness test usually diffs it)
# 4. typecheck + unit tests
# 5. list scenarios and confirm <slug> is there
# 6. run the checklist import; it prints the sheets the scenarios cite
```

The knowledge file gives the exact file names and commands.

## Pass 5 — Trace back to the sheet

The checklist is what QA ticks. A pipeline that ends at a green scenario has **not** closed the loop:
the report must name **which checklist row** each assertion answers, in the reader's own vocabulary.
Three mechanics, all authored inside the `*.scenario.ts`.

**Use the project's shared trace helper — never hand-write this.** It turns a small per-scenario map
into the kit's per-check `csv` metadata (`CsvCheckMeta`: `checklistId`, `testcaseId`, `expected`,
`businessRule?`, `priority?`). The shape, with neutral example ids:

```ts
import { checklistTrace, type ChecklistMap } from '<project trace helper>';

const CHECKLIST_ROWS: ChecklistMap = {
  // Only the row id and how much of it this assertion answers. NOTHING else is authored here.
  A1: { rows: 'TC_16', coverage: 'Full — …' },
  A2: { rows: ['TC_20', 'TC_35'], coverage: 'Partial — …' },   // one assertion, two rows
};

const TRACE = checklistTrace({
  testCaseId: TEST_CASE_ID,
  checklistId: 'ORD-02',              // the sheet; scopes the row ids — a literal, see Pass 4
  map: CHECKLIST_ROWS,
  liveDataNote: 'real discount rules of the tenant, measured <date>: 12 rules',
});
```

Write `coverage` and `liveDataNote` in the project's `locale`.

Then three lines in the body, and nothing else:

| What | How | Where it renders |
|---|---|---|
| Assertion id | `TRACE.ref('A1')` as the `testId` argument of `check(...)` | the checkpoint list, and the evidence manifest |
| Attach the rows | `TRACE.apply(checks);` **once**, before the result is assembled | the run store, the expected-vs-actual section and the appendix, together |
| The sheet's own words | `detailTables: [TRACE.table(checks)]` | appendix, right after the checkpoint list |

`TRACE.apply` mutates the array in place and must run before anything reads it — `result.checks`,
`TRACE.table` and `TRACE.expectedVsActual` all take the same array, and applying it late is how the
Markdown ends up showing rows the database does not have.

**`testId` is `<TC-ID> / <Assertion>` and nothing more** (it matches `ids.checkRef`). Do not append
the row id as a third segment. The row travels in `check.csv`, reaches the run store as
`csv_checklist_id` / `csv_testcase_id` / `csv_expected` / `csv_business_rule` / `csv_priority`, and
shows in the reporting app as its own columns. Appending it to `testId` would overload the string the
evidence manifest joins on.

Assertions with no checklist row — baseline oracles, read-only guards — are simply left out of the
map. They are the scenario's own preconditions, not requirements from the sheet. Do not invent a row
for them; an unmapped assertion renders an em dash everywhere, which is the correct answer.

A scenario with no sheet at all declares no trace and runs exactly as before. Report the gap instead
of manufacturing a mapping.

### The screen's own id, for reconciling against the spec workbook

Row-level traceability answers *"how did `TC_21` do?"*. It does not answer *"how is the **screen**
doing?"* — the spec source (`<paths.specSource>`) numbers screens, not test cases. Declare that id next
to `TEST_CASE_ID`:

```ts
const TEST_CASE_ID = 'TC-ORD-U16';
const FEATURE_ID = 'ORD-04';   // Order code generation settings
```

`FEATURE_ID` should be one of `module.featureCodes`. The project's scenario scanner picks it up, the
run persister stamps it onto the `test_cases` row, and the reporting app shows it in place of the
scenario key. It is optional by design: a scenario whose screen has no workbook entry stays NULL
rather than carry a guess, and nothing routes artifacts by it — it is a join key, not a grouping
vocabulary.

### `TEST_OBJECTIVE` opens with the sheet and the rows

The objective is the one sentence a reader meets at the top of the report, so it must say **which
sheet and which rows** this run answers before it says what it measured:

```ts
const TEST_OBJECTIVE =
  '(checklist ORD-06, rows 80–83, 85–91, 95–96) On the order summary tab: the row key ' +
  '(store, product) is unique and non-empty (A2), …';
```

Ranges are fine; the per-assertion breakdown is the checklist map's job. Without the prefix the
report names a screen and a rule but never the sheet it was commissioned from, and the reader has to
open the step doc to find out. Write it in the project's `locale`.

### The sheet's expected text is traceability, never the oracle

Checklist rows are written against **invented** data: `Prefix = "ORD-"`, a one-to-three field
formula, a made-up product code. The scenario runs against whatever the tenant actually has — a
different field count, real codes. Putting the sheet's string into the `expected` of a check asserts
a value the run can never produce, and turns a correct rule red for a data reason.

**Rule:** the oracle stays the recomputation from the live payload. The sheet's string rides alongside
in its own column, labelled as the sheet's wording.

### Never transcribe the sheet's text into code

Do not retype `expected`, `priority` or the CSV line as TypeScript literals. The text is read from the
CSV itself by the project's **checklist import command**, which parses `<paths.checklists>/*.csv` into
a generated rows module (plus a JSON sibling a reporting backfill can read), importing **only** the
sheets some scenario cites via `checklistId:`. Run it after adding a mapping to a new sheet, or after
a sheet changes. A fitness test that re-runs the import and fails when the committed file is stale
turns a drifted transcription into a build error rather than a silent lie — add one if the project
lacks it.

A scenario therefore authors exactly two things per assertion: **which row id**, and **how much of
it that assertion answers**. Everything else — the exact `Expected Result` cell, the business rule,
the priority, the CSV line — comes from the sheet. Header shapes vary a lot across sheets (the id
column may be `#`, `No`, `Test Case ID` or `Case ID`; an extra column can shift the others; some
families have no `Priority` column at all); the importer must resolve every column by **name**, never
by position.

**Row ids repeat across sheets** — `TC_16` will exist in many of them — so `checklistId` is mandatory
and scopes every lookup. A row id a sheet reuses for two different rows is excluded from the index and
reported by `TRACE.unresolved()`, because it identifies nothing.

### Verbatim transcription is what exposes half-covered rows

Copying the wording instead of summarising it is not cosmetic. Verbatim cells regularly reveal that a
mapped row was only half answered — a paraphrase hides both shapes:

| Shape in the sheet | What it actually is | Example |
|---|---|---|
| two clauses joined by **and** | **two** requirements, usually on two different layers | *"The sample code **and** the real code generated on import"* — the preview half ran, the import half never did |
| **or** between two outcomes | the sheet has **no settled expectation** ⇒ ungradable | *"equals ORDX **or** ORD_X"* — an open BA question wearing an expected-result costume |

The conjunctions are in the sheet's language; the knowledge file lists them for the project's
`locale`. Give every mapped row a coverage cell saying which half ran, and repeat the caveat in the
scenario's `conclusion` so a reader of the conclusion cannot tick the sheet without seeing it.

## Pass 6 — Persist, then verify the sheet actually landed

The pipeline's responsibility ends at **correct rows in the run store** (`reporting.sqlite`). Running
the scenario writes them; this pass proves they are there, because every way this fails is silent.

```bash
# from the folder that holds qakit.config.yaml
<checklist import command>      # sheet text -> generated rows module (only the sheets cited)
<run one scenario> <slug>       # the run persists into reporting.sqlite

# the gate: the csv columns landed, on the assertions you mapped
node -e "const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('<reporting.sqlite>');
const run=db.prepare('SELECT id FROM test_runs ORDER BY started_at DESC LIMIT 1').get();
const sql='SELECT test_id, csv_checklist_id, csv_testcase_id, csv_priority FROM test_run_checks WHERE run_id=? ORDER BY seq';
for (const r of db.prepare(sql).all(run.id))
  console.log(r.test_id, '|', r.csv_checklist_id ?? '-', '|', r.csv_testcase_id ?? '-', '|', r.csv_priority ?? '-');"
```

That last command is the point of the pass. A scenario whose `TRACE.apply(checks)` ran too late, or
whose `checklistId` is not a literal the importer could scan, **still goes green and still writes
rows** — with every `csv_*` column NULL. Nothing in the run output says so. Reading them back is the
only thing that catches it, and what comes back must match the map: every mapped assertion carries
its sheet id, row id, expected text and priority (where the sheet has one); every unmapped one carries
none.

Check `TRACE.unresolved()` reports nothing while you are there — a row id a sheet reuses for two
different rows identifies nothing, so it is dropped without a word.

**Do not run the reporting sync.** Pushing the run store to the reporting app's database is the
team's own step, on their schedule. Once they run it, these columns are exactly what surfaces in the
app: the checkpoint label, the priority chip, and the checklist filters on the test-case list. That is
why a NULL here is not a cosmetic loss — it is the run quietly dropping out of the sheet's coverage
view.

Two facts worth knowing: the csv columns are a **snapshot**, so editing the CSV later cannot rewrite
what a historical run reported; and runs recorded before the columns existed can be filled in with the
reporting API's backfill script rather than re-run.

## Hard rules

- **Verify counts with a script, never by reading.** Routing totals, scenario↔routing consistency,
  and link resolution are all one-liners; eyeballing them is how a row goes missing.
- **A green run is not evidence until you read the checkpoint table.** A scenario that silently
  degrades every assertion to `NOT_EVALUATED` still reports `passed = true`. Open the report and
  confirm each assertion was really judged.
- **Run a new scenario 3× before calling it stable.** A scenario that passes once and fails the next
  run almost always has a wrong wait, not a flaky product.
- **Never edit an earlier section of a step doc to match what automation found.** Append an
  *Automation findings* section (§11) that *corrects* it. The honest record of "what we assumed" vs
  "what we measured" is the artifact's main value on the second read.
- **Update both checklists** (`<paths.steps>/ui/CHECKLIST.md` and the module's own) with real verdicts,
  and keep the totals arithmetically right.
- **A `FAIL` against a self-contradictory spec is a BA question, not a defect ticket.** Report both
  halves: what the screen does, and that the source disagrees with itself.
- **A run that cannot be traced back to the sheet is not done.** Every graded assertion names its
  checklist row in the report itself — not only in the step doc, which the person ticking the sheet
  is not reading.
- **Never let the sheet's `Expected Result` become an assertion's `expected`.** It is written on
  invented data; the run is not. Verbatim in its own column, never in the compared value.
- **Read the domain formula before asserting a sum the sheet states in words.** A total described as
  "A + B + C − D" in prose may be a **signed** sum in the backend; a plain Σ of the component columns
  goes red on every row where the subtracted term is non-zero — a fabricated defect on a working
  screen. Find the formula in the backend source (the knowledge file names a real case).
- **A column the product hides is `NOT_EVALUATED`, never a guessed click.** Judge it if it happens
  to render, and otherwise ship the blocker with the column list you did observe. Inventing a
  column-picker selector produces an assertion that looks right in review and dies on the first run.

## Verification before declaring done

- Routing table: rows out == rows in, verified by script.
- Scenario table ↔ routing table: consistent, verified by script.
- Every step doc: all sections of `templates/ui-test-steps.md`, the page-error assertion last, no
  *Automation findings* section until automation has run.
- Every scenario: typecheck clean, unit tests clean, listed by the project's scenario list command.
- The checklist import names the sheet, and its row count equals the routing table's.
- Every scenario declares `checklistId: '<SHEET>'` as a **literal** — `grep -L "checklistId: '"` over
  `<paths.suites>/<suite>/ui/` returns only the files that legitimately cite no sheet.
- Every scenario run 3×, with the assertion table read — not just the `RESULT:` line.
- Every `NOT_EVALUATED` names the concrete data, verb or BA decision that would resolve it.
- Every mapped assertion carries its checklist row in `check.csv` and every unmapped one carries
  none — confirmed by reading `test_run_checks` back out of the run store, not by reading the source
  or the Markdown. (`testId` is two segments and holds no row id; see Pass 5.)
- `TRACE.unresolved()` reports nothing.
- Every verbatim `Expected Result` cell diffed against the CSV by script, character-exact.
- Every half-covered row has a coverage cell **and** a matching sentence in `conclusion`.
- All relative links resolve:
  ```bash
  node -e "const fs=require('fs'),p=require('path');/*…walk docs, resolve ]( links…*/"
  ```

## Avoid

- Starting Pass 3 before the routing table is complete and counted.
- Writing a step doc without checking the existing `U`-series first.
- Rejecting a row as `✖ duplicate` because an **API** test case covers it. Different layer, different
  evidence — cite it and write the UI case.
- Reading the customer's sample workbooks at run time instead of copying their headers into a TS
  constant.
- Calling the pass done on a green run without reading the `csv_*` columns back out of the run store.
- Reporting rerouted rows and rejected rows in one bucket — different outcomes.
- Treating "the run went green" as "the rule is covered".
- Inventing a selector, a column id, an endpoint or a permission string. Not observed ⇒ mark it as
  needing confirmation (the locale's marker), and the assertion ships `NOT_EVALUATED`.
- Silently changing a step doc's mechanism when automating (e.g. substituting a cell edit for a row
  removal) — do it if the property survives, but say so in *Automation findings*.
- Paraphrasing the sheet's `Expected Result` into the report. The paraphrase is what hides the
  half-covered rows.
- Reading a row's `Pass` tick as full coverage when its expected text joins two clauses with **and**.
