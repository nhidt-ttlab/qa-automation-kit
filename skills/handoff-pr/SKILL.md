---
name: handoff-pr
description: "Wrap up finished work in any repo of the project: detect the repos and forge, run the project's own checks and the kit's scenario suites, write hand-off notes where the project keeps them, branch off a freshly fetched base, commit, push, and open the pull/merge request(s) (gh / glab / REST API / push options -> returns the new-PR URL). Trigger when the user says \"open a PR\", \"create the pull request\", \"raise an MR\", \"wrap this up\", \"hand this off\" or asks for hand-off notes for finished work. Args: [slug=<kebab-case>] [title=<text>] [type=<feat|fix|refactor|chore|docs|test>] [scope=auto|<repo keys>] [base=<branch>] [base.<repo>=<branch>] [forge=auto|github|gitlab] [draft] [no-handoff]"
---

Wrap a piece of finished work into reviewable pull requests (GitHub) or merge requests (GitLab).
The skill learns the project first, then verifies, writes hand-off notes, branches from a freshly
fetched base, commits, pushes and opens the request.

This skill is **project-agnostic**. Nothing about a repo — its remote, its base branch, its build
commands, its branch prefixes, its hand-off folder — is hardcoded. Every one of those is resolved at
run time in Step 0, and a project's own instructions always win over the defaults here.

Throughout: "PR" means pull request on GitHub and merge request on GitLab. Run every `git` command as
`git -C <repo root> …` rather than `cd`.

**Never leak credentials.** Remote URLs can embed tokens (`https://oauth2:glpat-…@host/…`,
`https://x-access-token:ghp_…@github.com/…`). Never print a raw `git remote get-url` result and never
copy one into a hand-off, commit, PR description or report. Strip the credentials first:

```bash
git -C <repo> remote get-url origin \
  | sed -E 's#^(https?://)[^@/]*@#\1#; s#^git@([^:]+):#https://\1/#; s#\.git$##'
# -> https://<host>/<namespace>/<project>
```

## Project settings

This skill is part of the QA automation kit and works on any project, with or without a running test
harness. Before starting:

1. Locate the project's `qakit.config.yaml` — the path named in the "QA automation kit" section of the
   project's `CLAUDE.md`, otherwise the repository root. Paths inside it are relative to its folder.
   No config: go on with Step 0 and treat every kit-specific rule below as not applying.
2. Read the settings this skill uses: `paths` (`knowledge`, `steps`, `suites`, `reports`, `evidence`),
   `safety` (`allowWritesEnv`, `testDataMarker`), `api.allowWritesEnv`, `modules` (`id`, `tcPrefix`,
   `suite`) and `apiSources` / `web` (which repository each surface belongs to — that maps a changed
   file to the repo whose PR carries it).
3. Read the project knowledge for this skill, if present: `<paths.knowledge>/handoff-pr.md` and
   `<paths.knowledge>/project.md`. The knowledge file carries project facts — the hand-off folder and
   its index, the forge and base branch per repository, branch-prefix and commit conventions, which
   suites are safe to run before a PR, environments that must never be touched, reviewers. **It wins
   over this skill's generic defaults**, but it does not relax the honesty rules: nothing may be
   reported as verified that did not run.
4. Write the hand-off and the PR description in the language the project's existing hand-offs and PRs
   use; if they are mixed, follow the hand-off folder's most recent entries.

Notation used below: `<config>` — the project's `qakit.config.yaml`; `<repo>` — a repository root;
`<key>` — a repo key from Step 0b.

## When This Skill Applies

- Finished work is sitting uncommitted (or on a local branch) and needs to become a reviewable PR.
- The user asks to "open a PR", "raise an MR", "wrap this up", "hand this off" or "ship this".
- A plan's tasks are done and its acceptance-test scenarios pass, and the change is ready for review.

Not for: work still in progress, an exploratory spike the user does not want reviewed, or committing
straight to a base branch — this skill never does that.

## Argument parsing

Split the skill's arguments on spaces, then on the first `=`:

- `slug` — kebab-case identifier for the branch and hand-off filename (e.g. `upload-retry-backoff`).
  Optional; generated at the end of Step 1 when omitted.
