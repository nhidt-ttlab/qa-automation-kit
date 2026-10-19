---
name: create-feature-extraction
description: Extract a source-faithful, field-level specification document set from a spec source — a spec sheet CSV (one sheet of the feature-list workbook) or a Markdown specification (SRS, screen spec) — into the module's feature-docs folder. Use when the user asks to extract a CSV, a feature-list sheet or an SRS/Markdown spec into docs, generate the `00-index.md` + per-capability-area files for a module, or produce the field-level spec that feeds `create-testcase-inventory`. Triggers on "extract document from CSV", "extract this sheet", "extract this SRS/markdown spec", "create the field-level spec from the feature list", "build the extraction set for screen X".
metadata:
  short-description: Spec sheet CSV or Markdown spec → field-level extraction doc set
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

# Create Feature Extraction (spec source → docs)

Turns one **spec source** into the module's **field-level extraction doc set** — the first link in
the QA pipeline:

```
spec workbook ──(project export step, see knowledge)──> <spec source>/NN-<sheet>.csv
SRS / screen spec ─────────────────────────────────────> <spec source>/<spec>.md
        │
        └─ THIS SKILL ─> <paths.featureDocs>/<module.docSlug ?? module.id>/
                            00-index.md + one file per capability area + NN-<classification file>.md
                                │
                                ├─> create-testcase-inventory   (inventory)
                                ├─> create-testcase-scenarios   (scenarios)
                                ├─> create-testcase-steps / -ui (step matrix)
                                └─> create-scenario-script      (*.scenario.ts)
```

In this skill, `<module>` means the module's folder name, `module.docSlug ?? module.id`, from
`modules[]` in the config, and `<spec source>` means `paths.specSource` — the folder holding the
project's specification sources — falling back to the older, CSV-only `paths.specCsv` when a project
still declares that one.

**Two source formats, one process.** Everything below applies to both; where they differ, the step
says so explicitly:

| | CSV sheet (`.csv`) | Markdown spec (`.md`) |
|---|---|---|
| Shape | one sheet, one column set, heading rows between item rows | headings, pipe tables, bullets and prose |
| Item row | a non-heading row | a row of an item table, or an id-bearing bullet |
| Sub-group | a heading row | a heading (`##`, `###`, …) |
| SpecIDs | generated (`ORD-1`…), the sheet has none | **the ids the source already carries** (`BR-OR01`, `ACT-OR02`) reused verbatim; generated only for rows that have none |
| Evidence | one fixed column set | a column set **per table**, plus prose and Gherkin that carry no row at all |

This skill produces **extraction only**. It does not write testcases, inventories, scenarios, or a
hardening checklist. For those, hand off to the skills above.

## Section and file names in this skill

Headings, file names, bucket names and markers are given below by their **role** in English. When the
project `locale` is not `en`, use the exact localized names listed in the knowledge file — downstream
skills and tools look for those exact strings. When the knowledge file lists none, use the English
names shown here.

| Role | English name used below |
|---|---|
| Classification file | `NN-api-ui-classification.md` |
| Insufficient-evidence bucket | `Insufficient data` |
| Blocking-question marker | `[BLOCKING - needs confirmation]` |
| Per-file anomalies section | `## Needs confirmation / Unclear` |

The same applies to **column names**. This skill refers to columns by role; the knowledge file maps
each role to the source's real header text (including any misspelled headers, which must be matched
verbatim). In a CSV sheet one column set covers the whole sheet; in a Markdown spec **each table has
its own set**, so the mapping is per table shape — the profiler prints each shape it found:

| Column role | Holds |
|---|---|
| label | the on-screen label of the field/action |
| field | the field or control name |
| API field / DB column | the API property / database column, when the BA filled it in |
| required / readonly | flags |
| default | default value |
| business meaning | what the field means / the business rule in prose |
| validation | validation rule text |
| boundary / error | boundary values, error message |
| round / status / bug / note | review-round, hardening status, bug reference, free note |

## The one rule that outranks everything

**Source-faithful, or not at all.** The output is a re-organization of the source, not an
interpretation of it. Every sentence of business content must be traceable to a cell, a bullet or a
paragraph of it.

