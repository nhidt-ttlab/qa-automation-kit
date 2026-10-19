import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ResolutionModule } from '../resolution/resolution.module';
import { SqliteSyncService } from './sqlite-sync.service';

/**
 * The SQLite -> Postgres import, as a service rather than only a CLI script.
 *
 * No controller: nothing here is reachable over HTTP on its own. The sync is triggered either by
 * `pnpm db:sync` (which calls the same `syncFromSqlite` through a thin wrapper) or by a
 * regression job, which runs it before a clean-all wipe and again after its batch.
 */
@Module({
  imports: [DatabaseModule, ResolutionModule],
  providers: [SqliteSyncService],
  exports: [SqliteSyncService],
})
export class SyncModule {}
