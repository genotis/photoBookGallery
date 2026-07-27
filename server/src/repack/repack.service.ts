import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job as BullJob } from 'bullmq';
import { mkdir, rename, stat, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path';
import sharp from 'sharp';
import { ArchiveService } from '../archive/archive.service';
import { ZipWriter } from '../archive/zip.writer';
import { moveFile } from '../common/file.util';
import { hashFile } from '../common/hash.util';
import { ThumbnailService } from '../images/thumbnail.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { dbJobIdFrom, QueueService } from '../queue/queue.service';
import { SearchIndexService } from '../search/search-index.service';
import { RepackLock } from './repack-lock';

interface RepackPayload {
  archiveId: number;
  excludeEntries: string[];
}

const QUEUE = 'repack';

function timestampSlug(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

@Injectable()
export class RepackService implements OnModuleInit {
  private readonly logger = new Logger(RepackService.name);
  private readonly backupRoot: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly archive: ArchiveService,
    private readonly zipWriter: ZipWriter,
    private readonly jobs: JobsService,
    private readonly lock: RepackLock,
    private readonly searchIndex: SearchIndexService,
    private readonly queue: QueueService,
    private readonly thumbnails: ThumbnailService,
  ) {
    this.backupRoot = config.get<string>('backupDir') ?? './backups';
  }

  onModuleInit(): void {
    this.queue.registerWorker<RepackPayload>(QUEUE, (job) => this.process(job));
  }

  /** DB Job 을 만들고 큐에 enqueue. 즉시 jobId 반환. */
  async start(archiveId: number, excludeEntries: string[]): Promise<number> {
    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
    });
    if (!archive) throw new NotFoundException('아카이브를 찾을 수 없습니다.');

    const job = await this.jobs.create('repack', {
      archiveId,
      excludeCount: excludeEntries.length,
    });
    await this.queue.enqueue<RepackPayload>(QUEUE, job.id, {
      archiveId,
      excludeEntries,
    });
    return job.id;
  }

  private async process(bullJob: BullJob<RepackPayload>): Promise<void> {
    const jobId = dbJobIdFrom(bullJob.id);
    const { archiveId, excludeEntries } = bullJob.data;
    try {
      // archiveId 단위 인-프로세스 락 — 동일 archive 동시 편집 직렬화
      await this.lock.run(archiveId, () =>
        this.run(jobId, archiveId, excludeEntries),
      );
    } catch (err) {
      this.logger.error(`재압축 실패 (job ${jobId})`, err as Error);
      await this.jobs.fail(jobId, err);
      throw err;
    }
  }

  private async run(
    jobId: number,
    archiveId: number,
    excludeEntries: string[],
  ): Promise<void> {
    await this.jobs.start(jobId);

    const archive = await this.prisma.archive.findUnique({
      where: { id: archiveId },
      include: { root: true },
    });
    if (!archive) throw new NotFoundException('아카이브를 찾을 수 없습니다.');
    if (archive.missing) {
      throw new Error('원본 파일이 사라져 재압축할 수 없습니다.');
    }

    const excludeSet = new Set(excludeEntries);
    const allEntries = await this.archive.listImageEntries(
      archive.path,
      archive.format,
    );
    const kept = allEntries.filter((e) => !excludeSet.has(e.name));
    if (kept.length === 0) {
      throw new Error('모든 이미지를 제외할 수 없습니다.');
    }
    if (kept.length === allEntries.length) {
      throw new Error('제외 대상이 비어 있어 재압축할 필요가 없습니다.');
    }

    await this.jobs.setProgress(jobId, 0.05);

    // 1) 임시 .cbz 생성 (같은 디렉터리 — 원자 이동 보장)
    const activeDir = dirname(archive.path);
    const baseName = basename(archive.path, extname(archive.path));
    const tempPath = join(activeDir, `.${baseName}.cbz.tmp.${process.pid}.${jobId}`);
    const finalPath = join(activeDir, `${baseName}.cbz`);

    // 엔트리 읽기 + 진행률 갱신
    const writeEntries = [] as { name: string; body: Buffer }[];
    let read = 0;
    for (const e of kept) {
      const body = await this.archive.readEntry(
        archive.path,
        e.name,
        archive.format,
      );
      writeEntries.push({ name: e.name, body });
      read += 1;
      // 0.05 → 0.6 구간을 읽기에 할당
      await this.jobs.setProgress(
        jobId,
        0.05 + 0.55 * (read / kept.length),
      );
    }

    try {
      await this.zipWriter.writeArchive(tempPath, writeEntries);
      await this.jobs.setProgress(jobId, 0.7);

      // 2) 무결성 검증
      await this.verifyArchive(tempPath, kept.length);
      await this.jobs.setProgress(jobId, 0.8);
    } catch (err) {
      await this.safeUnlink(tempPath);
      throw err;
    }

    // 3) 원본을 백업으로 이동
    const backupPath = this.backupPathFor(archive.root.path, archive.path);
    await mkdir(dirname(backupPath), { recursive: true });
    try {
      await moveFile(archive.path, backupPath);
    } catch (err) {
      await this.safeUnlink(tempPath);
      throw new Error(`백업 이동 실패: ${String(err)}`);
    }
    await this.jobs.setProgress(jobId, 0.85);

    // 4) 임시 → 활성 위치 (원자 교체)
    try {
      await rename(tempPath, finalPath);
    } catch (err) {
      // 활성 자리가 비어버렸으니 백업본을 원래 자리로 되돌린다(베스트 에포트)
      await moveFile(backupPath, archive.path).catch((restoreErr) =>
        this.logger.error('백업 복구 실패', restoreErr),
      );
      await this.safeUnlink(tempPath);
      throw new Error(`활성 위치 교체 실패: ${String(err)}`);
    }
    await this.jobs.setProgress(jobId, 0.9);

    // 캐시된 압축 핸들 회수 — 원본이 백업으로 빠지고 새 파일이 들어왔으므로,
    // 낡은 핸들이 옛 내용을 서빙하지 않도록 즉시 제거한다.
    await this.archive.evict(archive.path);
    if (finalPath !== archive.path) await this.archive.evict(finalPath);

    // 5) DB 갱신
    const newStat = await stat(finalPath);
    const newHash = await hashFile(finalPath);
    const newEntries = await this.archive.listImageEntries(finalPath, 'cbz');
    const newFileName = basename(finalPath);

    await this.prisma.$transaction(async (tx) => {
      await tx.archive.update({
        where: { id: archiveId },
        data: {
          path: finalPath,
          fileName: newFileName,
          format: 'cbz',
          sizeBytes: BigInt(newStat.size),
          mtime: newStat.mtime,
          contentHash: newHash,
          pageCount: newEntries.length,
          coverEntry: newEntries[0]?.name ?? null,
          missing: false,
          indexedAt: new Date(),
        },
      });
      await tx.entry.deleteMany({ where: { archiveId } });
      if (newEntries.length) {
        await tx.entry.createMany({
          data: newEntries.map((e, i) => ({
            archiveId,
            name: e.name,
            order: i,
            sizeBytes: BigInt(e.size),
            isImage: true,
          })),
        });
      }
    });
    await this.searchIndex.reindex(archiveId);

    // 6) 캐시 회수 — 이전 contentHash 로 만들어진 썸네일/프리뷰 파일은 더 이상
    //    접근 불가(키가 contentHash 에 묶여 있음)하므로 LRU 를 기다리지 않고 즉시 제거.
    //    새 contentHash 의 캐시는 다음 접근 때 생성된다.
    await this.thumbnails.purgeArchiveCache(
      archive.contentHash,
      allEntries.map((e) => e.name),
    );

    await this.jobs.done(jobId);
    this.logger.log(
      `재압축 완료 (archive ${archiveId}): ${allEntries.length} → ${newEntries.length} 페이지, ` +
        `백업=${backupPath}`,
    );
  }

  /** 백업 경로: <backupRoot>/<루트상대경로>.<timestamp>.<원본확장자> */
  private backupPathFor(rootPath: string, archivePath: string): string {
    const rel = relative(resolve(rootPath), resolve(archivePath));
    const safe = isAbsolute(rel) || rel.startsWith('..')
      ? basename(archivePath)
      : rel;
    const ext = extname(archivePath); // .cbr 등
    const ts = timestampSlug(new Date());
    return join(this.backupRoot, `${safe}.${ts}${ext}`);
  }

  /** 엔트리 수 일치 + 표본 디코드 성공 검증. */
  private async verifyArchive(
    archivePath: string,
    expectedCount: number,
  ): Promise<void> {
    const entries = await this.archive.listImageEntries(archivePath, 'cbz');
    if (entries.length !== expectedCount) {
      throw new Error(
        `엔트리 수 불일치: 기대 ${expectedCount}, 실제 ${entries.length}`,
      );
    }
    // 표본 1장: 마지막 엔트리를 디코드해 메타데이터 추출이 되는지 확인
    const sample = entries[entries.length - 1];
    if (sample) {
      const buf = await this.archive.readEntry(archivePath, sample.name, 'cbz');
      await sharp(buf).metadata();
    }
  }

  private async safeUnlink(path: string): Promise<void> {
    if (!existsSync(path)) return;
    try {
      await unlink(path);
    } catch (e) {
      this.logger.warn(`임시 파일 정리 실패: ${path} — ${String(e)}`);
    }
  }
}