- Keep all business content **in the source language, untranslated**. Only scaffolding (headings,
  explanatory prose, column names already in that language in the source) follows the project locale.
- Never fix the source. Typos (`Custmer name`), stray brackets, spreadsheet errors (`#NAME?`),
  contradictions between the required/readonly flags and the validation text, a business-meaning cell
  that just says "empty" — all reproduced **verbatim** and reported under `Needs confirmation / Unclear`.
- Never invent. If a column is empty, say it is empty. Do **not** infer an API endpoint, actionId,
  DB column, or validation rule from a field name.
- Keep group/heading names **verbatim from the source**, even when off-standard (`Tab_Order details`)
  and including markdown emphasis where the heading carries it (`**3.2. SCR-ORD-CREATE — Create order**`).
  They are the reverse-lookup key back to the sheet or the document.
- **Reuse the ids the source already carries** — `BR-OR01`, `ACT-OR02`, `EC-OR02` — verbatim, as the
  SpecID. Never renumber them, never close a gap in their numbering (a missing `BR-OR04` is a finding,
  not a mistake to tidy), and never re-letter a family to match another screen.

Fabricating a rule is a far worse failure than reporting a gap.

## Step 1 — Locate the source

Sources live under `<spec source>`: CSV sheets exported from the spec workbook (the knowledge file
names the workbook and the export command) and/or Markdown specifications — an SRS, a screen spec, a
feature write-up. **That folder is the only source you may read or cite**, unless the user names a
document outside it, in which case cite the path they gave and record it in `00-index.md`. If the
knowledge file lists retired copies (hand exports, renamed sheets, superseded SRS versions), never
read them and never recreate them; use its old-name → current-file table when older docs mention them.

A Markdown spec usually holds **many screens in one file**. One extraction set covers one module, so
work section by section: list the sections first, agree the section(s) in scope with the user when
the document covers more than the module does, and profile each in turn.

Read for context before writing:

1. `<paths.featureDocs>/index.md` — the master index, and the list of companion field-level specs you
   will extend (the knowledge file names that list).
2. The domain summary file the feature belongs to (named in the knowledge file) — business impact,
   priority, owner.
3. One existing set as a style reference — the knowledge file names a complete one and a simple one.
   If there is none yet, follow this skill's structure exactly.

The module's `featureCodes` in `modules[]` tell you which feature codes the set should cover. Confirm
the feature code(s) with the user when a source covers more than one, when its codes do not match
`featureCodes`, or when the same feature name exists at **more than one level** (for example
company-wide and per-project) — the knowledge file says whether that duplication is normal in this
workbook. In a Markdown spec the feature code is usually the screen id in the section heading
(`SCR-ORD-CREATE`) or a row of the screen's attribute table; take it from there, never from the
file name. When the source carries no feature codes at all (a design set, an architecture document),
the capability areas you define in step 3 *are* the feature list: give each a scaffolding code
(`F01`, `F02`, …), declare them as generated in `00-index.md`, and confirm them with the user.

## Step 2 — Profile the source before writing a word

```bash
node <skill folder>/scripts/profile-spec.cjs "<spec source>/NN-<sheet>.csv" --prefix ORD
# markdown: list the sections first, then profile the one in scope
node <skill folder>/scripts/profile-spec.cjs "<spec source>/<spec>.md" --list
node <skill folder>/scripts/profile-spec.cjs "<spec source>/<spec>.md" --section "SCR-ORD-CREATE" --prefix ORDF
# capability-area sets: one run per contributing section, numbering continued with --start
node <skill folder>/scripts/profile-spec.cjs "<spec source>/<spec>.md" --section "5. Credentials and configuration" --prefix AIA --start 38
# or let the script resolve the file from the config:
node <skill folder>/scripts/profile-spec.cjs "NN-<sheet>" --config <path to qakit.config.yaml> --prefix ORD
```

The script has zero dependencies and is CommonJS (`.cjs`) so it runs whatever the surrounding
`package.json` declares. The format follows the extension; `--format csv|md` overrides it.
(`profile-csv.cjs` still works — it is a shim over the same script.)

