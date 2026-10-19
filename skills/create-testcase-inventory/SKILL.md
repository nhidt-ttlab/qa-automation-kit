---
name: create-testcase-inventory
description: Create or update a test-case inventory document for a module, or generate a prompt that produces one, from the module's field-level feature extraction docs. Use when the user asks for a testcase inventory, business-rule coverage by SpecID, or a prompt to generate an inventory for a named module.
metadata:
  short-description: Generate testcase inventory docs or prompts
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

# Create Testcase Inventory

Use this skill when the user wants a **test-case inventory** for a module, or wants a **prompt** that
another model can use to generate that inventory.

This skill is for **inventory-level output**:

- grouped business rules
- SpecID coverage (a SpecID is the id of one field/action row in the module's field-level extraction)
- API/UI split handling
- traceability and ambiguity tracking

This skill is **not** for:

- Excel hardening checklist generation
- detailed test-case execution steps
- scenario documents generated from an existing inventory

For checklist Excel generation, follow the `hardening-checklist` skill.
For scenario docs generated from an inventory, use the `create-testcase-scenarios` skill.
If the module has no field-level extraction docs yet (no
`<paths.featureDocs>/<module.docSlug ?? module.id>/00-index.md`), build them first with the
`create-feature-extraction` skill — it extracts them from the spec source (`<paths.specSource>`:
CSV sheets or Markdown specs).

## Resolve the module first

1. Match the module the user names against `modules[]` in the config (by `id`, `docSlug`, or a
   feature code in `featureCodes`). If it is not declared there, stop and ask — do not invent a
   module id or a test-case prefix.
2. From that entry take:
   - the docs folder: `<paths.featureDocs>/<module.docSlug ?? module.id>/` (call it `<moduleDocs>`
     below)
   - the feature codes: `module.featureCodes`
   - the test-case prefix: `module.tcPrefix`
3. Test-case ids must match `ids.testCase`. The usual shape is `TC-<module.tcPrefix>-<series><n>`
   (for example `TC-ORD-A01`, `TC-ORD-U03`); the knowledge file names any series letters or named-id
   exceptions the project uses.
4. Read the knowledge file's scope notes for this module, if any: phase boundaries, the names of its
   classification and inventory files, SpecID prefixes, and explicit out-of-scope decisions.

## Required inputs

Read these before writing:

1. The `hardening-checklist` skill (its risk-based discipline applies here).
2. The target module index: `<moduleDocs>/00-index.md`.
3. The extraction root index: `<paths.featureDocs>/index.md`.

Read additional sibling files only when needed:

- the module's API/UI classification file (its file name is in the knowledge file, or find it in
  `<moduleDocs>` by its role)
- per-screen extraction files
- an existing inventory from another module used only as a style reference (the knowledge file
  names the preferred ones)

## Decide the deliverable first

There are two valid outputs. Pick the one that matches the user's request.

### 1. Inventory document

Use when the user wants you to actually create or update a test-case inventory Markdown file in
`<moduleDocs>`.

### 2. Inventory-generation prompt

Use when the user asks for a prompt, e.g. "give me a prompt to generate the inventory for orders".

In prompt mode:

- generate a prompt that is specific to the named module
- embed the module's counts, structure, ambiguities, and cross-module dependencies
- tell the downstream model not to invent business rules, APIs, or assertions
- tell it how to phase the work if the module is too large for one pass

## Goal

Produce an inventory or an inventory-generation prompt that:

- stays faithful to the module extraction docs as the source of truth
- follows the risk-based discipline from `hardening-checklist`
- focuses on API-driven business rules, formulas, dependencies, and traceability
- separates UI-only and insufficient-data items from the main inventory
- preserves unresolved ambiguity with explicit tags — a "needs confirmation" tag and a stronger
  "BLOCKING — needs confirmation" tag, written in the project's locale (the exact tag text is in the
  knowledge file)

## Hard rules

