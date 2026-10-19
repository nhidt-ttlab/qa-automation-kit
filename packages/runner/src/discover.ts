import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LoadedProjectConfig } from '@qakit/core';
import { isScenario, type Scenario, type ScenarioKind } from './scenario.js';

const SCENARIO_FILE = /\.scenario\.(ts|mts|js|mjs)$/;

export interface DiscoverOptions {
  /** Explicit files; when empty, every `*.scenario.*` under `paths.suites`. */
  files?: string[];
  kind?: ScenarioKind;
  /** Substring of the scenario name or title. */
  grep?: string;
  testCaseIds?: string[];
}

export interface DiscoveredScenario {
  file: string;
  scenario: Scenario;
}

let typeScriptLoader: Promise<void> | undefined;

/** Scenario files are TypeScript; make sure they can be imported even when not already running under tsx. */
function ensureTypeScriptLoader(): Promise<void> {
  typeScriptLoader ??= import('tsx/esm/api')
    .then((api) => {
      api.register();
    })
    .catch(() => undefined);
  return typeScriptLoader;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(full).isDirectory() ? walk(full) : SCENARIO_FILE.test(name) ? [full] : [];
  });
}

/** Imports scenario modules and returns the scenarios they export (default or named), filtered. */
export async function discoverScenarios(loaded: LoadedProjectConfig, options: DiscoverOptions = {}): Promise<DiscoveredScenario[]> {
  const files = (options.files?.length ? options.files.map((f) => path.resolve(f)) : walk(loaded.resolvePath(loaded.config.paths.suites))).sort();
  if (files.some((f) => /\.m?ts$/.test(f))) await ensureTypeScriptLoader();

  const found: DiscoveredScenario[] = [];
  const names = new Map<string, string>();
  for (const file of files) {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(module)) {
      if (!isScenario(value)) continue;
      const previous = names.get(value.name);
      if (previous && previous !== file) throw new Error(`Scenario name "${value.name}" is declared in both ${previous} and ${file}.`);
      if (previous) continue;
      names.set(value.name, file);
      found.push({ file, scenario: value });
    }
  }

  const grep = options.grep?.toLowerCase();
  return found
    .filter(({ scenario }) => !options.kind || scenario.kind === options.kind)
    .filter(({ scenario }) => !grep || scenario.name.toLowerCase().includes(grep) || scenario.title.toLowerCase().includes(grep))
    .filter(({ scenario }) => !options.testCaseIds?.length || options.testCaseIds.includes(scenario.testCaseId))
    .sort((a, b) => a.scenario.testCaseId.localeCompare(b.scenario.testCaseId) || a.scenario.name.localeCompare(b.scenario.name));
}
