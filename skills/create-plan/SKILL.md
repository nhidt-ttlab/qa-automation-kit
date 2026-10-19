---
name: create-plan
description: Writes an implementation plan for a product task (feature, bug fix, refactor) into the project's plans folder, and every plan MUST include an automated acceptance tests section that plans the kit's test-step docs and `*.scenario.ts` scripts for the change, and a logging and diagnostics section that plans the log points the implementation adds. Trigger whenever the user asks to "create a plan", "write a plan", "plan this task/feature/fix", "make an implementation plan", or enters plan mode for work on the product the project's `qakit.config.yaml` tests.
---

## Project settings

This skill is part of the QA automation kit and works on any project that has a `qakit.config.yaml`.
Before starting:

1. Locate the project's `qakit.config.yaml` — the path named in the "QA automation kit" section of the
   project's `CLAUDE.md`, otherwise the repository root. Paths inside it are relative to its folder.
2. Read the settings this skill uses: `modules` (`id`, `tcPrefix`, `suite`, `description`), `paths`,
   `ids`, `safety` (`allowWritesEnv`, `testDataMarker`) and `apiSources` / `web` (which repository or
   app each surface belongs to).
3. Read the project knowledge for this skill, if present: `<paths.knowledge>/<skill-name>.md` and
   `<paths.knowledge>/project.md`. Knowledge files carry project facts — the plans folder, the
   change-to-module map, unit-test frameworks, code-analysis tools the plan must cite, run commands,
   style-reference scenarios, known pitfalls — and win over this skill's generic examples. They do not
   relax this skill's process rules or quality gates.
4. Write the plan in the language the project's existing plans use; test-step docs follow `locale`.

Notation used below:

- `<module>` — one entry of `modules` in the config; `<PREFIX>` — its `tcPrefix`.
- `<module dir>` — `module.stepDir ?? module.docSlug ?? module.id`.
- `<suite>` — `module.suite`.
- `<lane>` — `api` or `ui`. Test-case ids carry the lane letter: `A` for api, `U` for ui.
- `<plans>` — the plans folder the knowledge file names; `plans/` at the repository root when it names
  none.

## When This Skill Applies

- The user asks for a plan for a task: "create a plan for X", "plan the fix for Y", "write an
  implementation plan", "break this down into a plan".
- A plan is being drafted in plan mode for a change to the product under test.

The deliverable is a plan document, not code. Do not implement anything while planning.

---

## Hard Rule: Every Plan Plans Its Acceptance-Test Scripts

A plan is **not complete** unless it has an `Automated acceptance tests` section (see the template
below) that names, for each user-visible behavior the change adds or fixes:

1. the **module** and **lane** (`api` or `ui`),
2. a new **test-case id** (or the existing one being updated),
3. the **step-doc path** and the **scenario-script path**,
4. fixtures, cleanup and the writes gate (`safety.allowWritesEnv`),
5. the exact **run command**,

and the implementation task list must contain the tasks that **create** those files. The repositories'
own unit and integration tests are still planned as usual — scenario scripts come in addition, not
instead.

The only way out is an explicit, justified exemption written in that section (for example: pure
internal refactor with no observable behavior change, docs-only change, build/CI-only change).
"Hard to automate" is not an exemption — say what blocks it and plan the smallest scenario that still
covers the behavior, or record it as an open question.

---

## Step-by-Step Process

1. **Understand the task.** Read the request and the linked sources: specs, feature docs under
   `<paths.featureDocs>`, hand-offs, earlier plans in `<plans>`. Trace the code involved with the tools
   the project's `CLAUDE.md` requires (call graph, impact analysis) and record callers and risk level in
   the plan.
2. **Read the test setup** before writing the test section:
   - `qakit.config.yaml` — `modules`, `paths`, `ids`, `safety`.
   - `<paths.knowledge>/project.md` — vocabulary, environments, test-data rules, style-reference
     scenarios, known pitfalls.
   - Existing step docs `<paths.steps>/<lane>/<module dir>/<test-case id>-*.md` and scenarios
     `<paths.suites>/<suite>/**/*.scenario.ts` for the area — reuse or extend them before adding new
     ones.
3. **Map the change to modules.** Use the knowledge file's change-to-module map when it has one;
   otherwise build it from each module's `description` and the repository behind its `apiSources` /
   `web` entry. Write the map into the plan as a table:

   | Change touches | Module | Lane | Id pattern |
   |---|---|---|---|
   | backend rules and endpoints for orders | `orders` | api | `TC-ORD-A<nn>` |
   | the orders screens and flows | `orders` | ui | `TC-ORD-U<nn>` |

   A cross-repo change usually needs one scenario per surface (e.g. the backend rule in an api-lane
   module plus the screen flow in a ui-lane module).
4. **Allocate test-case ids.** List `<paths.steps>/**/TC-<PREFIX>-*.md` and take the next free number
   per prefix and lane. Ids must match `ids.testCase`. Don't renumber or reuse existing ones; check the
   knowledge file and open plans for ids already reserved.
5. **Design each test case**: preconditions, steps, assertions (`A1`, `A2`, …), negative/permission
   cases, test data named `<safety.testDataMarker>-<label>-<run>` with cleanup in `finally`, and whether
   it needs `<safety.allowWritesEnv>=1`. Scenarios create their own fixtures and never touch other data.