- `title` — human-readable title. Default: derive from `slug`, dashes to spaces, sentence-cased.
- `type` — conventional-commit type. Default: infer it (`fix` for bug fixes and restores, `feat` for
  new behaviour, otherwise `refactor`, `chore`, `docs`, `test`). It also picks the branch prefix
  (Step 0e).
- `scope` — comma-separated repo keys, or `auto` (the default) to detect it in Step 1.
- `base` — base branch for **every** repo in scope; `base.<key>=<branch>` overrides one repo.
  Default: each repo's own resolved base (Step 0d).
- `forge` — `auto` (default), `github` or `gitlab`. Only needed for self-hosted hosts the detection
  cannot classify.
- `draft` — open the PR as a draft.
- `no-handoff` — skip the hand-off files; fold their content into the PR description instead.

If `slug` is given but is not kebab-case (lowercase letters, digits, single dashes), stop and output:

```
Error: slug must be kebab-case.
Usage: /handoff-pr [slug=<kebab-case>] [title=<text>] [type=<type>] [scope=auto|<repo keys>] [base=<branch>] [base.<repo>=<branch>] [forge=auto|github|gitlab] [draft] [no-handoff]
```

---

## Step 0 — Learn the project

Do this before anything else, and report what you found. Never carry assumptions in from another
project or from an earlier session.

