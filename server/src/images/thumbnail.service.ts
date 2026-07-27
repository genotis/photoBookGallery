import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { cpus } from 'os';
import { dirname, join } from 'path';
import sharp from 'sharp';
import { Archive } from '@prisma/client';
import { ArchiveService } from '../archive/archive.service';
import { hashString } from '../common/hash.util';
import { imageContentType } from '../common/file.util';
import { Semaphore, throwIfAborted } from '../common/async.util';

export type ImageSize = 'thumb' | 'preview' | 'full';

export interface RenderedImage {
  buffer: Buffer;
  contentType: string;
  etag: string;
}

const SIZE_WIDTH: Record<Exclude<ImageSize, 'full'>, number> = {
  thumb: 480,
  preview: 1600,
};

const SIZE_QUALITY: Record<Exclude<ImageSize, 'full'>, number> = {
  thumb: 72,
  preview: 82,
};

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);
  private readonly cacheDir: string;
  // 동시 렌더(압축풀기+sharp) 상한 — 요청이 몰려도 CPU 포화를 막는다.
  private readonly sem: Semaphore;

  constructor(
    config: ConfigService,
    private readonly archive: ArchiveService,
  ) {
    this.cacheDir = config.get<string>('cacheDir') ?? './cache';
    const configured = config.get<number>('imageConcurrency') ?? 0;
    const concurrency =
      configured && configured > 0
        ? configured
        : Math.max(2, cpus().length - 1);
    this.sem = new Semaphore(concurrency);
    this.logger.log(`이미지 렌더 동시성 = ${concurrency}`);
  }

  /**
   * 특정 콘텐츠해시·엔트리 조합의 캐시 파일을 모두 제거.
   * 재압축 후 이전 상태의 디스크 캐시를 즉시 회수하기 위해 호출.
   * 키 = hash("<contentHash>:<entryName>:<size>"). 모든 size 변형을 시도.
   */
  async purgeArchiveCache(
    contentHash: string,
    entryNames: string[],
  ): Promise<number> {
    const sizes: ImageSize[] = ['thumb', 'preview'];
    let removed = 0;
    for (const name of entryNames) {
      for (const size of sizes) {
        const key = await hashString(`${contentHash}:${name}:${size}`);
        const file = join(this.cacheDir, key.slice(0, 2), `${key}.webp`);
        try {
          await unlink(file);
          removed += 1;
        } catch {
          // 파일이 없어도 무시
        }
      }
    }
    if (removed) {
      this.logger.log(
        `캐시 ${removed}개 파일 제거 (contentHash=${contentHash.slice(0, 12)}…, ${entryNames.length}개 엔트리)`,
      );
    }
    return removed;
  }

  /**
   * 아카이브 내 이미지를 지정 크기로 렌더링. thumb/preview 는 WebP 로 변환 후
   * 디스크 캐시(키 = 콘텐츠해시+엔트리+크기). full 은 원본 그대로 반환.
   */
  async render(
    archive: Archive,
    entryName: string,
    size: ImageSize,
    signal?: AbortSignal,
  ): Promise<RenderedImage> {
    throwIfAborted(signal);

    if (size === 'full') {
      const release = await this.sem.acquire(signal);
      try {
        throwIfAborted(signal);
        const buffer = await this.archive.readEntry(
          archive.path,
          entryName,
          archive.format,
        );
        return {
          buffer,
          contentType: imageContentType(entryName),
          etag: await hashString(`${archive.contentHash}:${entryName}:full`),
        };
      } finally {
        release();
      }
    }

    const key = await hashString(
      `${archive.contentHash}:${entryName}:${size}`,
    );
    const file = join(this.cacheDir, key.slice(0, 2), `${key}.webp`);

    // 캐시 히트는 세마포어 밖에서 즉시 처리(가벼운 파일 읽기).
    if (existsSync(file)) {
      return {
        buffer: await readFile(file),
        contentType: 'image/webp',
        etag: key,
      };
    }

    // 캐시 미스 — 압축풀기+sharp 는 동시성 제한 안에서. 취소되면 대기 중 탈출.
    const release = await this.sem.acquire(signal);
    try {
      throwIfAborted(signal);
      // 대기하는 동안 다른 요청이 이미 만들어 놨을 수 있으니 재확인.
      if (existsSync(file)) {
        return {
          buffer: await readFile(file),
          contentType: 'image/webp',
          etag: key,
        };
      }

      const raw = await this.archive.readEntry(
        archive.path,
        entryName,
        archive.format,
      );
      throwIfAborted(signal);

      const buffer = await sharp(raw)
        .rotate() // EXIF 방향 보정
        .resize({ width: SIZE_WIDTH[size], withoutEnlargement: true })
        .webp({ quality: SIZE_QUALITY[size] })
        .toBuffer();
      throwIfAborted(signal);

      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, buffer);

      return { buffer, contentType: 'image/webp', etag: key };
    } finally {
      release();
    }
  }
}
