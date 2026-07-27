import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ArchiveReader,
  EntryLocation,
  RawEntry,
} from './archive-reader.interface';
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
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return this.reader(format).readEntry(archivePath, entryName, signal);
  }

  /**
   * ZIP 오프셋 직독 — 저장된 위치로 압축 라이브러리 없이 바로 읽는다.
   * ZIP/CBZ 전용. 실패(오프셋 낡음 등) 시 예외 → 호출측이 readEntry 로 폴백.
   */
  readEntryDirect(
    archivePath: string,
    loc: EntryLocation,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return this.zip.readEntryDirect(archivePath, loc, signal);
  }

  /**
   * 캐시된 압축 핸들을 회수. 파일이 교체/삭제됐을 때(재압축·재색인) 호출해
   * 낡은 핸들이 옛 내용을 서빙하지 않도록 한다. 포맷을 몰라도 안전하게
   * 모든 리더에서 회수한다.
   */
  async evict(archivePath: string): Promise<void> {
    await Promise.all([
      this.zip.evict?.(archivePath),
      this.rar.evict?.(archivePath),
    ]);
  }
}
