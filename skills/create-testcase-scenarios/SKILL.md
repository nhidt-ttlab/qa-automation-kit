---
name: create-testcase-scenarios
description: Create or update test-case scenario documents from a module's test-case inventory. Use when the user asks to generate scenario docs, "write the scenarios" or "turn the inventory into scenarios" for a module, or to extend an existing scenario set after its inventory grew.
metadata:
  short-description: Generate test-case scenario docs from an inventory
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

# Create Test-Case Scenarios

Use this skill when the user wants scenario-level test-case documentation generated from an existing
inventory file. For a module, everything lives in its feature-doc folder:

```
<paths.featureDocs>/<module.docSlug ?? module.id>/
  NN-testcase-inventory.md        ← input (source of truth)
  NN-testcase-scenarios.md        ← output: top-level scenario file
  NN-testcase-scenarios/          ← output: optional child files
```

`NN` is the numeric prefix the module folder already uses for that document; a new scenario file
takes the next free number after the inventory unless the knowledge file names the number. Resolve
the module from the user's words against `modules[].id`, `modules[].docSlug` and
`modules[].featureCodes`; ask when more than one module matches.

This skill is for **scenario documents** — not checklist spreadsheets and not step-by-step
execution documents (those are the `create-testcase-steps` / `create-testcase-steps-ui` skills).

## Required inputs

Read these before writing:

1. The `hardening-checklist` skill (`../hardening-checklist/SKILL.md` next to this skill folder) —
   its risk vocabulary (business rule, impact, priority, anti-patterns such as a double submit
   creating two documents) is the lens for the Observation section.
2. The target inventory file the user names, normally
   `<paths.featureDocs>/<module.docSlug ?? module.id>/NN-testcase-inventory.md`. When the user names
   only the module, list the folder and pick the inventory; the knowledge file may name the default
   inventory per module.
3. The scenario style reference — an existing, reviewed scenario document from the same project.
   The knowledge file names it. When none exists yet, follow the structure in this skill alone.

Read any extra files referenced by the target inventory only when they are needed to confirm source
naming, API/actionId, scope, ambiguity, or traceability.

## Goal

Produce scenario documents that:

- stay faithful to the inventory as the **source of truth**
- match the presentation style of the project's scenario style reference
- capture business rule, API/assertion, scope, exclusions, ambiguity, and traceability
- do **not** expand into detailed test execution steps

## Hard rules

- Only write scenarios for items already covered by the target inventory.
- Do not invent business rules, validations, formulas, permission rules, endpoints, or field
  mappings.
