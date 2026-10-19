export type EvidenceKind =
  | 'screenshot'
  | 'video'
  | 'trace_zip'
  | 'console_log'
  | 'network_har'
  | 'dom_snapshot'
  | 'grid_snapshot'
  | 'manifest';

export interface EvidenceItem {
  /** Stable within a run, e.g. `E-UI-03`. */
  id: string;
  kind: EvidenceKind;
  /** Business-readable caption, in the project's report language. */
  label: string;
  /** Path relative to the store's `rootDir`, with forward slashes. */
  relPath: string;
  sizeBytes: number;
  contentHash: string;
  capturedAt: string;
  /** Index into the run's steps, when this evidence belongs to one step. */
  stepIndex?: number;
  /** Assertion this evidence proves, e.g. `TC-ORD-U01 / A2`. */
  checkTestId?: string;
}

export interface EvidenceManifest {
  schemaVersion: 1;
  runId: string;
  scenario: string;
  generatedAt: string;
  webBaseUrl: string;
  browser: { name: string; version: string };
  items: EvidenceItem[];
  diagnosticsSummary: {
    pageErrors: number;
    consoleErrors: number;
    failedRequests: number;
    blockedRequests: number;
  };
  /**
   * Set when console capture is known to be unreliable — e.g. a production build that strips
   * console calls. Keeps a reader from reading "0 console errors" as "no problems".
   */
  consoleCaptureNote?: string;
}
