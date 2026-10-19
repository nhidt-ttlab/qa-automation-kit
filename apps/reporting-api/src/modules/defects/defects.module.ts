import { Module } from '@nestjs/common';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [DefectsController],
  providers: [DefectsService],
  exports: [DefectsService],
})
export class DefectsModule {}
