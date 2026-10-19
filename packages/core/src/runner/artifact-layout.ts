import fs from 'node:fs';
import path from 'node:path';
import { redactObject } from '../logger.js';
import type { ProposalRecord, ReviewRecord } from '../report/result.js';

export type SuiteKind = 'api' | 'ui';

/**
 * Where a run's artifacts live: `<domain>/<kind>/<testCaseId>`, applied identically to every
 * artifact root. Resolved from the scenario key alone, so a reader that knows only
 * `(scenario, runId)` can rebuild any artifact path.
 */
export interface ArtifactGroup {
  domain: string;
  /** `undefined` only for a producer that is not a registered scenario (probes, ad hoc sessions). */
  kind: SuiteKind | undefined;
  testCaseId: string;
}

/** The generated trees plus the two human-authored ones (`reviews`, `proposals`). */
export type ArtifactRoot = 'reports' | 'outputs' | 'evidence' | 'reviews' | 'proposals';

/** Path segments are folder names: keep them to characters every filesystem accepts. */
export function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

/** `['orders', 'api', 'TC-ORD-A01']` — joined under each artifact root. */
export function groupSegments(group: ArtifactGroup): string[] {
  return group.kind ? [group.domain, group.kind, group.testCaseId] : [group.domain, group.testCaseId];
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Inverse of `ensureDir`: after removing a file, drops the directories that existed only to hold
 * it, so grouped artifact folders do not strand empty chains. Stops at `stopAt` and at the first
 * non-empty directory, and never throws.
 */
export function pruneEmptyDirs(fromPath: string, stopAt: string): void {
  let dir = path.dirname(path.resolve(fromPath));
  const root = path.resolve(stopAt);
  while (dir.startsWith(root) && dir !== root) {
    try {
      if (fs.readdirSync(dir).length > 0) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

export function writeJsonPretty(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export interface ArtifactLayoutOptions {
  /** Project root; every artifact root is a direct child of it. */
  rootDir: string;
  resolveGroup(scenario: string): ArtifactGroup;
}

export interface ArtifactLayout {
  readonly rootDir: string;
  group(scenario: string): ArtifactGroup;
  /** Bare: the root of the tree. With a group: that test case's folder under it. */
  dir(root: ArtifactRoot, group?: ArtifactGroup): string;
  runEvidenceDir(scenario: string, runId: string): string;
  evidenceManifestPath(scenario: string, runId: string): string;
}

export function createArtifactLayout(options: ArtifactLayoutOptions): ArtifactLayout {
  const dir = (root: ArtifactRoot, group?: ArtifactGroup): string =>
    path.join(options.rootDir, root, ...(group ? groupSegments(group) : []));
  const runEvidenceDir = (scenario: string, runId: string): string => path.join(dir('evidence', options.resolveGroup(scenario)), runId);
  return {
    rootDir: options.rootDir,
    group: options.resolveGroup,
    dir,
    runEvidenceDir,
    evidenceManifestPath: (scenario, runId) => path.join(runEvidenceDir(scenario, runId), 'manifest.json'),
  };
}

/** Saves a review decision to `reviews/<group>/<runId>.review.json`, redacted. */
export function saveReview(layout: ArtifactLayout, review: ReviewRecord): string {
  const dir = layout.dir('reviews', layout.group(review.scenario));
  ensureDir(dir);
  const filePath = path.join(dir, `${review.runId}.review.json`);
  writeJsonPretty(filePath, redactObject(review));
  return filePath;
}

/** Loads an existing review for a run, or `null` when not yet reviewed. */
export function loadReview(layout: ArtifactLayout, scenario: string, runId: string): ReviewRecord | null {
  const filePath = path.join(layout.dir('reviews', layout.group(scenario)), `${runId}.review.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ReviewRecord;
}

/** Saves an AI/heuristic proposal to `proposals/<group>/<runId>.proposal.json`, redacted. */
export function saveProposal(layout: ArtifactLayout, proposal: ProposalRecord): string {
  const dir = layout.dir('proposals', layout.group(proposal.scenario));
  ensureDir(dir);
  const filePath = path.join(dir, `${proposal.runId}.proposal.json`);
  writeJsonPretty(filePath, redactObject(proposal));
  return filePath;
}
