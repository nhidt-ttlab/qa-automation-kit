---
name: create-testcase-steps
description: Create or update API-driven test-step documents (step matrix) from testcase scenario docs when the user asks to generate test steps for a module such as `orders`, `customers`, or `products`. Also consumes hardening/refactor checklist rows rerouted to the API lane by the UI test-step pass's checklist routing file.
metadata:
  short-description: Generate API-driven test-step docs from scenarios
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

# Create Testcase Steps

Use this skill when the user wants **step-level, API-driven test documents** generated from an existing scenario set — the pass that comes **after** `create-testcase-scenarios` and **before** automation.

This skill is for **step matrices**, not scenario docs, not testcase inventories, and not spreadsheet hardening checklists. It also does **not** run automation — that is a separate pass (`create-scenario-script`, following the scenario-automation section of `templates/automation-guide.md`).

Throughout this skill, `<module dir>` means `module.docSlug ?? module.id` and `<step dir>` means
`module.stepDir ?? module.docSlug ?? module.id`, for the module entry in `modules[]`.

Where each pass lives:

| Pass | Skill / guide | Output |
|---|---|---|
| Inventory | `create-testcase-inventory` | `<paths.featureDocs>/<module dir>/<inventory doc>` |
| Scenario | `create-testcase-scenarios` | `<paths.featureDocs>/<module dir>/<scenario doc>[.md and/or child folder]` |
| **Steps (this skill)** | **this skill** | **`<paths.steps>/api/<step dir>/<TC id>-<slug>.md`** |
| Automation | `create-scenario-script` + `templates/automation-guide.md` | `<paths.suites>/<module.suite>/...` |

The exact file names of the inventory, scenario and API/UI classification documents inside a module
folder are project conventions — take them from the knowledge file, or from the files the previous
passes actually wrote.

## Two source paths

**Path A — a scenario set (the normal case).** The user names the module's scenario docs; those are
the source of truth and the testcase count is fixed by them. Everything below assumes Path A unless
stated otherwise.

**Path B — a hardening / refactor checklist rerouted from the UI pass.** `create-testcase-steps-ui`
ran its routing step on a checklist and produced a routing file (`checklist-routing.md`, normally
under `<paths.checklists>`; the knowledge file names the real location) with rows marked
`→ API lane`. Those rows are **candidates, not testcases**, and Path A's guarantees do not come free
here: a checklist row carries no SpecID and no scenario section, so nothing pins it down yet.

Path B adds two obligations and relaxes none of the hard rules below:

1. **The inventory is where a TC id is born — never a step file.** If the rerouted row has no
   testcase in the module's testcase inventory under `<paths.featureDocs>/<module dir>/`, the
   inventory pass runs first. This is the same rule as Path A, and it is the one most likely to be
   skipped under schedule pressure.
2. **No SpecID, no testcase.** A checklist row that cannot be traced to at least one SpecID in the
   module's field-level spec is a question for the business analyst, recorded in `Open questions`.
   Do not reverse engineer a rule from the checklist's `Expected result` column and write a testcase
   against it — that is inventing a spec, and the resulting test asserts QA's guess rather than the
   product's contract.

A row whose spec area turns out to be genuinely uncovered is a **finding worth more than the row**:
report the size of the uncovered SpecID range, because the checklist row is usually one slice of a
much larger inventory gap.

## Required inputs

Read these before writing any file:

1. `templates/automation-guide.md` — **the test-step section (§1)**: the authoritative section list and per-section rules.
2. `templates/api-test-steps.md` — copy the section list, do not reinvent it.
3. The scenario documents the user names — **the source of truth**, e.g.:
   - `<paths.featureDocs>/<module dir>/<NN>-testcase-scenarios.md` + its `<NN>-testcase-scenarios/` child files (whatever naming the project uses)
4. A finished module as the style reference — the knowledge file names which existing step folders (and their module-level prompt files) to model on. Prefer a large module that already carries real `Automation findings`.
5. The module's `API-MAP.md` if one exists in the target folder `<paths.steps>/api/<step dir>/`.
6. **Path B only** — the checklist routing file produced by the UI pass, plus the source checklist itself (under `<paths.checklists>`). Read the routing table for module + SpecID + verdict; read the checklist only for the row's original wording, never as a rule source.

Read the inventory and field-level spec files (`<paths.featureDocs>/<module dir>/`) only when the scenario points to them for source confirmation — never to add rules the scenario did not carry.

## Goal

Produce one test-step file per scenario that:

- stays faithful to the scenario set as the **source of truth**
- can be handed to an automation author without re-deriving the business rule
- names a real API/actionId for every verification, or says explicitly that it is unconfirmed
- keeps every unresolved point visible instead of quietly resolved

## Traceability contract — filename and directory are the join key

Step files carry **no frontmatter**. Their edges are recovered from the path, which in practice
recovers almost every edge — cheaper and more reliable than metadata nobody maintains. That only
holds while both halves stay exact:

- **Filename** starts with the TC id verbatim: `TC-<module.tcPrefix>-<group><n>-<slug>.md`, and the id
  matches `ids.testCase`.
