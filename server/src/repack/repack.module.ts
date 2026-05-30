import { Module } from '@nestjs/common';
import { ArchiveModule } from '../archive/archive.module';
import { ImagesModule } from '../images/images.module';
import { JobsModule } from '../jobs/jobs.module';
import { SearchModule } from '../search/search.module';
import { RepackController } from './repack.controller';
import { RepackLock } from './repack-lock';
import { RepackService } from './repack.service';

@Module({
  imports: [ArchiveModule, ImagesModule, JobsModule, SearchModule],
  controllers: [RepackController],
  providers: [RepackService, RepackLock],
})
export class RepackModule {}