- Do not invent business rules, validations, formulas, permission rules, endpoints, or field mappings.
- Keep the source business terms in the source spec's language — do not translate them.
- Treat the module index and sibling extraction docs as the truth boundary unless the user explicitly
  asks to verify with code or API docs.
- If a spec row lacks enough meaning to support a test-case rule, exclude it from the main inventory
  and explain why.
- If the module already has an API/UI classification, use it; do not silently reclassify without
  evidence.
- Keep `1 test case = 1 business rule`.
- Only group multiple SpecIDs when they truly express the same rule, and explain it in the
  "Why grouped" column.
- Do not convert the inventory into detailed test steps.
- Do not treat UI-only items such as display order, layout, pagination, export, navigation, or
  cosmetics as hardening inventory unless the user explicitly asks for them.

## Frontmatter — emit it, do not leave it to be recovered later

The inventory is the single authoritative source for **which test-case ids exist**. Nothing
downstream can recover that: deriving test-case ids from step filenames misses every test case that
has no step file yet (a module can have dozens of ids declared in its inventory and zero step files).

Start the document with:

```yaml
---
id: <module>/<filename without .md>
type: testcase-inventory
module: <module.docSlug ?? module.id>
feature: <FeatureID from module.featureCodes>
spec_prefix: [ORD]
tc_prefix: ORD                      # every TC id in this file is TC-<tc_prefix>-*
status: draft                       # draft → stable when the workflow's checks pass
provenance: confirmed
part_of: <module>/00-index
derives_from:
  - <module>/<API/UI classification file without .md>
covers: ["ORD-1..ORD-243", "EP-01..EP-03"]
depends_on: [<other module slugs>]
updated: YYYY-MM-DD
---
```

- `covers` uses range notation, never a list of hundreds of ids.
- `tc_prefix` must equal `module.tcPrefix` from the config. It is **not** derivable from
  `spec_prefix` — SpecID prefixes are often per screen, so one module can carry several SpecID
  prefixes, none of which equals its test-case prefix. The knowledge file lists the known mismatches.
- `feature` must be one of `module.featureCodes`; if the module declares none, write the gap as an
  ambiguity instead of guessing a code.
- If you write test-case ids for UI-only items (for example a `U` series), they belong in an
  inventory too — otherwise those test cases have no source of truth and their `covers` edge is
  broken. Either declare them here or state explicitly why they are out of scope.

## The relation table must carry a typed column

The "Relation to related documents" section is a table. Give it **three** columns, not two:

```markdown
| Document | Relation | Role |
|---|---|---|
| [03-api-ui-classification.md](03-api-ui-classification.md) | `derives_from` | Scope boundary: only items classified **API** get a test case… |
| [../customers/00-index.md](…) | `depends_on` | Source of the code-generation rule that `ORD-21`…`ORD-24` refer to |
| [../orders-overview.md](../orders-overview.md) | `—` | Background only; **not** used as the basis for any rule |
```

`Relation` takes one of the seven relations (`derives_from · covers · depends_on · supersedes ·
related · part_of · reviews`) or **`—`**, and must agree with this file's frontmatter.

**`—` is a real answer, not a missing one.** Some rows say the opposite of a relation — *"used only as
a structural template, **not** as a source of business content"*. Those must produce **no edge at
all**: absence is the correct representation. Never "upgrade" a `—` row to `related` to make the
table look complete.

> Why the column exists: in a two-column version the relation type is buried in free prose. A keyword
> classifier over such rows resolves only a minority cleanly — many rows match several mutually
> exclusive rules at once, and negative-polarity rows get turned into edges that mean the opposite of
> what they say. The type is cheap to state while writing and unrecoverable afterwards. (The knowledge
> file may record the measured numbers for this project.)

## Expected inventory shape

