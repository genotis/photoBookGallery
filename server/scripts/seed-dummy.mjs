#!/usr/bin/env node
/**
 * 로컬 테스트용 더미 사진집 생성기.
 *
 * 사용:
 *   npm run seed:dummy             # 저장소 루트에서
 *   node server/scripts/seed-dummy.mjs [outDir]
 *
 * 기본 출력 경로는 <저장소 루트>/dev-data/photobooks (.gitignore 처리됨).
 * sharp 로 단색 이미지를 만들고 archiver 로 .cbz 패키징한다.
 * 같은 outDir 로 재실행하면 기존 파일을 덮어쓴다.
 */

import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
// server/scripts → 저장소 루트는 두 단계 위
const REPO_ROOT = resolve(HERE, '../..');
const outDir = process.argv[2]
  ? resolve(process.argv[2])
  : join(REPO_ROOT, 'dev-data/photobooks');

const PALETTE = [
  { r: 232, g: 84, b: 92 },
  { r: 245, g: 196, b: 66 },
  { r: 96, g: 188, b: 138 },
  { r: 95, g: 158, b: 217 },
  { r: 178, g: 132, b: 218 },
  { r: 80, g: 80, b: 90 },
];

/**
 * @typedef {{ folder: string; file: string; pages: number; hint: string }} Spec
 */

/** @type {Spec[]} */
const SPECS = [
  {
    folder: 'Studio A',
    file: '[Studio A] Aoi - 봄 화보 vol1.cbz',
    pages: 12,
    hint: 'spring',
  },
  {
    folder: 'Studio A',
    file: '[Studio A] Aoi - 여름 화보 vol2.cbz',
    pages: 8,
    hint: 'summer',
  },
  {
    folder: 'Studio B',
    file: '[Studio B] Hina - 콜렉션 2025.cbz',
    pages: 16,
    hint: 'collection',
  },
  {
    folder: 'Magazine',
    file: '[Weekly] Mio & Yui - 합본.cbz',
    pages: 10,
    hint: 'magazine',
  },
  {
    folder: 'Magazine',
    file: '[Monthly] Yui - 표지 2024-11.cbz',
    pages: 6,
    hint: 'cover',
  },
];

const xmlEscape = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function makePage(spec, index) {
  const color = PALETTE[index % PALETTE.length];
  const text = xmlEscape(`${spec.hint} ${String(index + 1).padStart(2, '0')}`);
  const subtitle = xmlEscape(spec.file);
  const svg = `<svg width="800" height="1200" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgb(${color.r},${color.g},${color.b})"/><text x="50%" y="50%" font-family="sans-serif" font-size="84" fill="white" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${text}</text><text x="50%" y="68%" font-family="sans-serif" font-size="36" fill="rgba(255,255,255,0.7)" text-anchor="middle">${subtitle}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

async function buildCbz(spec) {
  const filePath = join(outDir, spec.folder, spec.file);
  await mkdir(dirname(filePath), { recursive: true });

  const pages = await Promise.all(
    Array.from({ length: spec.pages }, (_, i) => makePage(spec, i)),
  );

  await new Promise((resolveOuter, rejectOuter) => {
    const out = createWriteStream(filePath);
    const zip = archiver('zip', { store: true });
    let settled = false;
    const fail = (err) => {
      if (!settled) {
        settled = true;
        rejectOuter(err);
      }
    };
    out.on('close', () => {
      if (!settled) {
        settled = true;
        resolveOuter();
      }
    });
    out.on('error', fail);
    zip.on('error', fail);
    zip.pipe(out);
    pages.forEach((buf, i) => {
      zip.append(buf, { name: `page_${String(i + 1).padStart(2, '0')}.jpg` });
    });
    void zip.finalize();
  });

  return { filePath, pages: spec.pages };
}

async function main() {
  console.log(`[seed] 출력 경로: ${outDir}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const spec of SPECS) {
    const { filePath, pages } = await buildCbz(spec);
    console.log(`[seed]  ✓ ${pages}p  ${filePath}`);
  }

  console.log('');
  console.log('[seed] 완료. 앱 헤더 > 설정에서 루트 경로로 다음을 추가하세요:');
  console.log(`       ${outDir}`);
}

main().catch((err) => {
  console.error('[seed] 실패:', err);
  process.exit(1);
});
