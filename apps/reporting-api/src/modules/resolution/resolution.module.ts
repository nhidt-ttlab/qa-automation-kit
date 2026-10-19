import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ResolutionController } from './resolution.controller';
import { ResolutionService } from './resolution.service';
import { ResolutionProjectionService } from './resolution-projection.service';
import { ResolutionWorkflowService } from './resolution-workflow.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ResolutionController],
  // The projection is provided here even though only the CLI scripts drive it today: it belongs
  // to this module's domain, and exporting it keeps the dashboard/search modules from growing a
  // second copy of the grouping rules if they ever need to re-derive one.
  providers: [
    ResolutionService,
    ResolutionWorkflowService,
    ResolutionProjectionService,
  ],
  exports: [
    ResolutionService,
    ResolutionWorkflowService,
    ResolutionProjectionService,
  ],
})
export class ResolutionModule {}