When creating the inventory document itself, the output should usually contain these sections (use
the project's locale for the headings; the knowledge file gives the established heading text):

- Title
- Source
- Relation to related documents
- Principles used to build this inventory
- API domain / data flow / dependencies
- Test-case inventory
- Items excluded from the inventory
- Traceability
- Ambiguities / points the BA must confirm

Main inventory tables should usually include these columns, in this order:

| Column | Content |
|---|---|
| `ID` | Test-case id matching `ids.testCase`, prefix `TC-<module.tcPrefix>-` |
| `Test case name` | Short name of the rule under test |
| `Business rule` | The rule, stated from the source |
| `SpecID` | Covered SpecID(s) |
| `Why grouped` | Why several SpecIDs share this test case, or that the rule stands alone |
| `Type` | Test type, e.g. `API-driven` |
| `Main API/actionId` | Domain, entity and endpoint(s) or actionId the rule is exercised through; mark gaps instead of guessing |
| `Precondition / data` | Data state the test needs |
| `Main assertion` | What proves the rule holds |
| `Prio` | Priority (see style guidance) |

The excluded-items table should list, per excluded SpecID: `SpecID`, `Field`, `Screen`, `Class`
(UI / insufficient data) and `Reason`.

### API domain lookups

The "API domain / data flow / dependencies" section and the `Main API/actionId` column are filled
from the project's API references, read-only:

- generated API docs under `<api.docs.outputDir>` (grouped by each `apiSources` entry's `repository`),
  and/or
- the API MCP server: `mcp__<mcp.apiServerName>__discover_domains`,
  `mcp__<mcp.apiServerName>__load_domain_api_registry`,
  `mcp__<mcp.apiServerName>__resolve_domain_dependencies`.

Never call write actions while building an inventory. When an endpoint or action cannot be matched to
a rule with evidence, write the candidate with a needs-confirmation tag, or leave the gap explicit.

## Style guidance

- Write in the project's `locale`.
- Be technical and source-faithful.
- Use another module's inventory only to learn structure and phrasing style, never to copy business
  content.
- Keep priority tied to risk:
  - formulas, money, quantity, inventory balance, status gates, import overwrite/additive rules,
    downstream document effects -> High/P1
  - core operational rules without direct financial balance risk -> Medium/P2
  - secondary supporting rules -> Low/P3
- Make phase boundaries obvious when the module is too large for one pass.

## Recommended workflow

1. Resolve the module from `modules[]`; read `<moduleDocs>/00-index.md` and
   `<paths.featureDocs>/index.md`.
2. Determine whether the user wants:
   - a real inventory document
   - or a prompt to generate one
3. Read the module's API/UI classification file if it exists.
4. Identify:
   - total item counts
   - API/UI/insufficient-data counts
   - module structure or report/screen groups
   - cross-module dependencies
   - major ambiguities already called out in the docs
5. If creating the inventory:
   - define phase boundaries first (use the knowledge file's phase notes for the module when present)
   - build only the in-scope block
   - keep exclusions and traceability explicit
6. If creating a prompt:
   - bake in the exact file paths (resolved from the config, not left as placeholders)
   - bake in the exact counts and group names
   - tell the downstream model what to prioritize and what to exclude
   - require explicit ambiguity tracking
7. End with a concise summary of coverage, exclusions, and unresolved confirmation points.

## Module scope notes

Large modules should be phased — typically by screen, document type, or report, following the
structure of the module's `00-index.md`. Per-module phase boundaries and explicit scope decisions
(for example "screen X is out of scope because the source index says it does not belong to this report
set") are project facts: read them from the knowledge file and preserve them. When the source index
marks something out of scope, keep that decision visible in the inventory rather than silently
dropping or silently including it.

## Avoid

- Writing checklist-template columns such as `Impact`, `Test result`, or a tracker link column into an
  inventory document unless the user explicitly wants checklist-ready output
- Filling in unresolved API/actionId gaps from guesswork
- Mixing scenario-level formatting into inventory output
- Quietly "fixing" contradictory source rows instead of flagging them
- Presenting partial block coverage as if the whole module were complete