- **Directory** is `<paths.steps>/api/<step dir>/`. `<step dir>` is the **same string** as the
  module's feature-doc folder `<module dir>` unless `module.stepDir` says otherwise. Do not translate
  or shorten it, and do not invent a new `stepDir` — a divergent folder name costs a file move plus
  every reference to it (docs and code) to undo later.

Take `tcPrefix`, `docSlug` and `stepDir` from the module's entry in `modules[]` — never invent one,
and never derive `tcPrefix` from the SpecID prefix (in many projects they differ). If the module has
no entry, or no `tcPrefix`, stop and ask; that is a config gap, not something to guess.

Every TC id used here must already exist in the module's testcase inventory. If it does not, the
inventory is what needs updating — do not let a step file be the first place a TC id appears.

## Hard rules

- **1 testcase = 1 file.** Never merge two scenarios into one file, never split one into two, never renumber, never add a testcase the scenario set does not contain. On Path B the same rule binds against the **inventory**: never write a step file for a TC id the inventory does not already declare.
- **Do not invent** endpoints, actionIds, field names, formulas, validations, workflow states, roles, or error-message strings. If it is not in the scenario, the API map, or traced backend source, it carries the project's **unresolved marker** (`[needs confirmation]` by default; the knowledge file gives the locale's exact string).
- **Preserve the unresolved marker and the blocking marker (`[BLOCKING - needs confirmation]` by default) exactly as the source writes them.** Never downgrade, never remove, and never upgrade a non-blocking case to blocking beyond what the source says.
- **Never treat a spec `Field` column as an `API Field`.** Spec sheets often fill `Field` with UI-model names; that is not proof of the API contract.
- **Split Setup / Execute / Verify.** A verification folded into an action step is a defect in the document.
- **Every file declares `Test step status`** — `Ready` only when the case can be executed end-to-end with a confirmed actionId and finalized pass/fail; otherwise `Draft`.
- **Blocking cases are still written**, as `DRAFT - BLOCKING`: full setup and observable probes, core-rule assertions left `TBD` / `NOT_EVALUATED`, and an explicit statement that PASS/FAIL cannot be finalized. The knowledge file points to an existing blocking step doc to model on.
- **Do not add the Quality-Gate case types the source never specified** — double-submit, permission / direct-API bypass, cumulative-total reversal on cancel/reject, a zero exchange rate or similar degenerate numeric inputs. If the scenario flagged them as missing, record that in `Open questions`; do not create testcases for them.
- **Do not write section 11 (`Automation findings`)** in this pass. It exists only after automation has traced real backend behavior.
- If the scenario set and another document conflict, the **scenario wins** and the mismatch goes into `Open questions`.

## Resolving `API / actionId`

Spec sheets frequently leave `API Field` / `DB Column` empty, so scenarios arrive with `Main API / actionId` marked unresolved for every case. Resolve it **before** mass-producing files:

1. Discover candidates through the API MCP server (`mcp.apiServerName`):
   `mcp__<mcp.apiServerName>__discover_domains({ keyword })` →
   `mcp__<mcp.apiServerName>__load_domain_api_registry({ domainId, intent })`. For a goal described in
   plain language, `mcp__<mcp.apiServerName>__plan_task({ task })` returns an ordered set of
   candidate actionIds across dependent domains. Never guess `path`/`httpMethod`.
2. **Trace the backend source** for each candidate before marking it `confirmed` — the repository
   behind each API is `apiSources.<id>.repository`. Swagger proves the endpoint exists, not the field
   mapping. Skipping this is expensive: an endpoint-only confirmation of a create/update DTO can
   propagate a wrong field mapping into every testcase that depends on it.
3. Optional live probe: `mcp__<mcp.apiServerName>__execute_api_action({ actionId, ... })` may confirm
   a **read** response shape. It refuses non-read calls unless writes are enabled for the server
   (`api.allowWrites` / `api.allowWritesEnv`), and destructive operations additionally need
   `confirm: true`. Do not enable writes or confirm destructive calls just to write a step document;
   check whether the response was live or stubbed before citing it as evidence.
4. Record results in `<paths.steps>/api/<step dir>/API-MAP.md`: screen · operation · `actionId` · method + path · confidence (`confirmed` / `candidate` / `unknown`) · source traced · testcases depending on it.
5. In files, write actionIds in the format the MCP server issues — `<api source id>::<METHOD>::<path>`,
   e.g. `shop-api::POST::/api/orders` (the source id is `apiSources.<id>.mcpId` when set, otherwise the
   key). Anything absent from the map keeps the unresolved marker with the reasoning written down.

The share of `confirmed` rows determines how many files can be `Ready`; report that number to the user before generating a large batch.

## Expected output structure

