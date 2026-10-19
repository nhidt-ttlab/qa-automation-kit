---
name: investigate
description: Diagnoses a bug, error, failing test or scenario run, or unexpected behavior and reports the root cause plus a proposed solution, without editing any code. Trigger whenever the user says "investigate" (e.g. "investigate this bug", "investigate why TC-ORD-U07 fails") or otherwise asks for a diagnosis/analysis rather than a fix. Read-only — use this instead of jumping straight to an Edit/Write when the user wants an explanation first.
---

## Project settings

This skill is part of the QA automation kit and works on any project, with or without a running test
harness. Before starting:

1. Locate the project's `qakit.config.yaml` — the path named in the "QA automation kit" section of the
   project's `CLAUDE.md`, otherwise the repository root — and read `paths.knowledge`, `paths.steps`
   and `paths.suites`. No config: go on with step 3.
2. Read `<paths.knowledge>/investigate.md` and `<paths.knowledge>/project.md` if present. The knowledge
   file can name: where each service writes its logs and how to raise the level, how to reproduce
   locally, the code graph tool the project uses, and known environment failures or flaky tests to
   rule out first. **Its facts win over the generic guidance below.** It does not relax the hard rule.
3. Read the project's `CLAUDE.md` for a code graph or code intelligence tool (see below) and for
   anything it says about running tests.

## When This Skill Applies

- The user's prompt is or contains the word "investigate" (e.g. "investigate this error",
  "can you investigate why the upload hangs", "investigate the failed UI run").
- The user asks "why does X happen", "what's causing X", "find the root cause of X", "why is this
  test red", or similar diagnostic phrasing, without asking for a fix to be applied.

This skill governs *how you respond*, not just what you look at: the deliverable is a diagnosis,
not a diff. If the user later says "ok fix it", that is a separate, explicit follow-up request —
do not treat "investigate" as implicit permission to also change code, step docs or scripts.

---

## Hard Rule: Do Not Touch The Code

- Do not use `Edit`, `Write`, or `NotebookEdit` during an investigation — not on product code, not
  on step documents, not on `*.scenario.ts` scripts, not on config.
- Do not run commands that mutate the working tree (formatters, codegen, migrations, `git
  checkout`/`reset`, package installs, etc.).
- Read-only exploration is fine and encouraged: `Read`, `Grep`, `Glob`, the project's code graph
  tools, `Bash`/`PowerShell` for read-only inspection (`git log`, `git blame`, `git diff`, reading
  logs), and the `Explore` agent.
- Running the app, an existing test suite or a single scenario to *observe* a failure is allowed
  (it's how you confirm the root cause), as long as it doesn't leave the tree in a different state
  than you found it. Run it the way the suite normally runs — do not change env flags, write
  switches, test data or config to make it behave differently. Run reports, evidence and run-store
  rows the harness writes are fine; they are outputs, not source.
- Refreshing a code graph index is allowed when it only rewrites a git-ignored index folder, never
  tracked files.
- If, mid-investigation, you're tempted to "just fix this one line to check" — don't. State the
  hypothesis and how you'd verify it instead.

---

## Code Graph Tools: Use One Before Grepping By Hand

If the project has a code graph (its `CLAUDE.md` or knowledge file says so, or an index folder such
as `.gitnexus/` or `.codegraph/` sits at the repository root and its MCP tools are available), use
it first — it surfaces call paths and blast radius in one call instead of a chain of greps:

| Need | Typical tool |
| --- | --- |
| Find code related to the symptom / error text | a concept or semantic query with the error or symptom |
| Callers, callees and execution flows of a suspect symbol | a symbol context lookup |
| "How does A reach B?" | a call-chain trace |
| Recent regression: which flows do the current changes touch | a change-detection call |
| Blast radius of the suspect (for the report) | an upstream impact call |

Follow the project's own instructions for these tools (and any skill it ships for debugging with
them). If a tool reports a stale index, refresh it when that is allowed (above) and retry. With no
code graph, fall back to `Grep`/`Glob`/`Read` and the `Explore` agent, and say in the report that
blast radius was estimated by text search.

Whichever you use, confirm its answer by reading the actual source lines before naming them as the
root cause — the graph points you at the suspects, the code is the evidence.

---

## When The Symptom Is A Failed Test Run

A red scenario or suite run has more causes than a product bug. Start from what the run left behind:

1. **The run's own output** — the Markdown report (`reports/`), the JSON artifact (`outputs/`) and the
   evidence (`evidence/`: screenshots, page captures, request/response excerpts) next to the
   project's config. Find the first failing assertion id and what it actually observed.
