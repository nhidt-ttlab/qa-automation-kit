import { UI_EVIDENCE_KIND } from '@qakit/reporting-shared';
import type {
  UiEvidenceDto,
  UiEvidenceItemDto,
  UiEvidenceKind,
} from '@qakit/reporting-shared';

/**
 * Translation layer between the regression runner's evidence manifest and what this API
 * stores and serves.
 *
 * Source contract: the evidence types in @qakit/core (evidence/types.ts). The runner owns
 * that file; treat the shapes below as a read-only mirror and keep the field names identical
 * so a drift is obvious on sight.
 */

/** Mirrors the runner's `EvidenceItem`. */
export interface SourceEvidenceItem {
  id: string;
  kind: string;
  label: string;
  /** Relative to the runner package root, e.g. `evidence/ui-login-happy-path/run-x/...`. */
  relPath: string;
  sizeBytes: number;
  contentHash: string;
  capturedAt: string;
  /** 0-based index into the run's steps. */
  stepIndex?: number;
  checkTestId?: string;
}

/** Mirrors the runner's `EvidenceManifest`. */
export interface SourceEvidenceManifest {
  schemaVersion: number;
  runId: string;
  scenario: string;
  generatedAt: string;
  webBaseUrl: string;
  browser: { name: string; version: string };
  items: SourceEvidenceItem[];
  diagnosticsSummary: {
    pageErrors: number;
    consoleErrors: number;
    failedRequests: number;
    blockedRequests: number;
  };
  consoleCaptureNote?: string;
}

/**
 * What actually goes in `test_runs.ui_evidence`: the public DTO plus the on-disk location,
 * which the download route needs but no client should see.
 */
export type StoredUiEvidenceItem = UiEvidenceItemDto & { storage_path: string };
export type StoredUiEvidence = Omit<UiEvidenceDto, 'items'> & {
  items: StoredUiEvidenceItem[];
};

const KNOWN_KINDS = new Set<string>(Object.values(UI_EVIDENCE_KIND));

export function uiEvidenceItemUrl(runId: string, itemId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/ui-evidence/${encodeURIComponent(itemId)}`;
}

/**
 * Path under the evidence storage root, mirroring the runner's own `<scenario>/<runId>/...`
 * layout. `relPath` is package-root-relative and always starts with `evidence/`, so dropping
 * that one segment is the whole transformation.
 */
export function toStoragePath(relPath: string): string {
  const normalized = relPath.split('\\').join('/');
  return normalized.startsWith('evidence/')
    ? normalized.slice('evidence/'.length)
    : normalized;
}

/**
 * Manifest -> the record stored on the run.
 *
 * Two normalizations happen here and nowhere else:
 *   - `stepIndex` (0-based) becomes `step_sequence` (1-based), matching TestRunStep.sequence.
 *     Verified against run-mtd4bhg7-vuh9do: stepIndex 0 is step seq 1.
 *   - `relPath` becomes an API URL plus a storage path, so no consumer ever needs to know
 *     where the runner keeps its files.
 *
 * The manifest indexes itself under kind `manifest`; that entry is dropped, as are any kinds
 * this API does not know about, so a runner-side addition degrades to "not shown" rather than
 * to a broken link.
 */
export function normalizeManifest(
  manifest: SourceEvidenceManifest,
  runId: string,
): StoredUiEvidence {
  const items = manifest.items
    .filter((item) => KNOWN_KINDS.has(item.kind))
    .map((item) => ({
      id: item.id,
      kind: item.kind as UiEvidenceKind,
      label: item.label,
      url: uiEvidenceItemUrl(runId, item.id),
      size_bytes: item.sizeBytes,
      content_hash: item.contentHash,
      captured_at: item.capturedAt,
      step_sequence:
        typeof item.stepIndex === 'number' ? item.stepIndex + 1 : undefined,
      check_test_id: item.checkTestId,
      storage_path: toStoragePath(item.relPath),
    }));

  return {
    scenario: manifest.scenario,
    generated_at: manifest.generatedAt,
    web_base_url: manifest.webBaseUrl,
    browser: manifest.browser,
    diagnostics: {
      page_errors: manifest.diagnosticsSummary.pageErrors,
      console_errors: manifest.diagnosticsSummary.consoleErrors,
      failed_requests: manifest.diagnosticsSummary.failedRequests,
      blocked_requests: manifest.diagnosticsSummary.blockedRequests,
    },
    console_capture_note: manifest.consoleCaptureNote,
    items,
  };
}

/** Reads the jsonb column back. Returns undefined rather than throwing on anything unexpected. */
export function parseStoredUiEvidence(
  value: unknown,
): StoredUiEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<StoredUiEvidence>;
  return Array.isArray(candidate.items)
    ? (value as StoredUiEvidence)
    : undefined;
}

/** Drops `storage_path` — the on-disk layout is not part of the public contract. */
export function toPublicUiEvidence(stored: StoredUiEvidence): UiEvidenceDto {
  return {
    ...stored,
    items: stored.items.map(({ storage_path: _storagePath, ...item }) => item),
  };
}

export function findStoredItem(
  stored: StoredUiEvidence,
  itemId: string,
): StoredUiEvidenceItem | undefined {
  return stored.items.find((item) => item.id === itemId);
}

/** Screenshot count for the test case list's UI tab. Cheap enough to call per row. */
export function countScreenshots(value: unknown): number | undefined {
  const stored = parseStoredUiEvidence(value);
  if (!stored) return undefined;
  return stored.items.filter(
    (item) => item.kind === UI_EVIDENCE_KIND.SCREENSHOT,
  ).length;
}
