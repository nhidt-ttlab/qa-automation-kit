/**
 * Pass 5 of the SQLite -> Postgres import: mark UI runs and bring their browser evidence
 * across so the reporting app can show screenshots without the regression runner present.
 *
 * Why this reads Postgres rather than SQLite, unlike passes 1-4: pass 2 inserts only runs
 * that are missing, so iterating its worklist would skip every run imported before this
 * feature existed. Reading the target instead makes the pass self-healing — it backfills
 * history on first run and is a cheap no-op afterwards, so no separate backfill script.
 *
 * The runner does not record whether a run was UI or API (its README says outright that "a
 * UI run is indistinguishable from an API run downstream"), so this derives it from two
 * signals, taking the union:
 *   1. an `artifacts` row of kind 'other' pointing at an evidence manifest — authoritative,
 *      written by persist-run.ts for UI runs only;
 *   2. a `ui-` scenario_key prefix — the fallback, which matters because 3 of the 17 UI runs
 *      on disk today have no such artifact row.
 * `test_case_id` is deliberately NOT used: upsertTestCase falls back to the scenario key when
 * a scenario omits overview.testCaseId, so `TC-%-U%` misses ui-po-list-columns-vs-source.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  normalizeManifest,
  type SourceEvidenceManifest,
} from '../runs/ui-evidence.util';

export interface UiEvidenceSyncStats {
  uiRuns: number;
  manifestsRead: number;
  filesCopied: number;
  filesSkipped: number;
  uiTestCases: number;
}

export interface UiEvidenceSyncOptions {
  prisma: PrismaClient;
  /** Root of the regression runner package — manifest relPaths resolve against this. */
  runnerRoot: string;
  /** Root of the API-owned evidence tree files are copied into. */
  evidenceRoot: string;
  warnings: string[];
}

/**
 * Index of `runId -> runner-relative manifest path`, built by walking the evidence tree once.
 *
 * Replaces a hard-coded `evidence/<scenarioKey>/<runId>/manifest.json` guess, which stopped
 * being true when the runner regrouped evidence as
 * `evidence/<domain>/<api|ui>/<TC-ID>/<runId>/` (regression harness commit 9676291).
 *
 * Keyed on the run id alone — minted per execution, unique, and always the LAST path segment
 * in every layout the runner has used. That is what lets one index serve both the flat runs
 * already recorded in Postgres and the grouped ones written from now on, and what will keep
 * this working if the grouping changes again. Probe runs under `_unknown/` are picked up too.
 */
function indexManifestsByRunId(runnerRoot: string, maxDepth = 6): Map<string, string> {
  const index = new Map<string, string>();

  const walk = (absDir: string, relDir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // evidence/ absent or unreadable — callers already warn per run
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childAbs = path.join(absDir, entry.name);
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (fs.existsSync(path.join(childAbs, 'manifest.json'))) {
        // Directory name is the run id; first match wins (ids do not repeat).
        if (!index.has(entry.name)) {
          index.set(entry.name, `evidence/${childRel}/manifest.json`);
        }
      }
      walk(childAbs, childRel, depth + 1);
    }
  };

  walk(path.join(runnerRoot, 'evidence'), '', 0);
  return index;
}

/**
 * Copies one file unless an identical-sized copy is already there.
 *
 * Size is a sufficient guard here: a run directory is written once by the runner and never
 * mutated afterwards (the run id is minted per execution), so same path + same size means
 * same bytes. Hashing every file on every sync would cost far more than it catches.
 */
