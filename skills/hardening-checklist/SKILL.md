---
name: hardening-checklist
description: Read business specs (feature list, field-table sheets, BRD/URD/user stories, basic design) and generate an Excel test checklist in the team's template, following the 6-step AI-driven risk-based testing (AI-RBT) process and focusing on business rules, impact and priority for the hardening phase. Use this skill WHENEVER the user says "create a checklist", "generate a checklist", "write a test checklist", "hardening checklist", "checklist for screen X", "read the spec and build a checklist", "analyse the spec for testing" (Vietnamese users: "tạo checklist", "gen checklist", "checklist hardening", "làm checklist cho màn hình X"), or hands over a feature list / spec together with a checklist template. Trigger also on short requests such as "checklist for the Orders screen" or "hardening the Contracts screen".
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

# Hardening Test Checklist

Generate a test-checklist Excel workbook from business specs, following the QA team's template and
conventions and the **AI-RBT (AI-Driven Risk-Based Testing)** process.

This skill merges two sources: the 6-step AI-RBT risk-analysis process, and the team's conventions
for generating the checklist workbook. **All checklist content is written in the project's
`locale`.**

## Method files (locale material)

The detailed method — spec-reading guide, case-writing rules, design techniques, rule library,
quality gate, JSON input format, a full example, the checklist template and the generator — lives in
three folders next to this file:

