import { Module } from '@nestjs/common';
import { TestCasesController } from './testcases.controller';
import { TestCasesService } from './testcases.service';
import { DatabaseModule } from '../../database/database.module';
import { RunsModule } from '../runs/runs.module';

@Module({
  imports: [DatabaseModule, RunsModule],
  controllers: [TestCasesController],
  providers: [TestCasesService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
