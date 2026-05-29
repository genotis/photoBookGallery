import { Injectable, NotFoundException } from '@nestjs/common';
import StreamZip from 'node-stream-zip';
import { ArchiveReader, RawEntry } from './archive-reader.interface';

@Injectable()
export class ZipReader implements ArchiveReader {
  async listEntries(archivePath: string): Promise<RawEntry[]> {
    const zip = new StreamZip.async({ file: archivePath });
    try {
      const entries = await zip.entries();
      return Object.values(entries).map((e) => ({
        name: e.name,
        size: e.size,
        isDirectory: e.isDirectory,
      }));
    } finally {
      await zip.close();
    }
  }

  async readEntry(archivePath: string, entryName: string): Promise<Buffer> {
    const zip = new StreamZip.async({ file: archivePath });
    try {
      const data = await zip.entryData(entryName);
      if (!data) {
        throw new NotFoundException(`엔트리를 찾을 수 없습니다: ${entryName}`);
      }
      return data;
    } finally {
      await zip.close();
    }
  }
}