| Folder | Content |
|---|---|
| `references/` | `doc-spec-phat-hien-diem-mo.md` (reading specs, the 10 question groups, 6 ambiguity areas) · `quy-tac-viet-case.md` (case-writing rules, banned words, anti-patterns, case order, Case ID / QA ID) · `ky-thuat-thiet-ke.md` (equivalence partitioning, boundary values, decision tables, state transitions, coverage per field type) · `thu-vien-rule-mau.md` (rule library per field type with suggested Impact) · `quality-gate.md` (Inventory Gate, Reject Conditions, Review Checklist) · `dinh-dang-json.md` (the generator's `spec.json` schema) · `vi-du-hdvt.spec.json` (a complete example `spec.json`) |
| `assets/` | Markdown conversions of the checklist template (`ProjectCode_IT_TestChecklist - Common.md`, `- Cover.md`, `- FunctionList.md`, `- History.md`) and of the common viewpoint library (`TestViewpoint_CommonTestCase - Viewpoint List.md`, `- Defination.md`); the `.xlsx` template itself when the project has one |
| `scripts/` | `build_checklist.py` (the generator and its quality gate) · `convert_xlsx_to_csv.ps1` and `convert_csv_to_markdown.ps1` (turn a template workbook into the Markdown files in `assets/`) |

The kit ships these files in the locale pack of the language they are written in; the installer
places them here when the project's `locale` has a pack. **For a locale without a pack, the project
must supply the method files** — same folder layout and file names, or the file names its knowledge
file lists — before this skill can run past Step 1. The generator's banned-phrase lists and its
needs-confirmation marker are locale-specific: they are defined in `scripts/build_checklist.py` and
described in `references/quy-tac-viet-case.md`. Below, **"the needs-confirmation marker"** means that
literal string (the knowledge file repeats the project's spelling).

Prefer the Markdown files in `assets/` when you need the template structure or viewpoint content; do
not read the `.xlsx` files directly.

## Roles

| Role | Work |
|---|---|
| **Human** | Decides strategy and risk level, settles unclear business rules |
| **AI (this skill)** | Analyses the spec, writes the checklist, looks for gaps, generates the file |
| **Human** | Reviews the result before it is final |

---

## Core principles

### 1. Hardening checklist = Business Rule + Impact, NOT UI/UX

By default **REMOVE entirely** these kinds of case (add them back only when the user explicitly asks):
display/layout/font/colour, search, filter, sort, paging, export, navigation (menu, breadcrumb,
browser back), spelling, UI-matches-design checks, responsive layout, cross-browser, performance,
generic success/error toasts, reload/back.

**KEEP and prioritise:**

- Calculation formulas (every auto-calculated cell in the spec is 1 case)
- Business-constraint validation (required, unique, value ranges, relations between fields)
- Status flow and the operations allowed in each status
- Conditions for records to appear in a picker list on another screen
- Knock-on effects on other documents/reports (generated documents, running totals, real-time values)
- Import: automatic code generation, validation against the attribute matrix, accumulate vs. overwrite
- Permissions (blocked both in the UI and when calling the URL/API directly)

### 2. Do not infer

Use only information that **is in the spec**. When the spec does not describe something:

- do NOT add business behaviour
- do NOT invent a validation rule
- do NOT invent a permission rule

→ Record it as a **needs-confirmation** item in the Note column (the script highlights it), and make
the Expected Result state exactly what the business analyst must confirm. **The worst mistake is an
invented rule, not a missing case.**

### 3. Completeness first

Every row of a field table in the spec produces **at least 1 case**, or has a stated reason for being
excluded (it belongs to the UI/UX group removed by principle 1).

---

## The 6-step process

### Step 1 — Set up context and read the spec

**Goal:** know the scope, the level the feature applies at, and the data sources.

Inputs live in the project's spec source `<paths.specSource>` (feature-list sheets, one file per sheet
when exported, and/or Markdown specifications) and, when a module already has extraction docs, in
`<paths.featureDocs>/<module.docSlug ?? module.id>/`. Resolve the module from the user's words
against `modules[].id`, `modules[].docSlug` and `modules[].featureCodes`; ask when more than one
module matches. The knowledge file names the project's overview sheet, sheet naming and any extra
spec locations.

Read 2 sources (when present):

- **Overview sheet** of the feature list: the `Description` column (business description), the
  `Business Impact` / "business impact when the feature fails" column, the `Note` column (list of
  tabs), the `Priority` column (Critical/High/Medium/Low). This is the source of the **Impact** column
  and the basis for **Priority**.
- **Field-table sheet** for the feature: Field / Label / Required / Readonly / Default / Business
  Meaning / Validation / Boundary / Error Message / Hardening Status / Bug / Note. This is the source
  of the **Business Rule** and **Expected Result** columns.

**Watch out:** the same business object can exist at **2 levels** — for example a company-wide
(system-level) screen and a per-project screen with the same name. The knowledge file maps the
project's levels to feature codes and modules. Always check, then ask the user which level to cover,
or split the two levels into separate sheets.

Read cells in full, never truncated — a single spec cell often holds 2000+ characters:

```python
for row in ws.iter_rows():
    for c in row:
        if c.value and 'BUSINESS_NAME' in str(c.value):
            print(c.row, [f'{x.column_letter}: {x.value}' for x in row if x.value])
```

(For CSV exports, read the file with a real CSV parser — cells contain line breaks and commas.)

Find section boundaries by scanning for headings (numbered headings `^\d+\.\s`, tab markers, list
and popup titles — the knowledge file lists the project's heading words).

Details on dissecting a spec: `references/doc-spec-phat-hien-diem-mo.md`.

**Step 1 output:** system / screen / level / tab scope / roles involved.

---

### Step 2 — Analyse and ask back

**THIS IS THE MOST IMPORTANT STEP.** Skipping it and guessing the logic makes the checklist seriously
wrong.

**2a. Extract rules into 5 groups** (the raw material for cases):

| Group | Where it comes from in the spec |
|---|---|
| Business Rule | `Business Meaning` column, Description on the overview sheet |
| Validation Rule | `Required` / `Validation` / `Boundary` / `Default` columns |
| Permission Rule | `Readonly` column, descriptions of statuses and approver roles |
| Error Handling | `Error Message` column + its trigger condition |
| Dependency | The "data of … is used for" part → source of the **Impact** column |

**2b. Identify the flows:** Happy Path / Alternate Path (valid branches) / Exception Path (errors,
cancel, close, timeout).

**2c. Find ambiguities and ask back.** Always ask before generating the file.

Always ask **3 configuration questions** (use a multiple-choice question tool when available):

1. **Scope:** project level / system level / both (2 separate sheets)
2. **Level of detail:** per field (~300 cases) / per functional group (~150) / main flows (~70)
3. **Handling of unclear points:** mark with the needs-confirmation marker and still generate / the
   user answers now

> Do not ask about language — the checklist is always written in the project's `locale`.

Add the business questions: `references/doc-spec-phat-hien-diem-mo.md` lists the 10 question groups
to check on every spec (unique scope, date constraints, permissions per status, block vs. warning,
import accumulate/overwrite rules, data sync direction between levels…).

**STOP — wait for the user's answers.** If the user does not answer every business question:
**still generate the file**, mark the unanswered points with the needs-confirmation marker in the
Note column, and **never invent an Expected Result**.

---

### Step 3 — Decompose & Inventory Gate

**Goal:** nothing gets missed. **No case may be written before the Inventory exists.**

**3a. Split into groups (Category)** following the real screen structure, not test types. For a
transactional document screen the standard order is:

```
A. General information (validation + field constraints)
B. Secondary information (payment, special conditions…)
C. Value formulas (every auto-calculated cell)
D. Detail table (add row / import / delete row)
E. Status flow & permissions
F..H. Each remaining tab (progress, related lists…)
I..J. Business popups (appendix, adjustment…)
K. Integration with other screens / reports
```

Write the group names in the project's `locale`; the knowledge file gives the project's wording.

**3b. Build the Inventory Gate table** — list every field/rule in scope before writing cases:

| Tab / Block | Field / Rule | Type | Has case? |
|---|---|---|---|
| General information | Supplier | Required + filtered list | ☐ |
| Value formulas | Total value after VAT | Auto-calculated | ☐ |

**3c. Mandatory business scan** — for each screen answer:

- [ ] Any **auto-calculated** cells? → each cell = 1 P1 case
- [ ] Any **running totals / stock**? → apply the running-total rule set; **a case restoring the
      running total on Cancel/Close is mandatory**
- [ ] Any **document status**? → permission matrix per status
- [ ] Any **import**? → code generation, attribute-matrix validation, accumulate/overwrite
- [ ] Any **permissions / approval**? → blocked in the UI and on direct API calls
- [ ] Any **data flowing to other screens/reports**? → each destination ≥ 1 integration case
- [ ] Any **exchange rate / foreign currency**? → apply the exchange-rate rule set

No Inventory table in the output → process violation.

---

### Step 4 — Traceability & risk assessment

**4a. Trace back:** every field/rule in the Inventory Gate maps to at least 1 case, or has a stated
exclusion reason. Any row still `Has case? = ☐` → not finished.

**4b. Risk → Priority:**

| Risk | Area | Priority |
|---|---|---|
| High | Wrong money, wrong quantity, wrong stock, approval control bypassed, security | **P1** |
| Medium | Main business flow; causes rework but no wrong financial figures | **P2** |
| Low | Secondary constraint, field not used in any calculation | **P3** |

**P1 always includes:** every value formula, currency conversion, quantity running totals, picker-list
conditions, automatic document generation, automatic code generation, permissions.

A case in a feature whose `Business Impact = Critical` in the feature list defaults to P1 unless it is
clearly a secondary constraint.

**4c. Human Checkpoint (large checklists).** When the scope exceeds ~150 cases or the business is
complex, present the group list with the planned case count per group for the user to review
**before** writing details. The user adds the special cases the AI tends to miss — this is the
human-run risk-assessment step.

---

### Step 5 — Write the checklist & generate the file

**5a. Write each row.** For the template structure and viewpoint content, **read the Markdown files in
`assets/`**, not the `.xlsx` directly. The main reference for the column set is
`assets/ProjectCode_IT_TestChecklist - Common.md`. The standard template has **12 columns**; with
`"extended": true` the script **inserts** Case ID (after `#`) and Precondition (after Business Rule) →
**14 columns**. To change the format (add/remove/rename columns, widths, header colour), **edit the
template in `assets/`** — the generated file follows it. The knowledge file records any project
variant of the column set.

| Column | Rule |
|---|---|
| Screen | Short screen name + level, e.g. `Orders (Project)` |
| Category | Tab/block name on the screen |
| Sub-Category | Field name or rule name |
| Business Rule / Checklist | State the **rule**, not the action. Write "Only confirmed contracts appear in the order's contract picker", not "Check the contract picker" |
| Test Data | Concrete values; for a numeric range always include the boundaries and negative/0/null. When none apply, write `N/A` |
| Expected Result | Copy the spec's Error Message verbatim when there is one; for a formula write the concrete numeric result |
| Impact | The **knock-on** business consequence, from the feature list's impact column. Answer "if this is wrong, what else goes wrong?". Never "the feature cannot be used" |
| Priority | P1 / P2 / P3 per the Step 4 table |
| Test result | The script adds a Pass/Fail/Not test/Pending/Blocked/Testing dropdown with colour per value. Leave empty; the tester picks a value when running |
| Issue-tracker link | Leave empty — filled with the tracker issue id at run time (the spec can set it via the `link_redmine` key; the column header is the template's) |
| Note | The needs-confirmation marker plus the open point, and the bug/tracker id when the spec has one |

> Template column titles map to data keys through `HEADER_KEY_MAP` in the script. If the team renames a
> template column, add the matching alias to that map so data still lands in the right column.

Full writing rules (naming, Expected Result, banned words, anti-patterns, case order):
`references/quy-tac-viet-case.md`.

Case-design techniques (boundaries, equivalence partitioning, decision tables, state transitions,
coverage per field type): `references/ky-thuat-thiet-ke.md`.

Rule library per field type with suggested Impact: `references/thu-vien-rule-mau.md`.

Case IDs in extended mode have the script's format `TC_<SCREEN_CODE>_<SEQ>`. Choose `screen_code`
deliberately — the knowledge file says whether the project uses `modules[].tcPrefix` for it. These
checklist Case IDs are not the harness test-case ids (`ids.testCase`); downstream skills map checklist
rows to test cases.

**5b. Generate the file.** Prepare the data as JSON, then run the generator (paths relative to this
skill folder; on Windows use `py -3` instead of `python3`; needs Python 3 with `openpyxl`):

```bash
python3 scripts/build_checklist.py <spec.json> -o <paths.checklists>/<Name>_IT_TestChecklist.xlsx --strict
```

Keep the `spec.json` next to the output under `<paths.checklists>` (or where the knowledge file says)
so the checklist can be regenerated. Structure of `spec.json` and a full example:
`references/dinh-dang-json.md`, `references/vi-du-hdvt.spec.json`.

The script automatically: copies the template from `assets/` (or `--template <path>`), **reads the
column layout (titles + widths + header colour + title font) from the template's `Common` sheet as the
single source of truth**, deletes the sample `Common` sheet, builds each screen sheet **with exactly
that layout**, adds freeze panes / auto filter, **adds the dropdown + value colouring on the
`Test result` column**, highlights P1 in red and needs-confirmation rows in yellow, numbers rows with a
formula, fills the `FunctionList` sheet, and **runs the Quality Gate** before writing. Only when the
template has no valid `Common` sheet (or no template file exists) does the script fall back to the
column set in its code, with a warning.

For large data sets, write a small script that produces `spec.json` instead of typing JSON by hand —
easier to review and to fix group by group.

**5c. Work in batches for large systems.** Never generate the whole checklist of a many-screen system
in one go. Do one group/screen, report, wait for the user's confirmation, then move on.

---

### Step 6 — Review & verify

**6a. Run the Quality Gate.** The script already ran it; on errors fix `spec.json` and regenerate. The
Reject Conditions and what each error means: `references/quality-gate.md`.

**6b. Verify the workbook formulas — MANDATORY.**

What this step guards against: the generator writes two kinds of formula (`=ROW()-n` for row numbers,
`=COUNTA(...)` for the `FunctionList` totals), and any text value in `spec.json` that starts with `=`
is also stored as a formula — Excel then shows `#N/A`, `#NAME?` or similar in a delivered file. The
workbook is saved without calculated values, so the errors only appear when someone opens it.

1. The generator's Quality Gate reports every `spec.json` text value that starts with `=` as an
   error. It must report 0 errors (`--strict` refuses to write the file otherwise).
2. Open the generated workbook in a spreadsheet application (Excel, LibreOffice Calc, or an upload to
   Google Sheets), let it recalculate, and confirm: the `#` column shows 1, 2, 3… in every sheet, the
   `FunctionList` Total column shows the case counts from the script's summary, and no cell shows an
   error value (`#N/A`, `#NAME?`, `#REF!`, `#VALUE!`). A formula-aware checker, when the environment
   has one, may replace the visual check; its error count must be 0.
3. When no spreadsheet application is available, step 1 is sufficient for a file produced by the
   script and not edited afterwards — its only other formulas are the two above. Say in the report that
   the visual check was not done.

> Common mistake: a `spec.json` string that starts with `=` (e.g. `"= Unit price * Qty"`) becomes a
> formula. Write `"Formula: Unit price * Qty"` instead of `"= ..."`.

**6c. Self-review against the Review Checklist** (`references/quality-gate.md`) — boundaries, required
fields, negative cases, permissions, error handling covered; no duplicates; concrete Test Data.

**6d. Report to the user** exactly 3 things:

1. Total number of cases
2. Number of P1 cases (run first when time is short)
3. The list of unsettled rules the business analyst must confirm

---

## Process blockers

Output **CANNOT CONTINUE** (in the project's `locale`) and ask the user, instead of guessing, when:

- There is no spec document to read
- The scope cannot be determined (which screen, which level)
- The level cannot be determined (project or system) and the spec has both
- An ambiguity that **affects a whole group of cases** is unanswered (e.g. the main calculation
  formula, the status lifecycle)
- The Inventory Gate cannot be built because the spec is too thin
- The method files (`references/`, `assets/`, `scripts/`) are missing for the project's locale

Isolated ambiguities with local effect: **still generate the file**, marked with the
needs-confirmation marker.

---

## Anti-patterns (FORBIDDEN)

| Anti-pattern | Why |
|---|---|
| Guessing a business rule before asking (Step 2) | Seriously wrong checklist — worse than a missing case |
| Skipping the Inventory Gate (Step 3) | Fields/tabs/rules get missed and you cannot tell what is missing |
| Generic / placeholder Test Data | Bugs cannot be reproduced or verified |
| Vague Expected Result ("works correctly", "succeeds") | Pass/Fail cannot be decided |
| Several goals in 1 case | A failing row does not say which goal failed |
| Two opposite states (enable/disable, show/hide) in 1 case | Same as above |
| Business Rule written as an action ("Check …") | No true/false condition is stated |
| Impact written as "the feature cannot be used" | No knock-on effect, so no basis for Priority |
| Adding UI/UX, search, paging, performance cases | Outside hardening scope; dilutes the checklist |
| Missing the restore-running-total case on document Cancel/Close | The case most often missing in transactional systems |
| Generating a large system's whole checklist at once | Quality cannot be controlled; batch and wait for confirmation |
| Missing the double-submit case for document-generating buttons | Two clicks create two documents and add to running totals twice |
| Skipping the formula verification in Step 6 | The delivered file shows `#N/A` and loses credibility |

---

## References

- `references/doc-spec-phat-hien-diem-mo.md` — dissecting a business spec + the 10 business question
  groups to always check + the 6 ambiguity areas
- `references/quy-tac-viet-case.md` — naming, Expected Result, banned words, anti-patterns, case order,
  Case ID / QA ID conventions
- `references/ky-thuat-thiet-ke.md` — equivalence partitioning, boundary value analysis, decision
  tables, state transitions + coverage per field type
- `references/thu-vien-rule-mau.md` — rule library per field type (currency, exchange rate, %VAT,
  quantity running totals, status, import with code generation) with suggested Impact
- `references/quality-gate.md` — Inventory Gate, Review Checklist, Reject Conditions
- `references/dinh-dang-json.md` — JSON input schema of the generator
- `references/vi-du-hdvt.spec.json` — a complete example `spec.json` (the knowledge file says where it
  comes from)
- `assets/ProjectCode_IT_TestChecklist - Common.md` — Markdown reference for the checklist column
  structure
- `assets/TestViewpoint_CommonTestCase - Viewpoint List.md` — the common viewpoint library in Markdown
  (mostly UI; use only rows with `TEST TYPE = Functional / Boundary`)
- `scripts/build_checklist.py` — the generator
- `scripts/convert_xlsx_to_csv.ps1`, `scripts/convert_csv_to_markdown.ps1` — refresh the `assets/`
  Markdown after the template workbook changes
- Project knowledge: `<paths.knowledge>/hardening-checklist.md` — spec sheet names, level mapping,
  output naming, column-set variants, example origins
