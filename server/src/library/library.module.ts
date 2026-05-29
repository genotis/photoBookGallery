import { Module } from '@nestjs/common';
import { ArchiveModule } from '../archive/archive.module';
import { JobsModule } from '../jobs/jobs.module';
import { SearchModule } from '../search/search.module';
import { LibraryController } from './library.controller';
import { IndexerService } from './indexer.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ArchiveModule, JobsModule, SearchModule],
  controllers: [LibraryController],
  providers: [IndexerService, SchedulerService],
  exports: [IndexerService, SchedulerService],
})
export class LibraryModule {}
