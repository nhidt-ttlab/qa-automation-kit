# Reporting app

A web app for reviewing regression runs: it imports the runner's SQLite run store into Postgres,
shows runs with their checks, steps and UI evidence, groups failures into defect signatures, keeps a
resolution queue for blocked and not-evaluated results, files tracker issues, and starts regression
jobs.

| Package | What it is |
|---|---|
| `apps/reporting-api` (`@qakit/reporting-api`) | NestJS + Prisma (Postgres) API, maintenance scripts, migrations |
| `apps/reporting-web` (`@qakit/reporting-web`) | React 18 + Vite + MobX + MUI/Tailwind UI |
| `apps/reporting-shared` (`@qakit/reporting-shared`) | Types, DTOs, zod schemas, constants and errors shared by both |

## How a project deploys it

The source stays in the kit; a project keeps only its deployment state and points the app at it:

| Variable | Read by | Meaning |
|---|---|---|
| `REPORTING_DATA_DIR` | API, scripts, Prisma CLI | Folder holding the API's `.env` and the base for every relative path in it (runner path, SQLite path, evidence and job-log storage). Defaults to the process cwd. |
| `REPORTING_WEB_ENV_DIR` | Vite | Folder holding the web app's `.env` (`VITE_*`, baked in at build time). Defaults to the app folder. |
| `REGRESSION_RUNNER_PATH`, `REGRESSION_SQLITE_PATH` | API | The runner checkout and its `db/regression.db`. |
| `REGRESSION_RUNNER_SCRIPT`, `REGRESSION_RUNNER_TSX`, `REGRESSION_RUNNER_ARGS` | API | How regression jobs invoke the runner, relative to `REGRESSION_RUNNER_PATH`: the script (default `src/entrypoints/run-suite.ts`), the tsx CLI it runs under (default `node_modules/tsx/dist/cli.mjs`, `none` for a compiled script on plain node) and leading args (e.g. `--config qakit.config.yaml`). |
| `REGRESSION_RUNNER_ENVIRONMENTS_DIR`, `REGRESSION_RUNNER_ENVIRONMENT_FILE`, `REGRESSION_RUNNER_ENVIRONMENTS` | API | The environments a job may pick: files named by the pattern (default `configs/environments` + `{env}.json`), or a fixed comma-separated list that needs no file per environment. |
| `REGRESSION_RUNNER_SESSIONS_DIR` | API | Where seeded-session locks and job cancel flags live (default `.sessions`). |

The Regression Runs page also has **Sync test scripts** (`POST /api/regression-jobs/workspace/sync`),
so a scenario pushed to the branch the server has checked out can be run without a shell on the
server. It runs `git pull --ff-only` in the repository that contains `REGRESSION_RUNNER_PATH` (the
API process needs `git` on its PATH and non-interactive credentials on the remote), runs
`npm install` in the runner only when its `package.json` or lockfile changed, and drops the cached
scenario catalog so the new test cases appear in the module and testcase pickers. It never switches
branches, resets or stashes: a pull that cannot fast-forward (local commits, an edited tracked file)
is reported as `failed` with git's message, and the sync is refused while a run is in progress.
`GET /api/regression-jobs/workspace` shows the branch, revision and local-change count.
| `RUNNER_WRITES_ENV` | API | Env var the runner reads as its write switch; regression jobs always set it to `0` or `1` (default `QAKIT_ALLOW_WRITES`). |
| `RUNNER_CANCEL_FILE_ENV` | API | Env var naming the cancel-flag file a job's runner watches (default `QAKIT_CANCEL_FILE`). |
| `RUNNER_SCENARIO_PATH_PREFIX` | API | Where the runner sits in the repository, prefixed to `src/suites/<module>/<kind>/<scenario>.scenario.ts` in review CSV exports. |
| `REPORTING_TITLE`, `VITE_APP_TITLE` | API, web | Product name in Swagger and the UI. |
| `REDMINE_URL`, `REDMINE_API_KEY`, `REDMINE_DEFAULT_CUSTOM_FIELDS`, `REDMINE_DEFAULT_VERSION`, `VITE_REDMINE_PROJECT_KEY` | API, web | Redmine, the first `IssueTracker` implementation (`apps/reporting-api/src/modules/redmine/issue-tracker.ts`). |

See `apps/reporting-api/.env.example` and `apps/reporting-web/.env.example` for the full list. A
typical deployment folder has `apps/api/.env` + `storage/`, `apps/web/.env`, a `docker-compose.yml`
for Postgres (start from the kit's `apps/reporting-api/docker-compose.yml` and rename the database,
user, container and volume), a PM2 ecosystem file whose processes run `apps/reporting-api/dist/src/main.js` and
`vite preview` from the kit, and a deploy script that runs, from the kit:

```bash
pnpm install --frozen-lockfile
pnpm reporting:generate        # prisma generate (REPORTING_DATA_DIR set)
pnpm reporting:build           # shared -> api -> web
pnpm --filter @qakit/reporting-api run db:deploy
```

## Data flow

The runner writes its own SQLite file (`sql/schema.sql` in `@qakit/core`) and knows nothing about
Postgres. `db:sync` (`apps/reporting-api/scripts/sync-from-sqlite.ts`) is the one-way importer: it
upserts test cases, inserts runs it has not seen with all their children, upserts defect signatures
and observations, copies UI evidence into `EVIDENCE_STORAGE_PATH`, and projects unresolved evidence
into the resolution queue. It is idempotent. Bug links and `resolution_*` rows belong to the API and
are never written back to the runner.

## Development

```bash
pnpm install
cp apps/reporting-api/.env.example apps/reporting-api/.env
pnpm reporting:db:up                                # Postgres 17 in Docker, matching DATABASE_URL in .env.example
pnpm reporting:generate
pnpm --filter @qakit/reporting-api run db:deploy    # apply the migrations
pnpm --filter @qakit/reporting-api run start:dev    # http://localhost:3000, Swagger at /api/docs
pnpm --filter @qakit/reporting-web run dev          # http://localhost:5173, proxies /api to :3000
pnpm reporting:test                                 # API Jest + web Vitest
pnpm reporting:type-check
pnpm reporting:db:down                              # stop Postgres; the data stays in the volume
```

`apps/reporting-api/docker-compose.yml` defaults to `qakit`/`qakit`, database `qakit_reporting`, port
5432, container `qakit-reporting-postgres` and compose project `qakit-reporting`. If port 5432 is taken
(another project's Postgres), set `POSTGRES_PORT` in `apps/reporting-api/.env` and change the port in
`DATABASE_URL` to match. `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`REPORTING_POSTGRES_CONTAINER` and `REPORTING_COMPOSE_PROJECT` override the rest.

New migrations: `pnpm --filter @qakit/reporting-api exec prisma migrate dev --name <change>`. Applied
migrations are never edited — Prisma checksums them.

## Structure

- **API** (`src/modules/*`): `runs`, `testcases`, `reviews`, `defects`, `redmine`, `dashboard`,
  `resolution`, `search`, `health`, `sync`, `regression-jobs`. Errors use one envelope:
  `{ "error": { "code", "message", "details" } }`. There is no authentication; mutating calls carry a
  self-asserted `actor`.
- **Web** (`src/features/<feature>/{store,service,components,page}`): one MobX store per feature,
  composed by `RootStore`; `shared/` only for code reused across features.
- **Shared**: `constants.ts` (enums), `types/`, `dtos/`, `schemas/` (zod), `errors/`.
