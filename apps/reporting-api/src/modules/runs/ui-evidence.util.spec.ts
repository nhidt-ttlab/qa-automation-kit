import {
  countScreenshots,
  findStoredItem,
  normalizeManifest,
  parseStoredUiEvidence,
  toPublicUiEvidence,
  toStoragePath,
  type SourceEvidenceManifest,
} from './ui-evidence.util';

const RUN_ID = 'run-mtd4bhg7-vuh9do';

function makeManifest(
  overrides: Partial<SourceEvidenceManifest> = {},
): SourceEvidenceManifest {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    scenario: 'ui-login-happy-path',
    generatedAt: '2026-08-28T15:40:32.855Z',
    webBaseUrl: 'https://app.example.test',
    browser: { name: 'chromium', version: 'chromium' },
    diagnosticsSummary: {
      pageErrors: 0,
      consoleErrors: 1,
      failedRequests: 3,
      blockedRequests: 0,
    },
    consoleCaptureNote: 'drop_console strips application console calls',
    items: [
      {
        id: 'E-UI-01',
        kind: 'screenshot',
        label: 'login-page',
        relPath: `evidence/ui-login-happy-path/${RUN_ID}/screenshots/S01-login-page.png`,
        sizeBytes: 1945178,
        contentHash: 'abc',
        capturedAt: '2026-08-28T15:40:13.992Z',
        stepIndex: 0,
        checkTestId: 'TC-UI-A01 / A1',
      },
      {
        id: 'E-UI-04',
        kind: 'network_har',
        label: 'HAR',
        relPath: `evidence/ui-login-happy-path/${RUN_ID}/network.har`,
        sizeBytes: 126659,
        contentHash: 'def',
        capturedAt: '2026-08-28T15:40:32.849Z',
      },
    ],
    ...overrides,
  };
}

describe('ui-evidence.util', () => {
  describe('normalizeManifest', () => {
    it('converts the 0-based stepIndex to a 1-based step_sequence', () => {
      // The manifest indexes into the runner's steps array; TestRunStep.sequence starts at 1.
      // Getting this wrong silently attaches every screenshot to the preceding step.
      const stored = normalizeManifest(makeManifest(), RUN_ID);
      expect(stored.items[0].step_sequence).toBe(1);
    });

    it('leaves step_sequence undefined for evidence not tied to a step', () => {
      const stored = normalizeManifest(makeManifest(), RUN_ID);
      expect(stored.items[1].step_sequence).toBeUndefined();
    });

    it('builds an API url and a storage path for each item', () => {
      const stored = normalizeManifest(makeManifest(), RUN_ID);
      expect(stored.items[0].url).toBe(
        `/api/runs/${RUN_ID}/ui-evidence/E-UI-01`,
      );
      expect(stored.items[0].storage_path).toBe(
        `ui-login-happy-path/${RUN_ID}/screenshots/S01-login-page.png`,
      );
    });

    it('carries the diagnostics summary and console capture note across', () => {
      const stored = normalizeManifest(makeManifest(), RUN_ID);
      expect(stored.diagnostics).toEqual({
        page_errors: 0,
        console_errors: 1,
        failed_requests: 3,
        blocked_requests: 0,
      });
      expect(stored.console_capture_note).toContain('drop_console');
    });

    it('drops the manifest entry and any unknown kind', () => {
      // A kind this API does not render should degrade to "not shown", never a broken link.
      const manifest = makeManifest({
        items: [
          ...makeManifest().items,
          {
            id: 'E-UI-09',
            kind: 'manifest',
            label: 'self',
            relPath: `evidence/ui-login-happy-path/${RUN_ID}/manifest.json`,
            sizeBytes: 10,
            contentHash: 'x',
            capturedAt: '2026-08-28T15:40:32.855Z',
          },
          {
            id: 'E-UI-10',
            kind: 'some_future_kind',
            label: 'future',
            relPath: `evidence/ui-login-happy-path/${RUN_ID}/future.bin`,
            sizeBytes: 10,
            contentHash: 'y',
            capturedAt: '2026-08-28T15:40:32.855Z',
          },
        ],
      });
      const ids = normalizeManifest(manifest, RUN_ID).items.map((i) => i.id);
      expect(ids).toEqual(['E-UI-01', 'E-UI-04']);
    });
  });

  describe('toStoragePath', () => {
    it('strips the leading evidence/ segment', () => {
      expect(toStoragePath('evidence/scenario/run/a.png')).toBe(
        'scenario/run/a.png',
      );
    });

    it('normalizes Windows separators', () => {
      expect(toStoragePath('evidence\\scenario\\run\\a.png')).toBe(
        'scenario/run/a.png',
      );
    });
  });

  describe('toPublicUiEvidence', () => {
    it('removes storage_path so the on-disk layout is not exposed', () => {
      const stored = normalizeManifest(makeManifest(), RUN_ID);
      const publicDto = toPublicUiEvidence(stored);
      expect(JSON.stringify(publicDto)).not.toContain('storage_path');
      expect(publicDto.items[0].url).toBe(stored.items[0].url);
    });
  });

  describe('parseStoredUiEvidence', () => {
    it.each([[null], [undefined], ['a string'], [42], [[]], [{}]])(
      'returns undefined for %p',
      (value) => {
        expect(parseStoredUiEvidence(value)).toBeUndefined();
      },
    );

    it('round-trips a stored record', () => {
      const stored = normalizeManifest(makeManifest(), RUN_ID);
      const parsed = parseStoredUiEvidence(JSON.parse(JSON.stringify(stored)));
      expect(parsed?.items).toHaveLength(2);
    });
  });

  describe('findStoredItem', () => {
    it('finds by item id and returns undefined for an unknown one', () => {
      const stored = normalizeManifest(makeManifest(), RUN_ID);
      expect(findStoredItem(stored, 'E-UI-01')?.kind).toBe('screenshot');
      expect(findStoredItem(stored, 'E-UI-99')).toBeUndefined();
    });
  });

  describe('countScreenshots', () => {
    it('counts only screenshots', () => {
      const stored = normalizeManifest(makeManifest(), RUN_ID);
      expect(countScreenshots(stored)).toBe(1);
    });

    it('returns undefined when the run has no stored evidence', () => {
      // An API run must show a blank cell, not a 0 that reads as "captured nothing".
      expect(countScreenshots(null)).toBeUndefined();
    });
  });
});