**0a. Project instructions.** Read whichever exist: `CLAUDE.md` (including nested ones in directories
you will touch), `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `.claude/skills/*/SKILL.md`,
`.github/PULL_REQUEST_TEMPLATE.md` (or the `.github/PULL_REQUEST_TEMPLATE/` directory),
`.gitlab/merge_request_templates/`, plus the config and knowledge files named in **Project settings**.
They set the rules for commits, verification, code-intelligence gates, hand-off format and what must
never be committed. **Where a project instruction and this skill disagree, the project instruction
wins** — say so in the Step 9 report.

**0b. Repos.** Detect whether this is one repo or a superproject with submodules:

```bash
git rev-parse --show-toplevel
git submodule status --recursive      # empty output means a single repo
```

Build a repo table: key (`root` for the top level, the directory basename for each submodule), path,
and what it holds. A nested repo that is **not** a registered submodule (its own `.git`, ignored by
the parent) is its own repo with no pointer bump — note that, because Step 6's ordering rule does not
apply to it. Where the config's `apiSources[].repository` or `web` names a repository, use it to tell
which repo a changed surface belongs to.

**0c. Forge and project path**, per repo, from the stripped remote URL above. `github.com` or a
`github.*` host means GitHub; a `gitlab.*` host, or one answering `/api/v4/version`, means GitLab. If
the host is self-hosted and unclear, ask the user (or take `forge=`). Different repos may live on
different forges; handle each with its own tier ladder in Step 8.

**0d. Base branch**, per repo:

```bash
git -C <repo> rev-parse --abbrev-ref --symbolic-full-name @{u}   # e.g. origin/develop -> develop
git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD      # fallback: the remote's default
```

If the resolved base looks like a feature branch (a `feature/*`, `fix*/*` or `release/*` name, or the
branch this work already sits on), or the repo is on a detached HEAD, **ask the user** which base to
target. Do not guess. Record each base.

**0e. Branch prefix convention.** Read what the project already does rather than imposing a style:

```bash
git -C <repo> branch -r --format='%(refname:short)' | sed 's#^origin/##' | grep / | cut -d/ -f1 | sort | uniq -c | sort -rn
```

Use the dominant prefix for the chosen `type` (`feature/` vs `feat/`, `fixbug/` vs `fix/` vs
`bugfix/`). With no branch-prefix convention in sight, use `<type>/<slug>`.

**0f. Hand-off location.** Look for an existing convention: the folder named in
`<paths.knowledge>/handoff-pr.md`, a `hand-offs/`, `handoffs/`, `docs/hand-offs/` or `docs/handoff/`
directory, a `create-hand-off` skill, or an equivalent named in the project instructions. Note which
repos have their own and which share the root's. If the project has no such convention and the user
did not ask for one, **do not invent a folder**: treat the run as `no-handoff` and put the hand-off
content in the PR description instead. Say which you did.

**0g. Tooling.** Check once, and use the results in Step 8:

```bash
gh --version && gh auth status                          # GitHub tier 1
glab --version && glab auth status --hostname <host>    # GitLab tier 1
```

Note whether `GITHUB_TOKEN` / `GITLAB_TOKEN` is set (tier 2). Never extract a token from a remote URL
or `.git/config`. Never run `gh auth login` or `glab auth login` — they are interactive.

---

## Step 1 — Survey what is actually being shipped, and set the scope

Run in **every** repo:

```bash
git -C <repo> status --short
git -C <repo> diff --stat HEAD
git -C <repo> log --oneline -5
git -C <repo> ls-files --others --exclude-standard
```

Sort every dirty path into **part of this work** or **pre-existing drift you did not create**. Do not
assume everything dirty belongs in the commit. Commonly drift: local environment/config files,
regenerated index or tooling blocks in `CLAUDE.md` / `AGENTS.md` / `.claude/`, lockfile churn you did
not intend, and a superproject `M <submodule>` entry that only reflects someone else's checkout.

**Never stage** `.env*` files, credentials, keys, `node_modules/`, `vendor/`, `target/`, `dist/`,
`build/`, `bin/`, `obj/`, `__pycache__/`, coverage output or `logs/` — unless the repo tracks that
path deliberately (a committed build artifact the build regenerates, a `.env.example`). Check
`git ls-files <path>` before deciding.

A kit project adds its run output to that list: `<paths.reports>`, `<paths.evidence>`, the JSON run
artifacts folder, the run store (`reporting.sqlite` and its journal files) and the downloaded OpenAPI
cache (`api.cacheDir`). A run's report and evidence belong in the hand-off as **numbers and paths**,
never as committed files. Skill copies installed into a project's skills folder (they carry
`.qakit-skill.json`) are generated too: they ride a kit change, not a product change — if they are
dirty here, say so and leave them out unless the work *is* that kit change.

Scan the diff for secrets before going further: tokens, passwords, connection strings, private keys,
real customer data. If any appear, stop and tell the user. Test data is acceptable only where it
carries the project's `safety.testDataMarker`.

Then set the scope. A repo is in scope when it has **source** changes that are part of this work
("source" means anything other than hand-off files and submodule pointers; step docs, suites and
scenario scripts under `<paths.steps>` / `<paths.suites>` are source). Then:

- If any **submodule** is in scope, `root` joins it too, because it carries the pointer bump. When
  `root` has no source change of its own, it is a **pointer-bump-only** PR.
- Honour any project rule about what may live where (for example a shared or generic package that must
  not contain product-specific strings — the kit enforces exactly that with a test). If a diff
  violates one, stop and tell the user.

Confirm the result against `scope=` if one was given. If anything is ambiguous, ask which files belong
in the PR rather than guessing. Stop if there is nothing to ship.

### Generating the slug

Skip if `slug=` was given. Otherwise read the diffs of the files that are part of this work and
generate it:

- kebab-case: lowercase letters, digits, single dashes; 3-6 words, at most 50 characters.
- Lead with the area touched, then what changed (`upload-retry-backoff`, `session-cookie-expiry`).
  Name the change, not the files. For a test-only change, lead with the module id or `tcPrefix` the
  work covers (`orders-ui-suite-u12`).
- Leave out the type (it is already the branch prefix), the date (the hand-off filename carries it)
  and the repo suffix (Step 5 adds it).
- It must not collide with existing work:

  ```bash
  git -C <repo> branch -a --list "*<slug>"
  ls <hand-off dir> | grep -- "<slug>"
  ```

Derive the default `title` from it the same way. Say which slug was generated, and repeat it in Step 9.

---

## Step 2 — Analysis gates the project requires

If the project instructions mandate a pre-edit or pre-commit analysis gate (code-intelligence impact
analysis, graph change detection, an architecture check, a dependency or licence scan), run it exactly
as they specify and record the real output.

- Warn about any **HIGH**/**CRITICAL** finding before continuing, and record it in the hand-off. Never
  waive one with a flag those instructions do not sanction.
