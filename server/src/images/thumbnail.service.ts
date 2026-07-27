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
import { PriorityScheduler, throwIfAborted } from '../common/async.util';

/** 렌더 우선순위 — 낮을수록 먼저. 보이는 페이지 > 일반 > 프리페치. */
export type RenderPriority = 0 | 1 | 2;

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
  // 동시 렌더(압축풀기+sharp) 상한 — 우선순위 스케줄러로 관리.
  private readonly scheduler: PriorityScheduler;

  constructor(
    config: ConfigService,
    private readonly archive: ArchiveService,
  ) {
    this.cacheDir = config.get<string>('cacheDir') ?? './cache';

    // 동시성은 "낮게" 유지하는 게 핵심. 높으면 libuv 스레드풀(fs 캐시 읽기와
    // 공유, 기본 4)이 sharp 로 포화돼 캐시 히트·다음 사진집까지 굶고, 진행 중
    // 작업이 많아 취소가 무의미해진다. 낮으면 대부분의 프리페치가 대기열에 머물러
    // 사진집 전환 시 즉시 드롭되고, 보이는 페이지가 곧바로 실행된다.
    const configured = config.get<number>('imageConcurrency') ?? 0;
    const concurrency =
      configured && configured > 0
        ? configured
        : Math.max(2, Math.min(4, cpus().length - 1));
    this.scheduler = new PriorityScheduler(concurrency);

    // sharp 인스턴스당 libvips 스레드를 1개로 제한 → 스레드 폭증 방지.
    // 병렬성은 위 스케줄러가 관리하고, libuv 스레드풀 여유를 fs 에 남긴다.
    sharp.concurrency(1);

    this.logger.log(`이미지 렌더 동시성 = ${concurrency}, sharp concurrency = 1`);
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
    priority: RenderPriority = 1,
  ): Promise<RenderedImage> {
    throwIfAborted(signal);

    if (size === 'full') {
      const release = await this.scheduler.acquire(priority, signal);
      try {
        throwIfAborted(signal);
        const buffer = await this.archive.readEntry(
          archive.path,
          entryName,
          archive.format,
          signal,
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

    // 캐시 히트는 스케줄러 밖에서 즉시 처리(가벼운 파일 읽기).
    if (existsSync(file)) {
      return {
        buffer: await readFile(file),
        contentType: 'image/webp',
        etag: key,
      };
    }

    // 캐시 미스 — 압축풀기+sharp 는 동시성 제한 안에서. 취소되면 대기 중 탈출.
    const release = await this.scheduler.acquire(priority, signal);
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
        signal,
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