6. **Write the plan** to `<plans>/YYYY-MM-DD-<kebab-slug>-plan.md` (today's date), unless the knowledge
   file sets another naming rule. For a large cross-repo change, follow the project's convention for
   an umbrella plan plus per-surface plans (for example `-api-plan.md`, `-web-plan.md`); each
   per-surface plan carries its own acceptance-test section for its modules.
7. **Self-check** against the checklist at the bottom before presenting the plan.

---

## Plan Template

Match the section style of recent plans in `<plans>`. Required sections:

```markdown
# Plan: <title>

## 1. Goal
## 2. Context / root cause            (evidence, file:line references, impact analysis + risk)
## 3. Decisions to lock in before coding
## 4..n. Part A/B/C — <repo>: <change>   (one part per repo/surface)
## Logging and diagnostics            (log points per part — see below)
## Sequencing
## Testing
### Unit / integration tests          (the repositories' own test projects)
### Automated acceptance tests
## Risk / rollout
## Open questions
```

### The acceptance-test section

```markdown
### Automated acceptance tests

| Test case | Module / lane | Behavior covered | Step doc | Scenario script | Writes |
|---|---|---|---|---|---|
| TC-ORD-A07 | orders / api | <rule, incl. negative case> | `<paths.steps>/api/orders/TC-ORD-A07-<slug>.md` | `<paths.suites>/orders/api/<slug>.scenario.ts` | yes |
| TC-ORD-U03 | orders / ui | <flow> | `<paths.steps>/ui/orders/TC-ORD-U03-<slug>.md` | `<paths.suites>/orders/ui/<slug>.scenario.ts` | yes |

For each test case:
- **Preconditions / fixtures:** <account, tenant, data created by the scenario>
- **Assertions:** A1 …, A2 … (including the negative/permission case)
- **Cleanup:** <what is removed in finally>
- **Updated existing scenarios:** <scenarios whose expectations change, or "none">

**Run:** from the folder holding `qakit.config.yaml`
- `<allowWritesEnv>=1 npx qakit suite --config qakit.config.yaml --testcase TC-ORD-A07,TC-ORD-U03`
  (or the project's own script, as the knowledge file names it)
- regression: the suite for every module touched
- typecheck of the scenario harness

**Exemption (only if applicable):** <why no scenario script, and what covers the behavior instead>
```

Write the paths with the project's real values, not the `<paths.*>` placeholders.

### The logging section

Every plan that adds or changes runtime behavior plans its diagnostic logging, so the change can be
debugged from its logs when a scenario or a user hits a failure. Follow the `add-debug-logging` skill
(installed name per `extensions.skillNames`) and its knowledge file `<paths.knowledge>/add-debug-logging.md`
for the loggers and conventions of each repository. The section lists, per part:

- the log points — where (repo · file/class), event (message or event key), level, fields, and which
  failure each one explains — covering the new decision branches, state changes, external calls,
  handled errors and batch summaries of the change; not a line per function;
- how the flow's correlation id reaches those lines;
- what is deliberately not logged (secrets, personal data, routine per-item success);
- how to see the lines locally (file/console/sink, how to raise the level).

A docs-only, build/CI-only or behavior-free change writes `Logging: none — <reason>` instead.

### Tasks the plan must include

In the implementation task list / sequencing, add explicit tasks — they are part of the work, not a
follow-up:

1. **Write step docs** — `create-testcase-steps` (api lane) / `create-testcase-steps-ui` (ui lane) for
   each new test case.
2. **Write scenario scripts** — `create-scenario-script` from those step docs, following the style
   references in `<paths.knowledge>/project.md`.
3. **Run and go green** — the run commands above against a local stack with the change applied; attach
   the report/evidence path in the hand-off.

Each implementation task (Part A/B/C) also names the log points from the logging section it adds —
logging ships in the same task and commit as the code, following `add-debug-logging`, never as a
separate clean-up task at the end.

Use the installed names of these skills when `extensions.skillNames` renames them. Place the step-doc
task early (right after decisions are locked — it pins the expected behavior) and the scenario-run task
after the implementation parts it verifies. The plan's definition of done includes: new scenarios pass,
touched modules' existing suites still pass.

---

## Self-Check Before Presenting

- [ ] The `Automated acceptance tests` section exists and is filled in (or has a justified exemption).
- [ ] Every user-visible behavior / bug fix in the plan maps to at least one test case row.
- [ ] Ids are the next free ones per prefix and lane, and match `ids.testCase`.
- [ ] Paths follow `<paths.steps>/<lane>/<module dir>/` and `<paths.suites>/<suite>/…/*.scenario.ts`.
- [ ] Write scenarios note `<safety.allowWritesEnv>=1`, `<safety.testDataMarker>` data and cleanup.
- [ ] Task list includes step docs → scenario scripts → run green.
- [ ] The `Logging and diagnostics` section lists the log points per part in the project's logging
      conventions (or `Logging: none — <reason>`), and each implementation task names the ones it adds.
- [ ] Nothing project-specific is planned for the QA automation kit itself — project facts go in the
      project's config, adapter or knowledge folder.

When presenting the plan, summarize the planned test cases (id + one-line behavior) in the reply so the
user sees the test coverage without opening the file.