- An **UNKNOWN** verdict or an empty caller set is **unresolved, not safe** — it means the analysis
  could not answer. Confirm with a text search and record both results.
- Where a gate structurally cannot see part of the change (for example an index bound to the
  superproject that sees only a pointer for submodule files), say so explicitly in that repo's
  hand-off and name what compensated for it. Do not silently skip it, and never report it as passing.

If the project mandates no such gate, say so in the report and move on. Do not invent one.

---

## Step 3 — Verify

Run the checks the project itself defines. Derive them from the manifests in each repo in scope, and
prefer a script the project already wrote over a command you compose:

| Marker in the repo | Run |
| --- | --- |
| `package.json` | the real script names from `"scripts"` — typically lint, typecheck, test, build. Use the repo's package manager (`packageManager` field, or the lockfile: `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, else npm) |
| `*.sln` / `*.csproj` | `dotnet build <sln>`, `dotnet test <test project>` |
| `Cargo.toml` | `cargo check` (or `cargo build`), `cargo test`, `cargo clippy` |
| `go.mod` | `go build ./...`, `go vet ./...`, `go test ./...` |
| `pyproject.toml` / `requirements.txt` | `ruff` or `flake8`, `mypy`, `pytest` — whichever is configured |
| `pom.xml` / `build.gradle` | `mvn -q verify` / `./gradlew build` |
| `Makefile` / `Justfile` | the project's own `test`, `lint`, `check` targets |
| `.pre-commit-config.yaml` | `pre-commit run --all-files`, or on the changed files |
| `qakit.config.yaml` | the kit checks below |

Prefer scoping to what changed (test paths, changed files for the linter) when the full suite is slow;
run the full build at least once for a repo whose compiled code changed.

### The kit's own checks

When the change touches step docs, suites or scenario scripts — or when a plan named acceptance-test
scenarios for it — those scenarios are the proof the work is done, so run them and quote the real
counts:

```bash
npx qakit doctor --config <config> [--offline]             # config, adapter and spec wiring
npx qakit suite  --config <config> --list                  # the ids this change should have added
npx qakit suite  --config <config> --testcase <id>[,<id>]  # the test cases this change touches
npx qakit suite  --config <config> --module <module id>    # one module (config `modules[].id`)
npx qakit suite  --config <config> --kind api              # every API scenario
```

Every run writes a report, a JSON artifact, evidence and a run-store row — cite their **paths and
numbers** in the hand-off, and keep the files out of the commit (Step 1).

**Do not run anything that hits a live or shared environment, a real account, or production data** —
integration suites, deploy scripts, browser suites against a shared backend, seeding, anything gated
behind `safety.allowWritesEnv` or `api.allowWritesEnv` — unless the user explicitly asks. A scenario
that needs writes stays unrun by default: say so under "Verification NOT done", with the flag it
needs, rather than flipping the gate to make a PR look green. Where the change is UI-only and no
read-only run can cover it, name the run the user should do and on which environment.

Record the actual output. Where a suite has **pre-existing** failures, prove it: stash the change,
re-run, and record both counts. When a repo has no automated check that covers the change (docs only,
config only), say so. **Do not invent a pass.**

If a check fails because of this work, stop and report it. Never write a hand-off that claims green.

---

## Step 4 — Branch off a freshly fetched base

Bases move, so always re-fetch. In **each repo in scope**, including `root` for a pointer bump, use
**the same branch name**:

```bash
git -C <repo> fetch origin <base>
git -C <repo> log --oneline -1 origin/<base>
git -C <repo> checkout -b <prefix>/<slug> origin/<base>
```

Uncommitted changes carry over into the new branch. If the checkout fails on conflicts, stop and
report — do not force it and do not stash-and-drop.

If a repo already sits on a suitable non-base branch holding **unpushed local commits** that belong to
this work, keep that branch (or branch from that HEAD) instead of moving the commits, and rebase onto
`origin/<base>` only if the user agrees.

Record each repo's base commit SHA; its hand-off and PR cite it.

---

## Step 5 — Write the hand-off(s)

