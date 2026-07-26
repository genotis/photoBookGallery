import { Module } from '@nestjs/common';
import { ArchiveModule } from '../archive/archive.module';
import { ExclusionsModule } from '../exclusions/exclusions.module';
import { CacheGcService } from './cache-gc.service';
import { ImagesController } from './images.controller';
import { ThumbnailService } from './thumbnail.service';

@Module({
  imports: [ArchiveModule, ExclusionsModule],
  controllers: [ImagesController],
  providers: [ThumbnailService, CacheGcService],
  exports: [CacheGcService, ThumbnailService],
})
export class ImagesModule {}