Options: `--prefix <ID>` (prefix for **generated** SpecIDs), `--start <n>` (first number for
generated SpecIDs, default 1 — continues one numbering across runs when a set is cut by capability
area and profiled one section at a time), `--compare <other>` (cross-source
contamination check), `--json` (machine-readable), `--config <qakit.config.yaml>` (resolve a file
name, or a unique substring of one such as a feature code, inside `<spec source>`), and, for Markdown
only, `--list` (every heading with its line) and `--section "<heading>"` (profile one section and
everything under it; an ambiguous string is refused with the list of matches).

It reports, from the actual file: the column set(s), item-row count, group/section structure with
spans and SpecID ranges, per-column fill coverage, and duplicated rows. For Markdown it also reports
the block inventory, the ids the source already carries (with their families and any gap in their
numbering), and the content that carries no item row at all.

**Every count, range, and coverage figure in the docs must come from this script, not from reading.**
Published sets state figures like "business meaning 51/121" — those are verifiable claims and
reviewers do re-run them.

CSV row model the script uses (a heuristic — sanity-check it against the sheet):

| Row kind | Shape | Treatment |
|---|---|---|
| Header | record 1 | column names |
| Block marker | one non-empty cell in col 1, no items before the next heading | names a block (e.g. `Company level` / `Project level`) |
| Sub-group heading | one non-empty cell in col 1, items follow | names a screen/tab → usually one output file |
| Item row | anything else non-empty | one field/action → one SpecID |

Markdown block model (the same kind of heuristic — check it against the document):

