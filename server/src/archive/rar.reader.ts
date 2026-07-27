import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { createExtractorFromData, Extractor } from 'node-unrar-js';
import { ArchiveReader, RawEntry } from './archive-reader.interface';
import { SerialQueue } from '../common/async.util';

/** 유휴 상태에서 캐시된 추출기(WASM+전체 데이터)를 버리기까지의 시간. */
const IDLE_MS = 30_000;

interface Handle {
  extractor: Extractor<Uint8Array>;
  timer: NodeJS.Timeout;
}

/**
 * RAR/CBR 읽기 전용 어댑터 (node-unrar-js, WASM).
 * 추출기(전체 데이터를 WASM 메모리에 적재)를 경로별로 캐시해, 페이지마다 파일을
 * 통째로 다시 읽고 WASM 을 재초기화하던 비용을 없앤다. WASM 인스턴스는 동시
 * 호출에 안전하지 않으므로 SerialQueue 로 읽기를 직렬화한다.
 */
@Injectable()
export class RarReader implements ArchiveReader {
  private readonly handles = new Map<string, Handle>();
  private readonly serial = new SerialQueue();

  private scheduleClose(archivePath: string): NodeJS.Timeout {
    const t = setTimeout(() => void this.evict(archivePath), IDLE_MS);
    if (typeof t.unref === 'function') t.unref();
    return t;
  }

  private async getExtractor(
    archivePath: string,
  ): Promise<Extractor<Uint8Array>> {
    const hit = this.handles.get(archivePath);
    if (hit) {
      clearTimeout(hit.timer);
      hit.timer = this.scheduleClose(archivePath);
      return hit.extractor;
    }
    const buf = await readFile(archivePath);
    const data = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
    const extractor = await createExtractorFromData({ data });
    this.handles.set(archivePath, {
      extractor,
      timer: this.scheduleClose(archivePath),
    });
    return extractor;
  }

  async evict(archivePath: string): Promise<void> {
    const hit = this.handles.get(archivePath);
    if (!hit) return;
    this.handles.delete(archivePath);
    clearTimeout(hit.timer);
    // WASM 추출기는 명시적 close 가 없다 — 참조 제거로 GC 대상이 된다.
  }

  async listEntries(archivePath: string): Promise<RawEntry[]> {
    return this.serial.run(archivePath, async () => {
      const extractor = await this.getExtractor(archivePath);
      const list = extractor.getFileList();
      return [...list.fileHeaders].map((h) => ({
        name: h.name,
        size: h.unpSize,
        isDirectory: h.flags.directory,
      }));
    });
  }

  async readEntry(archivePath: string, entryName: string): Promise<Buffer> {
    return this.serial.run(archivePath, async () => {
      const extractor = await this.getExtractor(archivePath);
      const extracted = extractor.extract({ files: [entryName] });
      const file = [...extracted.files].find((f) => f.extraction);
      if (!file?.extraction) {
        throw new NotFoundException(`엔트리를 찾을 수 없습니다: ${entryName}`);
      }
      return Buffer.from(file.extraction);
    });
  }
}
