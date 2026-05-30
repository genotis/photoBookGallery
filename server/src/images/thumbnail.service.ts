import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import sharp from 'sharp';
import { Archive } from '@prisma/client';
import { ArchiveService } from '../archive/archive.service';
import { hashString } from '../common/hash.util';
import { imageContentType } from '../common/file.util';

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

  constructor(
    config: ConfigService,
    private readonly archive: ArchiveService,
  ) {
    this.cacheDir = config.get<string>('cacheDir') ?? './cache';
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
  ): Promise<RenderedImage> {
    if (size === 'full') {
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
    }

    const key = await hashString(
      `${archive.contentHash}:${entryName}:${size}`,
    );
    const file = join(this.cacheDir, key.slice(0, 2), `${key}.webp`);

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
    const buffer = await sharp(raw)
      .rotate() // EXIF 방향 보정
      .resize({ width: SIZE_WIDTH[size], withoutEnlargement: true })
      .webp({ quality: SIZE_QUALITY[size] })
      .toBuffer();

    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, buffer);

    return { buffer, contentType: 'image/webp', etag: key };
  }
}
