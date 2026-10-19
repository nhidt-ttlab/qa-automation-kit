# Template: `CRUD-MAP.md`

Output of the CRUD/validation discovery pass: the map step (list every form screen from the feature docs)
plus the live-probe step (observe the real controls). One file per module, at
`<paths.steps>/ui/<module dir>/CRUD-MAP.md`, where `<module dir>` is
`<module.stepDir ?? module.docSlug ?? module.id>`. The project's roadmap for this pass, if any, is linked
from `<paths.knowledge>/doc-templates.md`.

**This is not a step matrix yet.** It is the map of *what there is to test* + *where to aim*, so the
pass that writes step files does not have to reopen twenty source files. No assertions, no steps, no
testcase IDs here.

**Hard rule**: every selector and every required flag must be **observed** — from a probe of the live
screen or from the web app's source — or be marked `[to be confirmed]`. A selector invented from naming
conventions looks right in review and breaks at run time.

---

## 1. Scope

| | |
|---|---|
| Module | `<module id>` |
| Source documents | `<paths.featureDocs>/<module.docSlug ?? module.id>/` |
| FeatureID | `modules[].featureCodes` |
| API host | the `apiSources` key the screens call |
| Screens with a form | |
| Probe run on | |
| Fixture used to probe | e.g. `storeId=…` (`--store-keyword …`) |

## 2. Screens with CRUD

One row per screen. `Path` is an app-relative path **observed** to open the right screen — not inferred
from the route table.

| # | Screen | Path | Rendering component | Create | Edit | Delete | Import | Spec source |
|---|---|---|---|---|---|---|---|---|
| 1 | | `/…` | `<Component>` | `/…/new` | `/…/:id` | button/confirmation | `/…/import` | [file#anchor](…) |

**Architecture note** — state whether the screen uses a shared shell or its own component. If it is
shared (one generic create/edit page and form, configured per entity), say so explicitly: this screen's
CRUD cases are **parameterized by entity key**, not rewritten from scratch for each catalogue.

## 3. Fields of each form

One table per form. The `Required (app)` column comes from the form library's required marker **as read
by the probe**; the `Required (spec)` column comes from the source document. **The two columns disagreeing
is a finding, not a typo** — record it in §6.

### 3.x `<form name>` — `<path>`

| Visible label | Control `id` | Type | Required (app) | Required (spec) | SpecID | Validation rule the source states |
|---|---|---|---|---|---|---|
| | `field-id` | select/number/text/datepicker/checkbox | ✅/— | ✅/— | `XX-nn` | |

**Action buttons** (copy `id`/`data-testid` verbatim from the probe):

| Button | `id` | `data-testid` |
|---|---|---|
| Save | | |
| Cancel | | |
| Back | | |

## 4. Testcase candidates

The case-group matrix applied to each screen: `C-n` for end-to-end CRUD through the form (create, create
with required fields only, edit and reopen, delete with confirmation, leave a half-filled form, navigate
and refresh after save) and `D-n` for form validation (empty required field, cross-field constraint,
format/range, duplicate/unique, control state, server error shown on the form). **No testcase IDs yet** —
the case-selection pass assigns them. The `Runnable now?` column answers: does this case need write
access to be set up first.

| Screen | Group | Case | Runnable now? | Notes / prerequisite data |
|---|---|---|---|---|
| | `D-1` | Leave `<field>` empty ⇒ save is blocked | ✅ read-only | |
| | `C-1` | Create succeeds | ❌ waiting for write access | |

**Cases dropped by the duplicate-coverage gate** — a case is dropped when its assertion can be stated as
a request/response without a browser. Dropping silently loses the trace:

| Intended case | Why dropped |
|---|---|
| | |

## 5. Blockers / missing data

| # | Problem | Affected cases | What is needed to resolve it |
|---|---|---|---|
| | | | |

A blocker that already appears in the module's shared blocker table (the `CHECKLIST.md` next to this
file, or the one named in the knowledge file) is **referenced by its number there** — do not copy its
content.

## 6. Spec vs application mismatches

The most important section of this file. Each row is a question for the BA, or a product defect.

| Mismatch | Spec says | Application does | Proposal |
|---|---|---|---|

## 7. How to reproduce the probe

Run the project's screen-controls probe (command in the knowledge file) with a targets file, or probe
screen by screen with `mcp__<mcp.uiServerName>__ui_open_screen` + `mcp__<mcp.uiServerName>__ui_describe_screen`.

```
<screen-controls probe command> --targets <targets.json> --out <outDir>
```

Attach the exact `targets.json` used, so the next person reruns the same set of screens.
