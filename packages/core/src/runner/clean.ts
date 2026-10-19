import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, pruneEmptyDirs } from './artifact-layout.js';

export type CleanScope = 'run' | 'all';

export interface CleanTreesOptions {
  /** Project root. Nothing outside it is ever removed. */
  rootDir: string;
  /** Absolute artifact roots to clean — the regenerable trees only, never reviews or session ledgers. */
  roots: readonly string[];
  scope: CleanScope;
  /** Scenarios whose test-case folders `run` removes. Ignored by `all`. */
  scenarios: readonly string[];
  /** Group path segments of a scenario under each root. */
  scenarioSegments(scenario: string): string[];
  /** Entries kept when a root is emptied by `all` (e.g. `.gitkeep`). */
  keepAtRoot?: ReadonlySet<string>;
}

/**
 * Wipes the artifacts of a previous run before a new one starts.
 *  - `run` removes only the test-case folders of the given scenarios, pruning emptied parents.
 *  - `all` empties every root, keeping `keepAtRoot` entries.
 * Returns the absolute paths actually removed. Database rows are the caller's to purge.
 */
export function cleanArtifactTrees(options: CleanTreesOptions): string[] {
  const removed: string[] = [];
  const rootDir = path.resolve(options.rootDir);

  const removeIfPresent = (target: string): void => {
    const resolved = path.resolve(target);
    if (!resolved.startsWith(rootDir + path.sep)) {
      throw new Error(`Refusing to clean outside the package root: ${resolved}`);
    }
    if (!fs.existsSync(resolved)) return;
    fs.rmSync(resolved, { recursive: true, force: true });
    removed.push(resolved);
  };

  for (const dir of options.roots) {
    ensureDir(dir);

    if (options.scope === 'all') {
      for (const entry of fs.readdirSync(dir)) {
        if (options.keepAtRoot?.has(entry)) continue;
        removeIfPresent(path.join(dir, entry));
      }
      continue;
    }

    // Deduped: a batch can select several scenarios that share one test-case folder.
    const groups = new Set(options.scenarios.map((scenario) => path.join(dir, ...options.scenarioSegments(scenario))));
    for (const group of groups) {
      removeIfPresent(group);
      pruneEmptyDirs(group, rootDir);
    }
  }

  return removed;
}