| Block kind | Shape | Treatment |
|---|---|---|
| Section | ATX heading `#`…`######` | screen / sub-group → usually one output file per screen |
| Attribute table | 2-column pipe table with no ids (`Attribute \| Value`) | screen metadata: priority, role, URL, screen id → the source line of the file, **no SpecID** |
| Item table | pipe table with ≥ 3 columns, or whose first column holds ids | one row → one item → one SpecID |
| Id-bearing bullet | `* EC-OR02: …` | one item → one SpecID, id reused verbatim |
| Narrative bullet / prose | layout notes, overviews | content with **no row to hang a SpecID on** |
| Gherkin scenario | `### Scenario 1` + Given/When/Then | acceptance criteria — carry verbatim, they become testcases downstream |
| Fenced code, frontmatter | ``` fences, YAML header | skipped entirely |

Read what the profile is telling you:

- **A 100%-empty column is a hard constraint.** API field / DB column empty means the classification
  file may not name a single endpoint or actionId, and the downstream inventory's main API/actionId
  column must be left blank with a note that the source has no API field.
- **Label column empty but field column full** means the sheet inverts the usual convention — labels
  come from the field column. State the rule and the per-file split explicitly.
- **Low business-meaning / validation coverage** predicts a large `Insufficient data` bucket in step 6.
  That is a valid outcome, not a failed extraction.
- **Duplicated blocks** are copy-paste contamination between sources. Verify with `--compare` against
  the suspected origin, then decide *with the user* whether to keep the block flagged or exclude it —
  and record the decision. Never silently drop rows.
- **A misread block is the markdown failure mode.** If an attribute table is really a list of items —
  or an item table is really metadata — the counts are wrong from the first line. Check the block
  table against the document before you write anything, and say in `00-index.md` which blocks you
  treated as metadata.
- **Gaps in the source numbering** (`BR-OR04` missing) and **duplicated native ids** are findings for
  `Needs confirmation / Unclear`. Reproduce the ids as they are.
- **Content with no item row** is not noise. Screen overviews, layout bullets and Gherkin scenarios
  carry real rules; they go into the per-area file's prose, and where one yields a testcase of its
  own with no field row behind it, it is declared under `EP-<n>`.

## Step 3 — Decide the file split

**Files are cut by capability area, never by source file.** A capability area is one thing the
system lets a user do, or does on their behalf — a screen or tab in a screen spec; a business
function (identity and credentials, task approval, Redmine synchronisation, object storage) in a
design document. The source container — a CSV sheet, a Markdown document, its file name — is where
the content was found, not what it is about, and it is never a grouping unit.

Default: **one output file per capability area**, in source order. In a screen-organised source
(a CSV sheet with sub-group headings, a Markdown spec with `SCR-…` sections) the areas are already
given: one file per sub-group heading / screen section. Its sub-sections — field table, business
rules, actions, edge cases, Gherkin — are sections *within* that file, not files of their own. A
screen's attribute table becomes the file's source line, not an item list.

When the source is **not organised by screen** — an SRS or design set whose sections follow document
types (architecture, data model, integration, storage, recommendations), possibly spread over several
files — build the **capability-area map before writing anything**:

1. `--list` every in-scope document; every section (verbatim heading + profiler line) is one row.
2. Assign each section to **exactly one** capability area. Name the area by what the system does
   (`Identity, authentication and credentials`, `Task workflow and approval gate`), never by the
   document it came from (`Architecture`, `Integration design`). Area names are scaffolding you
   write — one of the few things in the set that is not verbatim — and `00-index.md` must say so.
3. A section that touches two areas goes under the area that **owns the rule** and is
   cross-referenced from the other by SpecID / `EP-<n>`. Never split one section across two files.
4. Agree the map with the user, then cut one file per area. A file draws from every section — and
   every document — that its area owns; the section headings inside it stay verbatim.

The map is complete by construction: every section of every in-scope source appears in exactly one
row, so a reviewer can check it against the profiler's `--list` output.

Never:

- name a file after the source file (`01-architecture.md` from `ARCHITECTURE.md`) or cut one file per
  source document — that reproduces the author's document outline, not the system's capabilities, and
  the downstream inventory then has to re-sort every SpecID by hand;
- assign one SpecID prefix per source document (`ARC`, `ENG`, `ORC`, …) — a generated prefix belongs
  to the module; the only other prefixes are families the source itself declares.

Adjust when:

- a group is tiny (< ~5 items) and belongs with its neighbour → merge, and say so;
- two blocks repeat the same group names (e.g. `Company level` / `Project level`) → split by **block**,
  not by group name, and map file → feature code in `00-index.md`;
- two small sheets cover one concern → merge into one set with **two SpecID prefixes**
  (e.g. module `checkout`: `CART-1..26` + `PAY-1..6`);
- one screen section of a Markdown spec is far larger than the rest → split it at a sub-section
  boundary (field table vs business rules), keeping the id families intact, and say so.

**Generated SpecIDs are numbered continuously across the whole set**, in **output order** — area by
area in file order, source order within an area — with a short uppercase prefix derived from the
module (`ORD`, `CUST`, `PROD`), so every file owns one contiguous range. For a screen-organised
source, output order *is* source order. For a capability-area map, run the profiler once per
contributing section with `--start` set to the next free number, so every range in the docs still
comes from the script. Never restart numbering per file, never number per source document, and never
reuse a prefix already in use by another set.

**Ids the source already carries are not renumbered.** A Markdown set therefore usually mixes both:
`BR-OR01`…`BR-OR05`, `ACT-OR02`, `EC-OR02` straight from the document, plus `ORDF-1`…`ORDF-5` generated
for the field-table rows that had none. Declare every family in `00-index.md` (step 4), state which
are the source's own, and keep the generated prefix distinct from every family the source uses.

Naming: kebab-case in the project locale, ASCII only (strip diacritics), numbered by position —
`00-index.md`, `01-<first-capability-area>.md`, …, and the classification file last
(`NN-api-ui-classification.md`, or its localized name from the knowledge file). The slug is the
capability area (the screen name, or the area name from the map), never the source file name.
Directory: `<paths.featureDocs>/<module>/`.

### Size budget — soft, and it never wins over a semantic boundary

Target **≤ ~8 000 words per file** (`wc -w`, not line count — these files are wide markdown tables, so
lines are a broken proxy: a file with fewer lines can hold twice the words of a longer one).

When a file exceeds the budget, split at the **next natural boundary** (sub-group / tab), never at the
point the budget ran out. If a single indivisible unit exceeds it — a classification table for 1 000+
SpecIDs is a machine-read lookup, not prose — **keep it whole and say why in `00-index.md`**.

### The module slug is the same string everywhere

`<module>` (`module.docSlug ?? module.id`) must be reused verbatim by every downstream layer: the step
folders under `<paths.steps>` and the report folders. Do not translate it, do not shorten it. A step
folder that legitimately differs must be declared as `module.stepDir` in the config — never introduced
silently.

> Getting this wrong is expensive: a module whose step docs were written under a translated folder name
> means moving every step file and fixing every reference to it. The knowledge file records any such
> legacy exceptions.
>
> Automation suites (`<paths.suites>`) are the **exception** — they are organised by API domain and are
> legitimately many-to-many with modules (one suite can hold testcases from several modules; see
> `module.suite`). Never join a module to a suite by directory name; join by test-case id
> (`ids.testCase`).

### Auxiliary ID namespaces — declare them, never mix them into SpecID

Three namespaces are legitimate but are **not** SpecIDs, and any tool scanning for SpecIDs must exclude
them. If the set uses one, declare it in `00-index.md`:

| Code | Meaning |
|---|---|
| `BL-<n>` | source limitation — a gap in the sheet that makes something untestable |
| `OPEN-<n>` | open question parked for the BA |
| `EP-<n>` | testcase with a real endpoint but **no field-level row** in the sheet to hang a SpecID on |

Use exactly these spellings in new documents. If the knowledge file lists older alternative spellings
of the same concepts, **do not invent a further one**, do not rename existing reviewed files, and make
every tool that reads the corpus accept both spellings. None of these codes — nor any legacy spelling —
are SpecIDs.

## Step 3b — Frontmatter on every file the set produces

Every `.md` written by steps 4–6 starts with a YAML block. This is the document knowledge graph: you
know the provenance **at the moment you write the file**, and nothing can recover it afterwards by
inspection. Emitting it is nearly free; extracting it later is not possible for relation *type*.

```yaml
---
id: <module>/<filename without .md>
type: index | feature-spec | classification    # this skill writes only these three
module: <module slug>
feature: <feature code>                         # or a list when the set spans several
spec_prefix: [ORD, BR-OR, ACT-OR, EC-OR]        # every SpecID prefix this set owns, source's own included
tc_prefix: ORD                                  # module.tcPrefix — NOT derivable from spec_prefix
status: draft                                   # draft → stable once the self-check passes
provenance: confirmed
part_of: <module>/00-index                      # every file except 00-index itself
derives_from:
  - sheet:<spec source folder, repo-relative>/NN-<sheet>.csv  # CSV sheet node — see below
  - doc:<spec source folder, repo-relative>/<spec>.md#<verbatim section heading>   # Markdown node
