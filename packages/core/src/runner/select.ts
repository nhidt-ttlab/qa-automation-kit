import type { SuiteKind } from './artifact-layout.js';

/** One registered scenario, as the selection and batch tooling sees it. */
export interface ScenarioIndexEntry {
  scenario: string;
  /** Suite module (folder). */
  module: string;
  /** Documentation module — may be finer than `module`. */
  domain: string;
  kind: SuiteKind;
  testCaseId: string;
}

export interface Selector {
  kind?: SuiteKind;
  /** Suite module, docs domain, or short alias. Empty = every module. */
  modules?: string[];
  /**
   * Exact test-case ids (case-insensitive). Distinct from `grep` on purpose: grep is a substring,
   * so `TC-ORD-A1` would also take `TC-ORD-A10`…`A19`.
   */
  testCaseIds?: string[];
  /** Substring match against the scenario key or the test-case id (case-insensitive). */
  grep?: string;
}

/** Short module names mapped to a suite module, e.g. `{ po: 'purchase-order' }`. */
export type ModuleAliases = Readonly<Record<string, string>>;

/** Sorted by test-case id, then scenario key — the order every listing and batch uses. */
export function sortScenarioIndex(entries: readonly ScenarioIndexEntry[]): ScenarioIndexEntry[] {
  return [...entries].sort((a, b) => a.testCaseId.localeCompare(b.testCaseId) || a.scenario.localeCompare(b.scenario));
}

/** Every selectable module/domain token, for `--list` and error messages. */
export function knownModuleTokens(entries: readonly ScenarioIndexEntry[], aliases: ModuleAliases = {}): string[] {
  const tokens = new Set<string>(Object.keys(aliases));
  for (const entry of entries) {
    tokens.add(entry.module);
    tokens.add(entry.domain);
  }
  return [...tokens].sort();
}

function matchesModule(entry: ScenarioIndexEntry, token: string, aliases: ModuleAliases): boolean {
  const wanted = token.toLowerCase();
  const resolved = aliases[wanted] ?? wanted;
  return entry.module === resolved || entry.domain === resolved || entry.domain === wanted;
}

/** Entries matching every supplied facet (kind AND module AND test case AND grep). An empty selector selects everything. */
export function selectScenarios(entries: readonly ScenarioIndexEntry[], selector: Selector, aliases: ModuleAliases = {}): ScenarioIndexEntry[] {
  const grep = selector.grep?.toLowerCase();
  const wantedIds = selector.testCaseIds?.length ? new Set(selector.testCaseIds.map((id) => id.toUpperCase())) : undefined;
  return entries.filter((entry) => {
    if (selector.kind && entry.kind !== selector.kind) return false;
    if (selector.modules?.length && !selector.modules.some((m) => matchesModule(entry, m, aliases))) return false;
    if (wantedIds && !wantedIds.has(entry.testCaseId.toUpperCase())) return false;
    if (grep && !entry.scenario.toLowerCase().includes(grep) && !entry.testCaseId.toLowerCase().includes(grep)) return false;
    return true;
  });
}

export interface BatchOptions {
  selector: Selector;
  list: boolean;
  bail: boolean;
  /** Everything that is not a selection flag, passed through to the single-run argument parser. */
  rest: string[];
  /** Human label for the batch, derived from the selection. */
  label: string;
}

/** Parses the batch selection flags: `--all`, `--kind`, `--module`, `--testcase`, `--grep`, `--list`, `--bail`. */
export function parseBatchArgs(argv: readonly string[]): BatchOptions {
  const selector: Selector = {};
  const rest: string[] = [];
  let list = false;
  let bail = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string | undefined => argv[++i];
    switch (arg) {
      case '--all':
        break; // The empty selector already means "everything"; the flag is documentation.
      case '--kind': {
        const value = next();
        if (value !== 'api' && value !== 'ui') throw new Error(`--kind expects api|ui, got "${value ?? ''}"`);
        selector.kind = value;
        break;
      }
      case '--module': {
        const value = next();
        if (!value) throw new Error('--module expects a name (see --list for the valid tokens)');
        selector.modules = [...(selector.modules ?? []), ...value.split(',').map((m) => m.trim()).filter(Boolean)];
        break;
      }
      case '--testcase': {
        const value = next();
        if (!value) throw new Error('--testcase expects a testcase id (see --list for the valid ids)');
        selector.testCaseIds = [...(selector.testCaseIds ?? []), ...value.split(',').map((t) => t.trim()).filter(Boolean)];
        break;
      }
      case '--grep':
        selector.grep = next();
        break;
      case '--list':
        list = true;
        break;
      case '--bail':
        bail = true;
        break;
      default:
        rest.push(arg);
    }
  }

  const label = [selector.kind, ...(selector.modules ?? []), ...(selector.testCaseIds ?? []), selector.grep].filter(Boolean).join('-') || 'all';
  return { selector, list, bail, rest, label };
}
