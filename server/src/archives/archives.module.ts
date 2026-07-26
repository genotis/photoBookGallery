import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { ExclusionsModule } from '../exclusions/exclusions.module';
import { ArchivesController } from './archives.controller';
import { ArchivesService } from './archives.service';

@Module({
  imports: [SearchModule, ExclusionsModule],
  controllers: [ArchivesController],
  providers: [ArchivesService],
  exports: [ArchivesService],
})
export class ArchivesModule {}
