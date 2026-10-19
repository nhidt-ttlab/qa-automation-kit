# ADR 0001: Extract a reusable QA automation kit from the starlive ERP stack

- **Status:** accepted
- **Date:** 2026-09-13

## Context

This workspace's QA automation works only for starlive ERP. It has five parts:

| Part | Location today |
|---|---|
| API MCP gateway | `starlive-mcp-gateway/` |
| UI MCP server | `tests/starlive-api-regression/src/entrypoints/mcp-server` |
| Scenario harness (1219 scenarios) | `tests/starlive-api-regression` |
| Reporting app | `tests/reporting-workspace` |
| QA skills pipeline | `.claude/skills` |

Most of the machinery is generic, but starlive assumptions are hardcoded throughout it:

- ABP `/connect/token` with client `CxmApi_App`.
- `persist:root` localStorage seeding and the `/dang-nhap` login route.
- Ant Design and AG Grid helpers imported by the core browser driver.
- A Vietnamese destructive-label regex.
- A closed `SuiteModule` union.
- Purchase-order rendering inside the generic report writer.
- About 52 hardcoded paths across the skills.

The next projects will use other REST/OpenAPI backends, other auth schemes and other UI stacks, some of them not yet known.

## Decision

1. **Extract, then adopt.** The generic code moves to `template/qa-automation-kit`, and starlive ERP becomes its first consumer. There is one source of truth. ERP staying green after every phase is the proof that the extraction is correct.
2. **Two seams.**
   - `qakit.config.yaml`, validated by zod with a generated JSON Schema, holds everything declarative: hosts, auth, the module registry, paths the skills read, safety switches and MCP server names.
   - `ProjectAdapter`, a TypeScript module, holds behaviour: browser session seeding, widget adapters, data providers, report wording and failure heuristics.
3. **Pluggable auth.** The providers are `none`, `static-bearer`, `api-key`, `oauth2-password`, `jwt-login`, `cookie-session` and a one-hop `reuse`, all sharing one token store. This replaces the two duplicated OAuth copies in the gateway and the harness.
4. **Pluggable widgets.** The driver talks to `WidgetAdapter`s for grids, selects, modals, tabs, pagination and settle-waits. `ui-html` (ARIA and native elements) is the default. `ui-antd` and `ui-ag-grid` are moved out of the starlive harness.
5. **English core, locale packs.** Vietnamese tool messages, destructive-action labels and doc headings move to `@qakit/locale-vi`.
6. **Safe by default.**
   - Writes and destructive actions are off unless config or the `allowWritesEnv` switch turns them on.
   - The API MCP gains the write gate and audit log that the starlive gateway lacks.
7. **Packaging.**
   - The kit is a pnpm workspace, and its packages build with `tsc -b`.
   - Consumers depend on the packages through `file:` dependencies; publishing is deferred.
   - Existing `#platform/*` and `#harness/*` import aliases in the ERP harness become re-export shims, so the 1219 scenario files do not change.
8. **Neutrality is enforced.** A fitness test forbids consuming-project names outside `packages/locale-*` and this ADR folder.

## Phases

0. Record the ERP baseline, create the skeleton, and add the config schema, loader and fitness tests.
1. `@qakit/core`: HTTP, auth providers, logger, assertions, runner, evidence, report model, SQLite store, checklist trace. `report.ts` is split into a generic core and adapter hooks.
2. `@qakit/ui` and the widget adapters.
3. `@qakit/mcp-ui`.
4. `@qakit/mcp-api`, with the write gate, `api:docgen`, and `api:domains` for bootstrapping domains from OpenAPI tags.
5. The reporting app, with a tracker adapter whose first implementation is Redmine.
6. Skills and doc templates, reading config and loading project knowledge from `paths.knowledge`.
7. `qakit init` and `doctor`, the `examples/demo-app` end-to-end target, and `ADOPTING.md`.

## Consequences

- Moving a symbol out of the ERP harness requires GitNexus impact analysis first, and a `detect_changes` review before each commit.
- Each phase must reproduce the Phase 0 ERP baseline: typecheck, unit and fitness tests, the gateway tests, the reporting tests, and a read-only smoke run with identical verdicts.
- Kit changes can break ERP through its `file:` dependency. That is intended: ERP and `examples/demo-app` are the kit's two integration tests. The demo (`test/demo-e2e.test.ts`) proves the non-ERP path: `doctor`, JWT login, OpenAPI spec, and API and UI scenarios through the generic `html` widgets.

## Status (2026-09-13)

All phases are done. ERP consumes `@qakit/core`, `ui`, `mcp-ui` and `mcp-api` through `file:` dependencies. `starlive-mcp-gateway/` is reduced to config and a launcher. The reporting app runs from `apps/reporting-*` with ERP's data directory. ERP's `.claude/skills` QA skills are installed from `skills/` with its knowledge in `.qakit/knowledge/`.

Follow-ups, not yet built:
- The widget adapters (Ant Design, AG Grid) still live in ERP.
- Checklist `.xlsx` templates are not in `doc-templates/`.
- Config keys the skills asked for: `modules[].specPrefixes`, per-module doc names, `paths.plans`, `paths.outputs`, and a `commands` map. Until they exist, skills read these from knowledge files.
- The reporting app's server deploy from the new location is untested.
