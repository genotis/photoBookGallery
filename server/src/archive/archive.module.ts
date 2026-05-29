import { Module } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { ZipReader } from './zip.reader';
import { RarReader } from './rar.reader';
import { ZipWriter } from './zip.writer';

@Module({
  providers: [ArchiveService, ZipReader, RarReader, ZipWriter],
  exports: [ArchiveService, ZipWriter],
})
export class ArchiveModule {}
