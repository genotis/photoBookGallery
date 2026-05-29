import { Module } from '@nestjs/common';
import { FilenameParserService } from './filename.parser';

@Module({
  providers: [FilenameParserService],
  exports: [FilenameParserService],
})
export class ParserModule {}
