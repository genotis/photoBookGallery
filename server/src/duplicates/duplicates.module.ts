import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { DuplicatesController } from './duplicates.controller';
import { DuplicatesService } from './duplicates.service';

@Module({
  imports: [JobsModule],
  controllers: [DuplicatesController],
  providers: [DuplicatesService],
})
export class DuplicatesModule {}