Skip when `no-handoff` applies or Step 0f found no convention — the same content then goes into the PR
description (Step 8b).

Follow the project's own hand-off skill or template if there is one, including its honesty rules. Read
that folder's index (`README.md`) and one recent hand-off before writing, and match them exactly. Each
hand-off is dated today and describes **only its own repo's code**.

- File name: `<hand-off dir>/<YYYY-MM-DD>-<slug>.md`, or `…-<slug>-<repo key>.md` in a hand-off folder
  shared by several repos.
- A repo with its own hand-off folder keeps its hand-off in its own repo, so it rides its own PR; the
  rest are committed where their folder lives, usually `root`.
- A pointer-bump-only `root` PR gets **no** hand-off file of its own; its description points to the
  submodule hand-offs.

Every hand-off carries at least:

- **Status** — this repo's branch, its base branch and base SHA, and whether it is pushed. The PR does
  not exist yet when the hand-off is committed, so write that it is opened from this branch by
  `/handoff-pr`. Do not leave a PR-number placeholder and do not make a follow-up commit to record it.
- **Merge order**, for multi-repo work — one line pointing to the sibling hand-offs (repo key, shared
  branch name, path). Submodule PRs merge **before** the `root` PR. Link rather than repeat.
- **What changed and why**, with concrete file paths. For a fix: the **root cause**, and the commit
  that introduced it.
- **Verification** — the commands that actually ran and their real output. On a kit project: the
  test-case ids and suites that ran, their pass/fail counts, and each run's report path.
- **Verification NOT done** — every live check skipped, with the writes gate it would have needed,
  plus any Step 2 gate limitation.
- **Follow-ups** — numbered, actionable, most important first.

Add an index row at the top of the folder's table (newest first), matching that index's columns
exactly. Write for a reviewer with no context on the session: concrete SHAs, counts and command output
over adjectives.

---

## Step 6 — Commit (submodules first, root last)

Commit submodules in any order, then `root` last — `root` records the submodule SHAs.

1. **Each submodule in scope**: stage its source files, plus its own hand-off and index if it keeps
   them.
2. **`root`**: stage its own source files, the hand-offs that live there, the index, and each bumped
   submodule pointer (`git add <submodule path>`). Before staging a pointer, confirm it equals the
   commit just made in that submodule (`git -C <sub> rev-parse HEAD` against
   `git diff --submodule=short -- <sub>`).

Stage **only** the files identified in Step 1:

```bash
git -C <repo> add <explicit paths>       # never `git add -A` or `git add .`
git -C <repo> status --short             # confirm nothing unrelated is staged
git -C <repo> diff --cached --stat
```

Match the repo's existing commit style (`git log --oneline -20`). Where it uses conventional commits,
use a scoped subject (`fix(auth): …`) and a body explaining the why; a test-only change scopes to the
module id or `tcPrefix` it covers. For a pointer-bump-only `root` commit:
`chore(submodules): bump <a>, <b> (<slug>)`, with each submodule's old -> new SHA and hand-off path in
the body.

**Attribution:** follow the attribution rules in force for this session and repo (session
instructions, `CLAUDE.md`, memory). Do not invent a prohibition, and do not add a trailer beyond what
those instructions ask for.

If a commit triggers a hook that rewrites staged files (`lint-staged`, `husky`, `pre-commit`), re-run
that repo's Step 3 checks once — the files changed after you verified them.

---

## Step 7 — Push (submodules first, root last)

Resolve the Step 8a tier **before** pushing: the GitLab push-options tier has to ride the push itself.

```bash
git -C <repo> push -u origin <prefix>/<slug>
```

- Check the exit code and the `[new branch]` line rather than assuming it worked.
- Both forges print a create-PR URL in the push output (`remote: Create a pull request…` /
  `remote: To create a merge request…`). **Capture it** — it is the authoritative link for the 8d
  fallback.
- Push every submodule before `root`, so the recorded submodule commits exist on their remotes.
- If a push is rejected as non-fast-forward, stop and report. Never force-push a shared branch.

---

## Step 8 — Open the PR(s)

