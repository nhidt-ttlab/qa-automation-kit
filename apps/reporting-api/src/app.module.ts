import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { RunsModule } from './modules/runs/runs.module';
import { TestCasesModule } from './modules/testcases/testcases.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { DefectsModule } from './modules/defects/defects.module';
import { RedmineModule } from './modules/redmine/redmine.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ResolutionModule } from './modules/resolution/resolution.module';
import { SearchModule } from './modules/search/search.module';
import { HealthModule } from './modules/health/health.module';
import { SyncModule } from './modules/sync/sync.module';
import { RegressionJobsModule } from './modules/regression-jobs/regression-jobs.module';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { reportingDataDir } from './common/reporting-data-dir';

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: path.join(reportingDataDir(), '.env') }),
    DatabaseModule,
    RunsModule,
    TestCasesModule,
    ReviewsModule,
    DefectsModule,
    RedmineModule,
    DashboardModule,
    ResolutionModule,
    SearchModule,
    HealthModule,
    SyncModule,
    RegressionJobsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
