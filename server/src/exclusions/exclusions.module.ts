import { Module } from '@nestjs/common';
import { ExclusionsController } from './exclusions.controller';
import { ExclusionsService } from './exclusions.service';

@Module({
  controllers: [ExclusionsController],
  providers: [ExclusionsService],
  exports: [ExclusionsService],
})
export class ExclusionsModule {}