2. **The step document** for the test case (`<paths.steps>/…/<TC-ID>-*.md`) — what the assertion was
   supposed to check and which SpecID it answers.
3. **The script** (`<paths.suites>/…/*.scenario.ts`) — whether it does what the step doc says.
4. **Re-run just that case** to see whether it reproduces:
   `npx qakit suite --config <qakit.config.yaml> --testcase <TC-ID>` (or the project's own command
   from its knowledge file). Run it twice before calling anything flaky.

Then classify the failure — the class decides where the fix belongs:

| Class | Signs | Fix belongs in |
| --- | --- | --- |
| Product bug | The app's behavior contradicts the spec the step doc cites | Product code |
| Spec change | The app follows a newer spec; the step doc asserts the old rule | Spec docs → step doc → script, top-down |
| Script drift | The step doc is right; the script asserts something else, or a selector/route moved | The script |
| Test data / state | Depends on records a previous run left, missing seed data, wrong account or role | Test data setup or the scenario's own arrange step |
| Environment | Service down, stale build served, wrong URL, certificate, clock, missing env variable | The environment — nothing in the repo |
| Flaky | Passes and fails on identical input; timing, ordering or a race | The wait/ordering in the script, or the product race it exposes |

Never propose "make the script green" as the fix for a product bug or a spec change — say which
class it is and where the change belongs.

---

## Step-by-Step Process

1. **Reproduce or locate the symptom.** Read the error message, stack trace, failing test, run report
   or described behavior closely enough to know exactly what "wrong" looks like.
2. **Rule out the known noise** the knowledge file lists (environment failures, flaky tests) before
   going deep.
3. **Query the code graph** (see above) with the symptom, then look at the suspect symbols. Do this
   before grepping by hand.
4. **Trace backwards from the symptom to the cause**, not forwards from a guess. Follow the actual
   call path / data flow (graph traces, `Grep`, `Read`, logs, `git blame` / `git log -p` on the
   suspect file) until you can point at the specific line(s) and mechanism responsible. For a
   suspected regression, the change-detection tool or `git log -p` shows which recent edits touch
   that path.
5. **Rule out alternative explanations.** If more than one plausible cause exists, say so and
   explain why you favor one over the others (or state that both need confirming).
6. **Form the fix at a conceptual level** — what would change and why it addresses the mechanism
   found in step 4 — without writing or applying it.
7. **Measure the blast radius** of the code you would change: the graph's upstream impact (direct
   callers will break, the next ring is likely affected), or grep for references when there is no
   graph. For a test-side fix, name the other test cases that share the script helper or step.
8. **Report using the template below.** Do not append a diff, patch, or code block meant to be
   applied; illustrative snippets that quote existing code to point at the bug are fine.

---

## Response Template

```markdown
## Root cause

<The specific mechanism, named precisely: file:line, function/method, the exact condition that
goes wrong. Not "there's a bug in the sync logic" — the actual line and why it's wrong. For a
failed test run, start with the class (product bug, spec change, script drift, test data,
environment, flaky).>

## Evidence

<How you know: the trace/log/test output you saw, the run report and the assertion that failed,
the code path you followed (e.g. the graph's trace or context chain), or the git history that
confirms it (e.g. "introduced in <commit>", "reproduced by running <command>").>

## Proposed solution

<What should change, described precisely enough to implement (file/function, the corrected
logic), plus any tradeoffs or alternative approaches worth weighing. Not applied — this is a
recommendation.>

## Risk / blast radius

<What else touches this code path and could be affected by the fix, so the eventual change can be
scoped correctly. Name the direct callers explicitly and say which tool produced the list.>
```

---

## Checklist

- [ ] No `Edit`, `Write`, or `NotebookEdit` calls were made
- [ ] No mutating shell commands were run (git history/diff/log reads, re-running a test as the
      suite normally runs it, and refreshing a git-ignored code graph index are fine)
- [ ] The project's knowledge file was read, and its known noise ruled out
- [ ] The code graph was queried before manual grepping, or the report says none was available
- [ ] Root cause names a specific file/line/function, not a vague area
- [ ] A failed test run is classified, and the fix is placed where that class says
- [ ] Evidence traces back to something actually observed (trace, log, test, report, git history) —
      not speculation stated as fact
- [ ] Proposed solution is described, not implemented
- [ ] Blast radius lists direct dependents and names the tool that produced them
- [ ] Response ends with the diagnosis — it does not ask "want me to fix it?" as a stall; it's
      fine to mention the fix is ready to apply on request, but the investigation itself is complete
