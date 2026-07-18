import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { SearchModule } from '../search/search.module';
import { ClassifyController } from './classify.controller';
import { ClassifyScheduler } from './classify-scheduler.service';
import { ClassifyService } from './classify.service';

@Module({
  imports: [JobsModule, SearchModule],
  controllers: [ClassifyController],
  providers: [ClassifyService, ClassifyScheduler],
  exports: [ClassifyService],
})
export class ClassifyModule {}
