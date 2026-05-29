import { Module } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { ZipReader } from './zip.reader';
import { RarReader } from './rar.reader';

@Module({
  providers: [ArchiveService, ZipReader, RarReader],
  exports: [ArchiveService],
})
export class ArchiveModule {}
