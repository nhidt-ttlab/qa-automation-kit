import { Injectable } from '@nestjs/common';
import { ConflictError } from '@qakit/reporting-shared';
import { PrismaService } from '../../prisma.service';
import { ResolutionProjectionService } from '../resolution/resolution-projection.service';
import {
  resolveArtifactStorageRoot,
  resolveRegressionSqlitePath,
} from '../runs/artifact-storage.util';
import { resolveEvidenceStorageRoot } from '../runs/evidence-storage.util';
import { syncFromSqlite, type SqliteSyncReport } from './sqlite-sync';

export interface RunSyncOptions {
  repairResolution?: boolean;
  onProgress?: (message: string) => void;
}

/**
 * The in-process entry point to the SQLite -> Postgres import.
 *
 * The same work is still available as `pnpm db:sync`; this exists so a regression job can run the
 * sync itself the moment its batch ends, streaming the progress into the job's live log, without
 * shelling out to a second Node process (which would need pnpm and ts-node on the deployed host,
 * and would open a second Postgres pool per job).
 */
@Injectable()
export class SqliteSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ResolutionProjectionService,
  ) {}

  /**
   * The sync is idempotent, so a concurrent second pass is not a correctness problem — but it
   * doubles the work and interleaves two sets of progress lines into one unreadable log. The API
   * runs single-instance under PM2, so an in-memory flag is sufficient here.
   */
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  async sync(options: RunSyncOptions = {}): Promise<SqliteSyncReport> {
    if (this.running) {
      throw new ConflictError('A database sync is already running');
    }
    this.running = true;
    try {
      return await syncFromSqlite({
        prisma: this.prisma,
        projection: this.projection,
        sqlitePath: resolveRegressionSqlitePath(),
        runnerRoot: resolveArtifactStorageRoot(),
        evidenceRoot: resolveEvidenceStorageRoot(),
        repairResolution: options.repairResolution,
        onProgress: options.onProgress,
      });
    } finally {
      this.running = false;
    }
  }
}
