import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import StreamZip from 'node-stream-zip';
import { ArchiveReader, RawEntry } from './archive-reader.interface';
import { AbortError, SerialQueue, throwIfAborted } from '../common/async.util';

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

  async readEntry(
    archivePath: string,
    entryName: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    throwIfAborted(signal);
    return this.serial.run(archivePath, async () => {
      try {
        return await this.read(archivePath, entryName, signal);
      } catch (err) {
        if (err instanceof AbortError) throw err;
        // 캐시된 핸들이 상했을 수 있음(파일 교체 등) → 한 번만 새 핸들로 재시도.
        await this.evict(archivePath);
        if (err instanceof NotFoundException) throw err;
        return this.read(archivePath, entryName, signal);
      }
    });
  }

  /**
   * 엔트리를 스트림으로 읽어 버퍼로 모은다(랜덤 액세스 — 중앙 디렉터리로 오프셋
   * 탐색). abort 되면 스트림을 destroy 해 진행 중 inflate 를 즉시 중단한다.
   */
  private async read(
    archivePath: string,
    entryName: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const { zip } = this.getHandle(archivePath);
    const stream = (await zip.stream(entryName)) as Readable;
    return new Promise<Buffer>((resolve, reject) => {
      if (signal?.aborted) {
        stream.destroy();
        reject(new AbortError());
        return;
      }
      const chunks: Buffer[] = [];
      const cleanup = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        stream.destroy();
        cleanup();
        reject(new AbortError());
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        cleanup();
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', (e) => {
        cleanup();
        reject(signal?.aborted ? new AbortError() : e);
      });
    });
  }
}
