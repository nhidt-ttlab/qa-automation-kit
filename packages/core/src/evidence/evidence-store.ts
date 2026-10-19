import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EvidenceItem, EvidenceKind, EvidenceManifest } from './types.js';

export interface EvidenceStoreOptions {
  scenario: string;
  runId: string;
  webBaseUrl: string;
  /** Directory that `relPath`s are relative to — normally the project root. */
  rootDir: string;
  /** Absolute directory this run's evidence is written to. One per run, so nothing collides. */
  runDir: string;
  /** Prefix of item ids. Defaults to `E-UI`. */
  idPrefix?: string;
}

export type EvidenceItemMeta = { stepIndex?: number; checkTestId?: string };

export type EvidenceManifestInput = Omit<
  EvidenceManifest,
  'schemaVersion' | 'runId' | 'scenario' | 'generatedAt' | 'webBaseUrl' | 'items'
>;

/** Subdirectory per kind, so a run folder stays legible when opened by hand. */
const SUBDIR: Record<EvidenceKind, string> = {
  screenshot: 'screenshots',
  video: 'video',
  trace_zip: '.',
  console_log: '.',
  network_har: '.',
  dom_snapshot: 'dom',
  grid_snapshot: 'grid',
  manifest: '.',
};

/**
 * Writes run evidence to disk and keeps the manifest that indexes it.
 *
 * The manifest is what makes evidence useful rather than a folder dump: `stepIndex` and
 * `checkTestId` let a reader put a screenshot next to the assertion it proves.
 */
export class EvidenceStore {
  private readonly items: EvidenceItem[] = [];
  private sequence = 0;

  constructor(private readonly storeOptions: EvidenceStoreOptions) {}

  get dir(): string {
    return this.storeOptions.runDir;
  }

  /** Path relative to the root directory — for log lines and report links. */
  get displayDir(): string {
    return this.relativeToRoot(this.dir);
  }

  get manifestPath(): string {
    return path.join(this.dir, 'manifest.json');
  }

  /** Absolute path to write a new artifact of `kind` to, with parents created. */
  reserve(kind: EvidenceKind, filename: string): string {
    const target = path.join(this.dir, SUBDIR[kind], filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    return target;
  }

  /** Registers a file already on disk. Missing files are skipped, never fatal. */
  register(kind: EvidenceKind, absolutePath: string, label: string, meta: EvidenceItemMeta = {}): EvidenceItem | undefined {
    if (!fs.existsSync(absolutePath)) return undefined;
    const buffer = fs.readFileSync(absolutePath);
    const item: EvidenceItem = {
      id: this.nextId(),
      kind,
      label,
      relPath: this.relativeToRoot(absolutePath),
      contentHash: createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.length,
      capturedAt: new Date().toISOString(),
      ...meta,
    };
    this.items.push(item);
    return item;
  }

  /** Writes `content` as an artifact and registers it in one call. */
  writeAndRegister(
    kind: EvidenceKind,
    filename: string,
    content: string | Buffer,
    label: string,
    meta: EvidenceItemMeta = {},
  ): EvidenceItem | undefined {
    const target = this.reserve(kind, filename);
    fs.writeFileSync(target, content);
    return this.register(kind, target, label, meta);
  }

  list(): EvidenceItem[] {
    return [...this.items];
  }

  /** Writes manifest.json and returns its absolute path. */
  writeManifest(input: EvidenceManifestInput): string {
    const manifest: EvidenceManifest = {
      schemaVersion: 1,
      runId: this.storeOptions.runId,
      scenario: this.storeOptions.scenario,
      generatedAt: new Date().toISOString(),
      webBaseUrl: this.storeOptions.webBaseUrl,
      items: this.items,
      ...input,
    };
    const target = this.manifestPath;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
    return target;
  }

  /**
   * Deletes an artifact registered earlier — used for `retain-on-failure` trace/video on a passing
   * run, where keeping several MB per scenario per night is untenable.
   */
  discard(item: EvidenceItem | undefined): void {
    if (!item) return;
    const index = this.items.indexOf(item);
    if (index >= 0) this.items.splice(index, 1);
    try {
      fs.rmSync(path.join(this.storeOptions.rootDir, item.relPath), { force: true });
    } catch {
      // Best-effort cleanup: a locked file must never fail a run that already passed.
    }
  }

  private nextId(): string {
    this.sequence += 1;
    return `${this.storeOptions.idPrefix ?? 'E-UI'}-${String(this.sequence).padStart(2, '0')}`;
  }

  private relativeToRoot(absolutePath: string): string {
    return path.relative(this.storeOptions.rootDir, absolutePath).split(path.sep).join('/');
  }
}
