import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DatabaseModule } from '../../database/database.module';
import { ResolutionModule } from '../resolution/resolution.module';

@Module({
  imports: [DatabaseModule, ResolutionModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
