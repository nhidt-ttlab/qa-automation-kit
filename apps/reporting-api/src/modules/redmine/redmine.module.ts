import { Module } from '@nestjs/common';
import { RedmineController } from './redmine.controller';
import { RedmineService } from './redmine.service';
import { ISSUE_TRACKER } from './issue-tracker';
import { DatabaseModule } from '../../database/database.module';
import { DefectsModule } from '../defects/defects.module';

@Module({
  imports: [DatabaseModule, DefectsModule],
  controllers: [RedmineController],
  providers: [RedmineService, { provide: ISSUE_TRACKER, useExisting: RedmineService }],
  exports: [RedmineService, ISSUE_TRACKER],
})
export class RedmineModule {}
