import { Module } from '@nestjs/common';
import { ArchiveModule } from '../archive/archive.module';
import { JobsModule } from '../jobs/jobs.module';
import { LibraryController } from './library.controller';
import { IndexerService } from './indexer.service';

@Module({
  imports: [ArchiveModule, JobsModule],
  controllers: [LibraryController],
  providers: [IndexerService],
  exports: [IndexerService],
})
export class LibraryModule {}
