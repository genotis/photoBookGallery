import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'fs/promises';
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
  private readonly cacheDir: string;

  constructor(
    config: ConfigService,
    private readonly archive: ArchiveService,
  ) {
    this.cacheDir = config.get<string>('cacheDir') ?? './cache';
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