function copyIfNeeded(
  source: string,
  destination: string,
  expectedSize: number,
): 'copied' | 'skipped' | 'missing' {
  if (!fs.existsSync(source)) return 'missing';
  if (fs.existsSync(destination) && fs.statSync(destination).size === expectedSize) {
    return 'skipped';
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return 'copied';
}

export async function syncUiEvidence({
  prisma,
  runnerRoot,
  evidenceRoot,
  warnings,
}: UiEvidenceSyncOptions): Promise<UiEvidenceSyncStats> {
  const stats: UiEvidenceSyncStats = {
    uiRuns: 0,
    manifestsRead: 0,
    filesCopied: 0,
    filesSkipped: 0,
    uiTestCases: 0,
  };

  // --- Build the candidate set -------------------------------------------------------
  const manifestArtifacts = await prisma.artifact.findMany({
    where: { kind: 'other', path: { startsWith: 'evidence/', endsWith: 'manifest.json' } },
    select: { runId: true, path: true },
  });
  const manifestPathByRunId = new Map<string, string>();
  for (const artifact of manifestArtifacts) {
    if (artifact.path) manifestPathByRunId.set(artifact.runId, artifact.path);
  }

  const prefixedRuns = await prisma.testRun.findMany({
    where: { scenarioKey: { startsWith: 'ui-' } },
    select: { id: true },
  });

  const candidateIds = new Set<string>([
    ...manifestPathByRunId.keys(),
    ...prefixedRuns.map((run) => run.id),
  ]);
  if (candidateIds.size === 0) return stats;

  const candidates = await prisma.testRun.findMany({
    where: { id: { in: [...candidateIds] } },
    select: { id: true, scenarioKey: true, testCaseId: true },
  });

  // One walk of the evidence tree covers every run missing an artifact row, instead of
  // guessing a path per run from a layout the runner is free to change.
  const manifestsOnDisk = indexManifestsByRunId(runnerRoot);

  // --- Per run: copy the files, store the index ----------------------------------------
  const touchedScenarioKeys = new Set<string>();

  for (const run of candidates) {
    touchedScenarioKeys.add(run.scenarioKey);
    stats.uiRuns += 1;

    const manifestRelPath =
      manifestPathByRunId.get(run.id) ?? manifestsOnDisk.get(run.id);

    let manifest: SourceEvidenceManifest | undefined;
    if (!manifestRelPath) {
      warnings.push(
        `${run.id}: no evidence manifest found anywhere under evidence/, ui_evidence left NULL`,
      );
    } else {
      const manifestAbsPath = path.resolve(runnerRoot, manifestRelPath);
      if (fs.existsSync(manifestAbsPath)) {
        try {
          manifest = JSON.parse(
            fs.readFileSync(manifestAbsPath, 'utf8'),
          ) as SourceEvidenceManifest;
        } catch {
          warnings.push(`${run.id}: malformed evidence manifest, ui_evidence left NULL`);
        }
      } else {
        warnings.push(
          `${run.id}: evidence manifest not found at ${manifestRelPath}, ui_evidence left NULL`,
        );
      }
    }

    // Marked UI either way — a missing manifest means evidence was pruned, not that the run
    // was an API run. The tab must still show it.
    if (!manifest) {
      await prisma.testRun.update({ where: { id: run.id }, data: { runType: 'ui' } });
      continue;
    }
    stats.manifestsRead += 1;

    const stored = normalizeManifest(manifest, run.id);
    const presentItems = stored.items.filter((item) => {
      const outcome = copyIfNeeded(
        path.resolve(runnerRoot, 'evidence', item.storage_path),
        path.resolve(evidenceRoot, item.storage_path),
        item.size_bytes,
      );
      if (outcome === 'copied') stats.filesCopied += 1;
      if (outcome === 'skipped') stats.filesSkipped += 1;
      if (outcome === 'missing') {
        warnings.push(
          `${run.id}: evidence file listed in manifest but missing on disk: ${item.storage_path}`,
        );
      }
      // A manifest entry with no file behind it would render as a broken image.
      return outcome !== 'missing';
    });

    await prisma.testRun.update({
      where: { id: run.id },
      data: {
        runType: 'ui',
        uiEvidence: { ...stored, items: presentItems } as never,
      },
    });
  }

  // --- Promote the test cases ----------------------------------------------------------
  if (touchedScenarioKeys.size > 0) {
    const updated = await prisma.testCase.updateMany({
      where: { scenarioKey: { in: [...touchedScenarioKeys] } },
      data: { runType: 'ui' },
    });
    stats.uiTestCases = updated.count;
  }

  return stats;
}
