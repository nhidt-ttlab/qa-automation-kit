import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SyncModule } from '../sync/sync.module';
import { RegressionJobsController } from './regression-jobs.controller';
import { RegressionJobsService } from './regression-jobs.service';
import { RegressionJobRunnerService } from './regression-job-runner.service';
import { RunnerWorkspaceSyncService } from './runner-workspace-sync.service';

/**
 * Triggering a runner batch from the web UI.
 *
 * The two services are split by what they own rather than by layer: RegressionJobsService owns
 * Prisma and answers HTTP, RegressionJobRunnerService owns the child process and the state
 * machine. Only the runner service imports SyncModule, because the sync is part of finishing a
 * job, not part of serving a request. RunnerWorkspaceSyncService owns `git` for the runner
 * checkout ("sync test scripts") and nothing else.
 */
@Module({
  imports: [DatabaseModule, SyncModule],
  controllers: [RegressionJobsController],
  providers: [RegressionJobsService, RegressionJobRunnerService, RunnerWorkspaceSyncService],
  exports: [RegressionJobsService],
})
export class RegressionJobsModule {}
