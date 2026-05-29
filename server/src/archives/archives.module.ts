import { Module } from '@nestjs/common';
import { ParserModule } from '../parser/parser.module';
import { SearchModule } from '../search/search.module';
import { ArchivesController } from './archives.controller';
import { ArchivesService } from './archives.service';

@Module({
  imports: [ParserModule, SearchModule],
  controllers: [ArchivesController],
  providers: [ArchivesService],
  exports: [ArchivesService],
})
export class ArchivesModule {}