Create them in the Step 6 order: submodules first, `root` last with links to the submodule PRs.

### 8a. Pick the creation tier (first one that works, per that repo's forge)

**GitHub**

1. `gh` — if `gh auth status` is logged in for that host.
2. REST API with `GITHUB_TOKEN`: `POST <api>/repos/<owner>/<repo>/pulls`.
3. Fallback: the compare URL (8d).

**GitLab**

1. `glab` — if `glab auth status --hostname <host>` is logged in.
2. REST API with `GITLAB_TOKEN`:
   `POST <web-origin>/api/v4/projects/<url-encoded namespace%2Fproject>/merge_requests`.
3. **Push options** — always available, since the push is already authenticated. They carry only
   title, target and source branch; the description has to be pasted by hand, because push options
   cannot carry newlines.
4. Fallback: the new-MR URL (8d).

Check for an existing PR from this branch before creating one:

```bash
gh pr list --repo <owner>/<repo> --head <prefix>/<slug> --state all
glab mr list --repo <namespace>/<project> --source-branch <prefix>/<slug> --all
```

If one exists, do not create a duplicate: report its number, URL and state, and move on. With GitLab
tier 3 you cannot check first — the forge refuses a second MR for the same source and target, so
report whatever the push output says.

### 8b. Write the description(s)

Write each description to a file in the **session scratchpad**, not the repo, e.g.
`<scratchpad>/pr-body-<slug>-<key>.md`. If the repo has a PR/MR template, base the description on it
and keep its headings.

Each description covers its own repo, drawn from that repo's hand-off:

- **Summary** — the bug or feature, the root cause with the commit that introduced it, the fix, the
  files changed, and the path of **this repo's** hand-off. When that hand-off lives on another repo's
  branch, name it as `<repo>:<prefix>/<slug>:<path>`.
- **Verification** — the commands that actually ran and their results, including the test-case ids and
  suites. Tick a checklist item only when it was genuinely satisfied; where one was partly done, leave
  it unticked and say what ran and what did not.
- **Not verified** — carry over this repo's list.
- **Merge order** (multi-repo) — submodule PRs first, then `root`, which links each of them.

A pointer-bump-only `root` PR is short: each submodule bumped (old -> new SHA) with its PR link and
hand-off path, and a note that it merges after them. It does not restate their summaries. Add this
warning to it: if a submodule PR is **squash-merged or rebased**, the pointer recorded here will no
longer exist on that submodule's base branch and must be re-bumped to the merged commit before this PR
merges.

### 8c. Create and confirm

Use the Step 6 commit subject as the PR title. Run these from a POSIX shell (the Bash tool), not
PowerShell, which splits quoted native arguments and mangles titles containing apostrophes.

**GitHub, tier 1:**

```bash
gh pr create --repo <owner>/<repo> --head <prefix>/<slug> --base <base> \
  --title "<type>(<area>): <subject>" --body-file "<scratchpad>/pr-body-<slug>-<key>.md" [--draft]
gh pr view <prefix>/<slug> --repo <owner>/<repo> --json number,url,state,isDraft,baseRefName,mergeable
```

**GitLab, tier 1:**

```bash
glab mr create --repo <namespace>/<project> --source-branch <prefix>/<slug> --target-branch <base> \
  --title "<type>(<area>): <subject>" --description "$(cat "<scratchpad>/pr-body-<slug>-<key>.md")" --yes
glab mr view <prefix>/<slug> --repo <namespace>/<project> --output json
```

**Tier 2, REST API.** Build the JSON with `node`, so the description is escaped correctly (GitLab
keys shown; GitHub uses `head`, `base`, `title`, `body` against `<api>/repos/<owner>/<repo>/pulls`
with `--header "Authorization: Bearer $GITHUB_TOKEN"`):

