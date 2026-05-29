import { BadRequestException, Injectable } from '@nestjs/common';
import { ArchiveReader, RawEntry } from './archive-reader.interface';
import { ZipReader } from './zip.reader';
import { RarReader } from './rar.reader';
import { isImageEntry, naturalCompare } from '../common/file.util';

@Injectable()
export class ArchiveService {
  constructor(
    private readonly zip: ZipReader,
    private readonly rar: RarReader,
  ) {}

  private reader(format: string): ArchiveReader {
    switch (format) {
      case 'zip':
      case 'cbz':
        return this.zip;
      case 'rar':
      case 'cbr':
        return this.rar;
      default:
        throw new BadRequestException(`지원하지 않는 포맷: ${format}`);
    }
  }

  /** 아카이브 내 이미지 엔트리를 자연 정렬하여 반환. */
  async listImageEntries(
    archivePath: string,
    format: string,
  ): Promise<RawEntry[]> {
    const all = await this.reader(format).listEntries(archivePath);
    return all
      .filter((e) => !e.isDirectory && isImageEntry(e.name))
      .sort((a, b) => naturalCompare(a.name, b.name));
  }

  readEntry(
    archivePath: string,
    entryName: string,
    format: string,
  ): Promise<Buffer> {
    return this.reader(format).readEntry(archivePath, entryName);
  }
}
