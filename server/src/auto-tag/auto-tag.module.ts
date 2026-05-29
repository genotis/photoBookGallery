import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ParserModule } from '../parser/parser.module';
import { SearchModule } from '../search/search.module';
import { AutoTagController } from './auto-tag.controller';
import { AutoTagService } from './auto-tag.service';

@Module({
  imports: [ParserModule, JobsModule, SearchModule],
  controllers: [AutoTagController],
  providers: [AutoTagService],
})
export class AutoTagModule {}