```bash
node -e 'const fs=require("fs");const[a,b,c,d]=process.argv.slice(1);process.stdout.write(JSON.stringify({source_branch:a,target_branch:b,title:c,description:fs.readFileSync(d,"utf8"),remove_source_branch:false}))' \
  "<prefix>/<slug>" "<base>" "<title>" "<scratchpad>/pr-body-<slug>-<key>.md" > "<scratchpad>/pr-<slug>-<key>.json"
curl -s --fail-with-body --header "PRIVATE-TOKEN: $GITLAB_TOKEN" --header "Content-Type: application/json" \
  --data @"<scratchpad>/pr-<slug>-<key>.json" \
  "<web-origin>/api/v4/projects/<url-encoded namespace%2Fproject>/merge_requests"
```

**GitLab tier 3, push options** (in place of the plain Step 7 push):

```bash
git -C <repo> push -u origin <prefix>/<slug> \
  -o merge_request.create -o merge_request.target=<base> -o "merge_request.title=<title>"
```

It needs a push that updates the ref; if the branch was already pushed plainly, fall through to 8d.

Confirm each PR: target is `<base>`, source is `<prefix>/<slug>`, state is open, and it is a draft only
if asked. Mergeability often reads `checking` / `unknown` right after creation — query once more before
reporting.

### 8d. Fallback: return the create-PR URL(s)

Use this when no tier created the PR, or when GitLab tier 3 created one that still needs its
description. Output the URL the push printed. If none was captured, build one:

```
GitHub: <web-origin>/<owner>/<repo>/compare/<base>...<prefix>/<slug>?expand=1
GitLab: <web-origin>/<namespace>/<project>/-/merge_requests/new?merge_request%5Bsource_branch%5D=<prefix>%2F<slug>&merge_request%5Btarget_branch%5D=<base>
```

Also:

- State plainly why the PR was not created (or why its description is missing), quoting the error.
- Give the path of the 8b description file, so the user can paste it in.
- Mention that installing and logging in to `gh` / `glab`, or exporting `GITHUB_TOKEN` /
  `GITLAB_TOKEN`, lets the skill create PRs directly next time. After they do, resume at 8a — do not
  redo earlier steps.

For multi-repo work, give every URL, labelled with its repo and merge order.

---

## Step 9 — Report

Close with a short summary covering:

- What Step 0 detected: repos, forge(s), bases, branch-prefix convention, hand-off convention, and any
  project instruction that overrode a default here.
- The scope (repo keys) and which hand-off file(s) were written, per repo.
- The slug, and whether it was given or generated.
- Per repo: branch, commit SHA, base branch and base SHA; for `root`, the submodule pointer bumps.
- **The PR URL(s)** with number, state and merge status, in merge order. If the fallback was used, the
  create-PR URL(s) and the reason instead.
- Anything deliberately excluded from the commits (pre-existing drift, `.env`, run reports and
  evidence, local config), and why.
- Anything left unverified, including write-gated and live suites not run, and any Step 2 gate
  limitation.
- Any HIGH/CRITICAL finding, and any instruction conflict you resolved.

The last line(s) of the response are the PR URL(s) — or create-PR URL(s) if the fallback was used — in
merge order with `root` last.

Report what actually happened. If a verification step was skipped or failed, or a PR could not be
created, say so plainly rather than omitting it.

---

## Checklist

- [ ] Read the project instructions, `qakit.config.yaml` and `<paths.knowledge>/handoff-pr.md`; named
      every place a project rule overrode a default here.
- [ ] Every dirty path sorted into this work or pre-existing drift; nothing staged with `add -A`.
- [ ] No `.env`, credentials, `node_modules/`, build output, run reports, evidence, run store or
      installed skill copies in the commits.
- [ ] Diff scanned for secrets and real customer data.
- [ ] Project analysis gates run as the instructions specify; HIGH/CRITICAL and UNKNOWN findings
      reported, never waived.
- [ ] Checks run and quoted with real output; scenario suites named by test-case id with their counts;
      pre-existing failures proven by a stashed re-run.
- [ ] No write-gated, seeding or shared-environment run performed without the user asking.
- [ ] Branched from a freshly fetched base; base SHA recorded per repo.
- [ ] Hand-off written in the project's format, with Verification and Verification NOT done, and an
      index row added.
- [ ] Committed submodules before `root`; pointers match the submodule HEADs.
- [ ] PR(s) opened (or the create-PR URL returned with the reason), confirmed open against the right
      base, and reported in merge order.
