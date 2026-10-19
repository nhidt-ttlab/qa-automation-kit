import fs from 'node:fs';
import path from 'node:path';
import type { RequestTraceEntry } from '../http/http-client.js';
import { redactObject, type Logger } from '../logger.js';
import { ensureDir, writeJsonPretty, type ArtifactLayout } from '../runner/artifact-layout.js';
import { writeRunToStore, type PersistRunHooks, type PersistRunMeta } from '../store/persist-run.js';
import { openRunStore, resolveGitInfo } from '../store/run-store.js';
import { createReportKit } from './report-kit.js';
import { timestampSlug, type ReportableResult } from './result.js';
import type { ReportWording } from './wording.js';

export interface RunWriteContext {
  trace: RequestTraceEntry[];
  runId: string;
  meta: PersistRunMeta;
  /** Manifest of the run's evidence folder, recorded with the run when the file exists. */
  evidenceManifestPath?: string;
}

export interface RunWriteResult {
  reportPath: string;
  outputPath: string;
  /** The stored run id, when the run reached the store. */
  runId?: string;
}

export type RunWriter = (result: ReportableResult, context: RunWriteContext) => RunWriteResult;

export interface RunWriterOptions {
  layout: ArtifactLayout;
  /** SQLite run store. Without it the run is written to disk only. */
  sqlitePath?: string;
  wording?: ReportWording;
  persistHooks?: PersistRunHooks;
  logger?: Pick<Logger, 'warn'>;
}

/**
 * Writes a finished run: the QA Markdown report and the redacted JSON run artifact under `reports/`
 * and `outputs/` (grouped by the layout), then the run in the SQLite store. A store failure is logged,
 * never thrown — the files are already on disk by then.
 */
export function createRunWriter(options: RunWriterOptions): RunWriter {
  const kit = createReportKit(options.wording);
  const { layout } = options;

  return (result, { trace, runId, meta, evidenceManifestPath }) => {
    const artifact = kit.buildRunArtifact(result, trace, runId);
    const group = layout.group(artifact.scenario);
    const reportDir = layout.dir('reports', group);
    const outputDir = layout.dir('outputs', group);
    ensureDir(reportDir);
    ensureDir(outputDir);

    const base = timestampSlug();
    const reportPath = path.join(reportDir, `${base}.md`);
    const outputPath = path.join(outputDir, `${base}.${artifact.runId}.json`);
    const model = kit.buildReportModel(result, trace, { runId: artifact.runId, reportPath, outputPath });

    fs.writeFileSync(reportPath, kit.renderQaMarkdown(model, result, trace, reportPath, outputPath), 'utf8');
    writeJsonPretty(outputPath, redactObject(artifact));

    if (!options.sqlitePath) return { reportPath, outputPath };
    try {
      const db = openRunStore(options.sqlitePath);
      try {
        const stored = writeRunToStore(db, {
          result,
          artifact,
          trace,
          model,
          paths: { reportPath, outputPath },
          meta,
          rootDir: layout.rootDir,
          grouping: { domain: group.domain },
          git: resolveGitInfo(layout.rootDir),
          evidenceManifestPath,
          buildEvidenceRows: kit.buildEvidenceRows,
          hooks: options.persistHooks,
        });
        return { reportPath, outputPath, runId: stored.runId };
      } finally {
        db.close();
      }
    } catch (error) {
      options.logger?.warn(`Run ${artifact.runId} was written to disk but not stored: ${error instanceof Error ? error.message : String(error)}`);
      return { reportPath, outputPath };
    }
  };
}
