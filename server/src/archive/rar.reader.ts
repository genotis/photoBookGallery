import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { createExtractorFromData } from 'node-unrar-js';
import { ArchiveReader, RawEntry } from './archive-reader.interface';

/**
 * RAR/CBR 읽기 전용 어댑터 (node-unrar-js, WASM).
 * 읽기만 지원하며 RAR 쓰기/수정은 불가능하다 (docs/04 참조).
 */
@Injectable()
export class RarReader implements ArchiveReader {
  private async loadData(archivePath: string): Promise<ArrayBuffer> {
    const buf = await readFile(archivePath);
    return buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
  }

  async listEntries(archivePath: string): Promise<RawEntry[]> {
    const data = await this.loadData(archivePath);
    const extractor = await createExtractorFromData({ data });
    const list = extractor.getFileList();
    return [...list.fileHeaders].map((h) => ({
      name: h.name,
      size: h.unpSize,
      isDirectory: h.flags.directory,
    }));
  }

  async readEntry(archivePath: string, entryName: string): Promise<Buffer> {
    const data = await this.loadData(archivePath);
    const extractor = await createExtractorFromData({ data });
    const extracted = extractor.extract({ files: [entryName] });
    const file = [...extracted.files].find((f) => f.extraction);
    if (!file?.extraction) {
      throw new NotFoundException(`엔트리를 찾을 수 없습니다: ${entryName}`);
    }
    return Buffer.from(file.extraction);
  }
}
