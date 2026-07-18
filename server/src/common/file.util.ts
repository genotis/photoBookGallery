import { copyFile, rename, unlink } from 'fs/promises';
import { extname } from 'path';

export const ARCHIVE_FORMATS = ['zip', 'cbz', 'rar', 'cbr'] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.bmp',
]);

/** 파일명 확장자로 아카이브 포맷을 판별. 지원하지 않으면 null. */
export function detectArchiveFormat(fileName: string): ArchiveFormat | null {
  const ext = extname(fileName).toLowerCase().replace('.', '');
  return (ARCHIVE_FORMATS as readonly string[]).includes(ext)
    ? (ext as ArchiveFormat)
    : null;
}

export function isImageEntry(name: string): boolean {
  return IMAGE_EXTS.has(extname(name).toLowerCase());
}

export function imageContentType(name: string): string {
  const ext = extname(name).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'image/jpeg';
  }
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** 자연 정렬 비교 (page2 < page10). */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** 같은 파일시스템이면 원자 rename, 파일시스템이 다르면(EXDEV) copy+unlink. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') throw err;
    await copyFile(from, to);
    await unlink(from);
  }
}