covers: ["ORD-1..ORD-27", "BR-OR01..BR-OR05"]   # SpecID ranges this file owns, one per family
depends_on: [<other module slugs>]              # only on 00-index, from the relations section
updated: YYYY-MM-DD
---
```

Rules that are easy to get wrong:

- **`part_of` is declared by the child, never by the parent.** `00-index.md` must not list its children
  — that list is generated. Declaring both directions guarantees they drift apart.
- **`covers` uses range notation** `<PREFIX>-<first>..<PREFIX>-<last>`. Never list hundreds of ids,
  never span two prefixes in one range — a set mixing generated and source ids lists one range per
  family. A family the source numbers with a gap (`BR-OR04` missing) still covers as a range; the gap
  is reported in the file's anomalies, not carved out of the range.
- **`derives_from` points into `<spec source>`**, written as a repository-relative path (the knowledge
  file shows the exact form) — never at a hand-exported or retired copy. A CSV sheet is a
  `sheet:<path>` node; a Markdown spec is a `doc:<path>#<section>` node, where `<section>` is the
  heading **verbatim** (markdown emphasis included) so the anchor can be found again by search. One
  node per source; a file extracted from one screen section names that section, not the whole document.
  A capability-area file lists one `doc:` node per contributing section — across several documents
  when the area spans them.
- **Do not invent a line range.** `#R<first>-R<last>` (logical CSV rows) may be appended *only* when the
  source records it. Physical lines ≠ CSV rows — cells with embedded newlines make a sheet span far more
  lines than records. For a Markdown source the profiler prints **real physical lines**, so
  `#L<first>-L<last>` may be appended to a `doc:` node — taken from the profiler, never counted by eye,
  and never in place of the section heading, which survives the document being edited.