Per file, in this order (sections 1–10 as listed in the automation guide's test-step section; the template carries the skeleton; §11 comes later, in the automation pass):

1. Title + `> **DRAFT**` / `> **DRAFT - BLOCKING**` banner when applicable
2. `## 1. Test overview` — ID, name, `Test step status`, Module, **link to the exact scenario section** (deep link with anchor), `Covered SpecID`, one-sentence `Primary rule`, `Test type`, and `Priority` when the source carries one
3. `## 2. Business rule in one paragraph` — business language only, no field names or endpoints
4. `## 3. Traceability to API feature` — one row per SpecID, with *why this test needs it*
5. `## 4. Test data`
6. `## 5. Preconditions` — `P1`, `P2`, … each with a concrete way to verify and the expected evidence
7. `## 6. Step matrix` — `Step | Phase | Action | API / actionId | Input | Expected result | Evidence to capture`, phases `Setup | Execute | Verify | Cleanup`
8. `## 7. Assertions` — `A1`, `A2`, … stable IDs matching `ids.assertion`; automation `check()` calls and recap reports cite them in the `ids.checkRef` form (e.g. `TC-ORD-A01 / A2`)
9. `## 8. Pass / fail rule` — in terms of assertion IDs, calling out any conditional/best-effort one
10. `## 9. Notes for automation`
11. `## 10. Open questions` (with the locale's unresolved marker in the heading, as the knowledge file shows) — flat list of every unresolved assumption above

Section headings stay in the form the template gives for the project's locale; the knowledge file lists any project-specific heading or label conventions.

Module-level deliverables alongside the files:

- `<paths.steps>/api/<step dir>/CHECKLIST.md` — one row per testcase, columns `Done | TC ID | Name | Step file | Automation | Status` (column labels in the project's locale — see the knowledge file), plus a progress-overview table, following the step-lane index `<paths.steps>/api/CHECKLIST.md`
- `<paths.steps>/api/<step dir>/PROMPT-create-test-steps.md` — the reusable prompt, following the style-reference modules' versions
- `<paths.steps>/api/<step dir>/API-MAP.md` when actionIds had to be resolved

## Style guidance

- Write in the project's `locale`. Keep code identifiers, endpoint paths, field names, and error codes in their original casing so they stay greppable against source.
- Preserve the source's original wording verbatim, **including its typos and inconsistent formulas** — never silently fix them.
- Keep assertion IDs short and stable; they are load-bearing downstream.
- File names: `<TC id>-<slug>.md`, slug lowercase ASCII (transliterate non-ASCII letters), hyphen-separated, describing the rule (`TC-ORD-A12-total-after-tax-formula.md`).
- Cross-link related cases in `Notes for automation` (gates, shared fixtures, formula chains) instead of duplicating their setup.

## Recommended workflow

1. Confirm the scenario set and count the testcases; that count is the scope boundary — files out must equal scenarios in. **Path B**: the scope boundary is the set of `→ API lane` rows in the routing file that resolved to a SpecID *and* have an inventory entry. Rows failing either condition are reported, not written.
2. List, from the scenario docs themselves: blocking cases, unresolved-marker cases, excluded items, module-level blocking points, and the SpecID coverage total. Read each child file's own blocking section — **never derive the blocking list by grepping**, because cases frequently *reference* another case's flag.
3. Resolve actionIds (see above) and write `API-MAP.md`.
4. For a large module (roughly > 60 testcases), write a batch plan first — an index plan plus one sub-plan per batch, batched along **data-dependency boundaries**, not into equal-sized chunks. The knowledge file names the plans folder and an existing index plan to follow.
5. Generate files batch by batch. Within a batch, order by dependency: independent fields → table/import → formula chains → status/cumulative rules → blocking cases last.
6. Update the module `CHECKLIST.md` after each batch, plus the overview table in `<paths.steps>/api/CHECKLIST.md`.
7. Close with a summary: files created, which are `DRAFT - BLOCKING`, which still carry the unresolved marker, SpecID coverage vs. the expected set, and what stayed out of scope and why.

## Verification before declaring done

- File count equals scenario count — nothing missing, nothing extra, no renumbered IDs. Path B: file count equals the number of routed rows that cleared both gates (SpecID + inventory entry), and every row that did not clear is named in the closing summary.
- Every file name's TC id matches `ids.testCase` and uses the module's `tcPrefix`; every file sits in `<paths.steps>/api/<step dir>/`.
- Path B: every TC id written already existed in the inventory **before** this pass wrote its file.
- The union of `Covered SpecID` matches the expected API-group SpecID set from the module's API/UI classification doc.
- Blocking-file count matches the number the inventory/scenario declares. A mismatch means a flag was silently raised or lowered — stop and reconcile rather than shipping.
- No file contains an endpoint or actionId absent from `API-MAP.md`.

## Avoid

- Jumping straight to automation code without the step spec (the automation guide says the spec is what pins down the assertion IDs)
- Guessing an endpoint from a column label, a UI field name, or a similar module's route
- Writing hard assertions on money/quantity results while the rounding rule is still unresolved — show the arithmetic, leave the comparison `TBD`
- Collapsing a partially-verifiable case into a misleading `PASS` shape; the verdict vocabulary is `PASS | PARTIAL | FAIL | BLOCKED | ERROR`
- Filling coverage gaps with self-invented testcases
- Editing the scenario or inventory docs from this pass — record divergences instead, and let a separate pass update the source of truth
- Sending write or destructive API calls to "confirm" an endpoint while writing documents