- Preserve the inventory's ambiguity tags exactly — the plain "needs confirmation" tag and the
  "BLOCKING — needs confirmation" tag. Copy the literal strings the inventory uses (the knowledge
  file lists the project's spelling); never translate, soften or reword them.
- If another source conflicts with the inventory, keep the inventory as source of truth and record
  the mismatch in `Observation`, `Open questions`, or the test case's dependency note.
- When the inventory is split by API/UI, write main test-case scenarios for the API-driven items
  only.
- Put UI-only items and "insufficient data" items into exclusion sections, not into the main
  test-case list.
- If the inventory says later blocks are unfinished, explicitly mark them out of scope and do not
  fill them in.
- Do not merge or split test-case groups differently from the inventory unless the inventory itself
  already defines that grouping. One test case = one business rule, as the inventory states it.
- Test-case ids are the inventory's ids, unchanged. They match `ids.testCase` and carry the module's
  `modules[].tcPrefix` (e.g. `TC-ORD-A01`). Never renumber, and never mint an id the inventory does
  not have — a missing case goes into Observation as a proposal for the inventory.
- Main API / actionId values are the ones the inventory recorded (looked up through the API MCP
  server `mcp__<mcp.apiServerName>__*` or the OpenAPI spec of an `apiSources` entry). Keep an
  unconfirmed one flagged; do not make one up.

## Frontmatter — on the top-level file and every child file

```yaml
---
id: <module>/<filename without .md>
type: scenario
module: <module.docSlug ?? module.id>
feature: <FeatureID>              # one of modules[].featureCodes
spec_prefix: [ORD]
tc_prefix: ORD                    # modules[].tcPrefix
status: draft
provenance: confirmed
part_of: <module>/00-index              # top-level file
# part_of: <module>/NN-testcase-scenarios   # child files point at the top-level file
derives_from:
  - <module>/NN-testcase-inventory
updated: YYYY-MM-DD
---
```

- **`part_of` is declared by the child only.** The top-level file must not list its children —
  that list is generated. Declaring both directions guarantees drift.
- Child files `derives_from` the **inventory**, not the top-level scenario file: the inventory is
  where their scope actually comes from.
- Relations are the closed set `derives_from · covers · depends_on · supersedes · related ·
  part_of · reviews`. When a link means "I copied the structure, not the content", it is
  `related` — writing `derives_from` there inverts the meaning of the edge.
- `covers` (optional) lists the SpecID ranges the file covers when the inventory states them.

## The relation table must carry a typed column

The "Related documents" section is a table. Give it **three** columns — document, relation, role
(the knowledge file gives the locale's column headings):

```markdown
| Document | Relation | Role |
|---|---|---|
| [NN-testcase-inventory.md](NN-testcase-inventory.md) | `derives_from` | Source of scope/priority/grouping |
| [../orders/07-testcase-inventory.md](…) | `—` | Structure template only — **no** business content taken |
```

`Relation` takes one of the seven relations (`derives_from · covers · depends_on · supersedes ·
related · part_of · reviews`) or **`—`**, and must agree with this file's frontmatter.

**`—` means deliberately no edge**, and it is a correct answer. Rows phrased as the *negation* of a
relation ("no business content taken", "not used as a basis") must stay `—`. Turning one into
`related` to tidy the table produces an edge that means the opposite of the sentence next to it.

## Expected output structure

Create a top-level scenario document and, when helpful, split detailed content into child files
(in the `NN-testcase-scenarios/` folder, one file per group, ordered by a letter suffix such as
`NNa-<group-slug>.md`, `NNb-<group-slug>.md`).

The top-level file should usually contain these sections (use the locale's headings from the
knowledge file):

- Title
- Source
- Related documents
- Goal
- Scope / principles
- Notes on blocking test cases
- Coverage checklist
- Items excluded from the main scenarios
- BLOCKING / needs-confirmation list
- Observation / open questions
- Traceability / coverage summary

Child scenario files should usually keep each test case clear and scan-friendly with:

- Test case ID
- Test case name
- Business rule
- Covered SpecIDs
- Main API / actionId
- Precondition / data setup
- Expected result / main assertion
- Dependencies / open questions
- Priority

What each top-level section carries:

| Section | Content |
|---|---|
| Source | The inventory as source of truth; any supporting file read and why; the style reference, stated as "presentation only, no business content" |
| Related documents | The three-column relation table above |
| Goal | Which blocks/groups are covered, the test-case count and id ranges, and that this is not yet a step matrix |
| Scope / principles | Only what the inventory covers; unfinished blocks named as out of scope; one case = one rule; API-driven only; no inference; actionIds as recorded |
| Notes on blocking test cases | What the BLOCKING tag means (a core part of the rule cannot get a hard assertion yet) vs. the plain tag (one detail pending); which cases carry each |
| Coverage checklist | Table: group · child file · test-case range · count · SpecIDs; a total that matches the inventory's traceability section |
| Items excluded | Table: SpecID · field · reason (UI-only, insufficient data), citing the inventory section; unfinished blocks noted as not yet listed |
| BLOCKING / needs-confirmation list | Table: test case · type · issue, worded as in the inventory |
| Observation / open questions | Findings outside the inventory's confirmed content — review notes, source conflicts, missing cases — each marked as *not* a test case, with what must change in the inventory first |
| Traceability / coverage summary | Covered API SpecIDs vs. total for the scope, priority distribution, the High-priority list |

In every tagged case, the expected-result part states which assertions are firm and which are
pending, and the dependencies part states what to ask the business analyst or developer before
the rule can be settled.

## Style guidance

- Write in the project's `locale`.
- Follow the tone and document shape of the project's scenario style reference.
- Use the reference file to learn structure and phrasing style only; never copy unrelated business
  content.
- Keep the writing at scenario level: enough to hand off to step writing later, but not a step
  matrix. A short high-level flow and "key assertions to verify later" are fine; request payloads,
  exact field values and step tables are not.
- Keep traceability explicit between test-case IDs and SpecIDs.
- Make phased coverage obvious if the inventory only covers part of the module.

## Recommended workflow

1. Identify the named inventory file and treat it as the scenario scope boundary.
2. Read the inventory fully and list:
   - covered blocks
   - uncovered blocks
   - API/UI exclusions
   - ambiguity tags
   - traceability totals
3. Read only the supporting files the inventory points to for source confirmation.
4. Draft the top-level scenario file first.
5. Add child files only when the scope is large enough to benefit from splitting by report, tab, or
   block.
6. Check before finishing:
   - every test-case id in the scenarios exists in the inventory, and every API-driven id in the
     inventory's covered blocks appears in exactly one scenario
   - coverage-checklist totals equal the inventory's traceability totals
   - every ambiguity tag in the inventory is still present, spelled identically
   - frontmatter relations agree with the relation table; the top-level file lists no children
7. End with a short summary of:
   - files created
   - test cases/groups covered
   - unresolved needs-confirmation / BLOCKING tags
   - out-of-scope sections due to an incomplete inventory

## Module scope notes

Some modules keep extra analysis files next to the inventory (API/UI classification, per-screen
specs). Which file is the default primary source for a module, and which siblings are supporting
references only, is recorded in the knowledge file. Without such a note: the inventory is primary,
and siblings are read only when the inventory points to them or a source must be confirmed.

## Avoid

- Writing detailed test steps
- Adding test-case logic not present in the inventory
- Quietly resolving contradictory specs without noting it
- Mixing scenario content from another module
- Presenting unfinished inventory areas as complete coverage