- **`related` is not `derives_from`.** If a link is "I copied the structure but not the content", it is
  `related`. Getting this backwards inverts the meaning of the edge.
- **`tc_prefix`** comes from `module.tcPrefix`. If the module has none, ask the user and report the
  missing config entry.

The closed relation set is `derives_from · covers · depends_on · supersedes · related · part_of ·
reviews` — seven, no more. Adding an eighth needs its own decision with evidence.

## Step 4 — Write `00-index.md`

Required sections, in this order (English role names; use the localized headings from the knowledge
file when the locale is not `en`):

1. **Title** — `# Field-level specification — <feature name> (<feature code>)`.
2. **Overview** — the exact source path(s); the sheet name as it appears in the workbook, or the
   verbatim section heading(s) of the Markdown spec and its version/date line; the verbatim column
   list (per table shape for a Markdown source); total item count; the SpecID scheme — which ids come
   from the source and which were generated, and why; the untranslated-source-language note; and the
   "anomalies preserved, not corrected" note. For a Markdown source, also state which blocks were
   read as **screen metadata** rather than item rows, and how much content carries no item row.
3. **Capability-area map** (file ↔ feature code ↔ source) — one row per **source section**, grouped
   by file: file, capability area, feature code, source sheet **or document + verbatim section
   heading (profiler line)**, block, SpecID range, item count, `EP` checks, with a subtotal per file
   and a totals row. Every section of every in-scope source appears exactly once, so a reader can
   verify from this table alone that nothing was dropped and that no file follows a source
   document's outline. **Mandatory even when the set has a single feature code** —
   this table is the only authoritative declaration of which feature codes the set owns. Prose
   elsewhere in the file will mention *other* modules' feature codes when describing dependencies, so a
   reader (or a script) that scans the whole file instead of this table gets a wrong answer: one module
   reads as 9 feature codes when it owns 1. The codes here must agree with `module.featureCodes`;
   report any difference to the user.
4. **ID conventions** — a short block declaring, explicitly:
   - every **SpecID prefix** the set owns (a set may own several — one per screen), marking each as
     **taken from the source** (`BR-OR*`, `ACT-OR*`, `EC-OR*`) or **generated here** (`ORDF-*`), with
     the count behind each and any gap the source's own numbering has;
   - the **TC prefix** downstream testcases will use (`module.tcPrefix`).

   > The TC prefix is **not derivable** from the SpecID prefixes and must be stated here, not left to
   > be discovered once step files appear. A module can own six per-screen SpecID prefixes while its
   > testcases all use one TC prefix, and none of the SpecID prefixes need match it (e.g. `checkout`
   > owns `CART`/`PAY`, but its testcases are `TC-CHK-*`).

   - any auxiliary namespace in use (`BL-`, `OPEN-`, `EP-`) with its meaning.
5. **Screen structure** — one row per sub-group (for a Markdown source: one row per section under
   the screen — field table, business rules, actions, edge cases, acceptance criteria), grouped under
   the capability area / file that owns it, verbatim heading text, SpecID range, item count, totals
   row.
6. **API vs UI test classification** — the summary tables from step 6 (by feature code and by
   sub-group), plus the evidence-coverage figures and any hard constraint they impose.
7. **Relations to other documents** — links up to the domain summary file and `../index.md`, sideways to
   related sets (especially any sharing contaminated blocks), and out to referenced-but-out-of-scope
   features.

   Write it as a **three-column table**, with the relation stated, not implied:

   ```markdown
   | Document | Relation | Role |
   |---|---|---|
   | [../sales.md](../sales.md) | `related` | Module-level summary of the same feature |
   | [../price-lists/00-index.md](…) | `depends_on` | Price-list unit prices that `ORD-40`…`ORD-45` reference |
   | [../warehouse/00-index.md](../warehouse/00-index.md) | `—` | Background only, **not** a basis for rules |
   ```

   `Relation` is one of the seven relations or `—`, and must agree with the frontmatter above.
   **`—` means deliberately no edge** — rows that state the *negation* of a relation stay `—`. Never
   promote one to `related` for tidiness: the edge would contradict the sentence beside it.
