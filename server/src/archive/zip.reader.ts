import { Injectable, NotFoundException } from '@nestjs/common';
import StreamZip from 'node-stream-zip';
import { ArchiveReader, RawEntry } from './archive-reader.interface';
import { SerialQueue } from '../common/async.util';

/** 유휴 상태에서 열린 zip 핸들을 닫기까지의 시간. */
const IDLE_MS = 30_000;

type AsyncZip = InstanceType<typeof StreamZip.async>;

interface Handle {
  zip: AsyncZip;
  timer: NodeJS.Timeout;
}

/**
 * ZIP/CBZ 읽기 어댑터.
 * 열린 zip 핸들을 경로별로 캐시해 페이지마다 중앙 디렉터리를 재파싱하지 않는다
 * (페이지가 많은 사진집에서 재오픈 비용이 프리징의 큰 원인이었다).
 * 같은 아카이브의 읽기는 SerialQueue 로 직렬화해 단일 핸들 동시 접근을 막는다.
 * 재압축/재색인으로 파일이 바뀌면 evict() 로 캐시를 회수한다.
 */
@Injectable()
export class ZipReader implements ArchiveReader {
  private readonly handles = new Map<string, Handle>();
  private readonly serial = new SerialQueue();

  private scheduleClose(archivePath: string): NodeJS.Timeout {
    const t = setTimeout(() => void this.evict(archivePath), IDLE_MS);
    // 유휴 타이머가 프로세스 종료를 막지 않도록.
    if (typeof t.unref === 'function') t.unref();
    return t;
  }

  private getHandle(archivePath: string): Handle {
    const hit = this.handles.get(archivePath);
    if (hit) {
      clearTimeout(hit.timer);
      hit.timer = this.scheduleClose(archivePath);
      return hit;
    }
    const zip = new StreamZip.async({ file: archivePath });
    const handle: Handle = { zip, timer: this.scheduleClose(archivePath) };
    this.handles.set(archivePath, handle);
    return handle;
  }

  /** 캐시된 핸들을 닫고 제거. 파일 내용이 바뀌었을 때 호출. */
  async evict(archivePath: string): Promise<void> {
    const hit = this.handles.get(archivePath);
    if (!hit) return;
    this.handles.delete(archivePath);
    clearTimeout(hit.timer);
    try {
      await hit.zip.close();
    } catch {
      // 이미 닫혔거나 파일이 사라짐 — 무시
    }
  }

  async listEntries(archivePath: string): Promise<RawEntry[]> {
    return this.serial.run(archivePath, async () => {
      const { zip } = this.getHandle(archivePath);
      const entries = await zip.entries();
      return Object.values(entries).map((e) => ({
        name: e.name,
        size: e.size,
        isDirectory: e.isDirectory,
      }));
    });
  }

  async readEntry(archivePath: string, entryName: string): Promise<Buffer> {
    return this.serial.run(archivePath, async () => {
      try {
        return await this.read(archivePath, entryName);
      } catch (err) {
        // 캐시된 핸들이 상했을 수 있음(파일 교체 등) → 한 번만 새 핸들로 재시도.
        await this.evict(archivePath);
        if (err instanceof NotFoundException) throw err;
        return this.read(archivePath, entryName);
      }
    });
  }

  private async read(archivePath: string, entryName: string): Promise<Buffer> {
    const { zip } = this.getHandle(archivePath);
    const data = await zip.entryData(entryName);
    if (!data) {
      throw new NotFoundException(`엔트리를 찾을 수 없습니다: ${entryName}`);
    }
    return data;
  }
}