8. **Open points to confirm (roll-up)** — every `[BLOCKING - needs confirmation]` item rolled up from the
   per-area files.
9. **Extraction decisions** — the split, the SpecID scheme, exclusions, merges, and — for a
   capability-area map — why each section that could have gone to two areas landed where it did.
   Anything a reviewer might otherwise read as an error.

## Step 5 — Write the per-area files (one per screen or capability area)

Each file opens with a breadcrumb (`> Part of [<module>](00-index.md).`) and a source line naming the
source file, the block, the verbatim sub-group name (for a Markdown spec: the verbatim section
heading and its line range from the profiler), the item count and SpecID range. A capability-area
file that draws from several sections replaces the single source line with a **source table** — one
row per contributing section: document, verbatim heading, profiler lines, items, SpecID range — in
the order the sections appear in the file. Its title is the capability-area name, and the line under
the title says that the name is scaffolding; every heading below it is verbatim from the source.

Then, explicitly:

- **Label rule** — label column preferred, fall back to the field column, else
  `(no label in source)`; state the per-file split ("10/11 taken from the label column; ORD-28 taken
  from the field column"). For a Markdown source the label is the first cell that is neither the
  row's ordinal nor its id — say which column that turned out to be, per table.
- **Empty-column note** — restate which columns are empty sheet-wide (for a Markdown source: per table
  shape), and that no API/DB name appears anywhere in the file.
- **Id note** (Markdown) — which SpecIDs are the source's own and which were generated here.

Body:

- **Field list (summary)** — one bullet per item: `SPECID — Label`.
- **Field details** — one bullet per item carrying the source cells verbatim: required / not required,
  round, default, business meaning, validation, boundary, error, hardening status, bug, note. Omit an
  absent cell rather than writing "N/A"; for a near-empty item, list what is missing in parentheses.
  For a Markdown source the cells are that item's own table columns, named verbatim — a business-rule
  row carries rule text and condition/result, an action row carries position, condition, result and
  navigation. Do not coerce them into the CSV column roles.
- **Screen context** (Markdown) — the screen's attribute table (priority, role, URL, screen id) and the
  content that carries no item row: overview, layout bullets, Gherkin scenarios, each verbatim, under
  its own verbatim heading. These are evidence, but they own no SpecID; where one is the only basis
  for a testcase, declare it as `EP-<n>` here and repeat it in `00-index.md`.
- **Needs confirmation / Unclear** — per-file anomalies. Prefix the ones that block testcase writing
  with `[BLOCKING - needs confirmation]`. Gaps and duplicates in the source's own id families belong
  here.

**Every item row appears in exactly one file, and every SpecID in the range is accounted for.** Counts
in the file must match `00-index.md` and the profiler.

## Step 6 — Write the classification file (`NN-api-ui-classification.md`)

Classifies every item into **API / UI / Insufficient data** — the input to `create-testcase-inventory`.

Evidence rule: classify **only** from the business-meaning and validation text already written into
the per-area files. Do not re-read the source, do not use boundary, default, required, readonly,
round, hardening status or note as classification evidence, and do not modify any per-area file.

For a Markdown source the evidence columns differ per item kind, and this is the mapping — nothing
else in the file is evidence:

| Item kind | Evidence for classification |
|---|---|
| Field-table row | the description / business-meaning column and any validation column |
| Business-rule row | the rule text and its condition/result column |
| Action row | the condition and result columns (not the position or the navigation target) |
| Edge-case bullet | the bullet text |

A screen's Gherkin scenarios and overview prose are **not** per-item evidence — they classify no
SpecID. Where they are the only basis for a check, they belong to an `EP-<n>` entry, which the
classification file lists separately from the SpecID table.

| Bucket | Definition |
|---|---|
| **API** | Has a rule checkable at the data/business layer: required/constraint, uniqueness, formula or conversion factor, cross-field or cross-screen dependency, source-list filtering rule, grouping rule, scope of applicability. |
| **UI** | Pure display/interaction: row checkbox, expand/collapse, disabled control, sort, paging, display format — with no checkable data rule attached. |
| **Insufficient data** | Business meaning empty / merely repeats the label / is an internal note, **and** validation is empty or too thin to build an assertion without guessing. |

Structure: classification principles and the source constraints → summary table by feature code →
summary table by capability area (file) and by sub-group → the full per-item table (`SpecID | Field | Group | Reason`) →, when the
source is Markdown, the `EP-<n>` list for checks that rest on scenario or prose content alone.

The `Reason` column is a classification clause **plus a verbatim quote** from that item's business
meaning / validation (elide with `…`). No quote means no classification — it belongs in
`Insufficient data`.

The presence of a field value never by itself makes an item API. A high `Insufficient data` share is a
legitimate result — report it and say which groups it concentrates in.

## Step 7 — Wire the set into the existing docs

1. `<paths.featureDocs>/index.md` — add a bullet to the companion field-level specs list: feature code,
   source sheet or document + section, output files, item count, SpecID range, and the notable
   constraint (empty API field, contamination, low evidence, ids taken from the source).
2. The domain summary file — link the feature row to the new `00-index.md`.
3. Cross-link any sibling set that shares a contaminated block, in both directions.
4. **Module registry** — the module must be declared in `modules[]` of `qakit.config.yaml` with `id`
   (and `docSlug` if the folder differs), `featureCodes`, `tcPrefix`, and `stepDir` / `suite` when
   known. Do not edit the config silently: if the entry is missing or disagrees with the set, propose
   the exact entry to the user. Also update any project ID-mapping document the knowledge file names
   (module slug, feature code(s), SpecID prefix(es), TC prefix, step directory, automation suite — `—`
   when none yet). The registry is the join key for the whole documentation graph; a set that is not
   registered is invisible to every downstream tool.

## Self-check before reporting done

- [ ] Profiler re-run on the final source (same `--section` and `--start` per section for a Markdown
      spec); every count/range/percentage in the docs matches it.
- [ ] Files cut by capability area: no file named after or cut from a source document, no SpecID
      prefix per source document; every section of every in-scope source sits in exactly one row of
      the capability-area map in `00-index.md`.
- [ ] Generated SpecIDs continuous, no gaps, no duplicates, each appearing in exactly one per-area
      file; ids taken from the source reproduced verbatim, their own gaps and duplicates reported
      rather than fixed.
- [ ] Counts agree across `00-index.md`, per-area files, and the classification file.
- [ ] No endpoint, actionId, API field, or DB column named unless the source column had one.
- [ ] Group/heading names verbatim; source typos and contradictions preserved and flagged.
- [ ] Every anomaly the profiler surfaced (empty columns, duplicated blocks, low coverage, id gaps) is
      addressed in `Needs confirmation / Unclear` or the extraction decisions section.
- [ ] Markdown sources only: every block the profiler listed is accounted for — item tables extracted,
      attribute tables used as screen metadata, narrative and Gherkin content carried into the screen
      file or declared as `EP-<n>`; nothing silently dropped.
- [ ] All business content in the source language and untranslated.
- [ ] `<paths.featureDocs>/index.md` and the domain summary file updated; relative links resolve.
- [ ] Every file has frontmatter; `id` matches its path; `part_of` declared by children only.
- [ ] `tc_prefix` and every `spec_prefix` declared in `00-index.md` ID conventions.
- [ ] `derives_from` points into `<spec source>` (`sheet:` for CSV, `doc:<path>#<verbatim section>` for
      Markdown); no line range invented — a `#L` range, where used, comes from the profiler.
- [ ] Module present in `modules[]` (or the missing entry proposed to the user) and in any ID-mapping
      document the knowledge file names.
- [ ] Localized heading, file and bucket names from the knowledge file used exactly (when locale ≠ `en`).
- [ ] `status` flipped `draft` → `stable` now that this checklist passes.
- [ ] No file above ~8 000 words unless `00-index.md` states why it cannot be split.

Report to the user: item count (and, for a Markdown source, how many ids came from the source versus
how many you generated), file list, API / UI / Insufficient-data split, and the blocking questions for
the BA. Blocking items are the deliverable's most useful output — lead with them.
