import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job as BullJob } from 'bullmq';
import { readdir, stat } from 'fs/promises';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { dbJobIdFrom, QueueService } from '../queue/queue.service';
import { ArchiveService } from '../archive/archive.service';
import { JobsService } from '../jobs/jobs.service';
import { SearchIndexService } from '../search/search-index.service';
import { detectArchiveFormat } from '../common/file.util';
import { hashFile } from '../common/hash.util';

interface IndexPayload {
  rootId: number;
}

const QUEUE = 'index';

@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: ArchiveService,
    private readonly jobs: JobsService,
    private readonly searchIndex: SearchIndexService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker<IndexPayload>(QUEUE, (job) =>
      this.process(job),
    );
  }

  /** DB Job 을 만들고 큐에 enqueue. 즉시 jobId 반환. */
  async startScan(rootId: number): Promise<number> {
    const job = await this.jobs.create('index', { rootId });
    await this.queue.enqueue<IndexPayload>(QUEUE, job.id, { rootId });
    return job.id;
  }

  private async process(bullJob: BullJob<IndexPayload>): Promise<void> {
    const jobId = dbJobIdFrom(bullJob.id);
    const { rootId } = bullJob.data;
    try {
      await this.runScan(jobId, rootId);
    } catch (err) {
      this.logger.error(`인덱싱 실패 (job ${jobId})`, err as Error);
      await this.jobs.fail(jobId, err);
      throw err;
    }
  }

  private async runScan(jobId: number, rootId: number): Promise<void> {
    const root = await this.prisma.libraryRoot.findUnique({
      where: { id: rootId },
    });
    if (!root) {
      await this.jobs.fail(jobId, '루트를 찾을 수 없습니다.');
      return;
    }

    await this.jobs.start(jobId);

    const files = await this.collectArchiveFiles(root.path);
    const seen: string[] = [];
    let processed = 0;

    for (const file of files) {
      try {
        await this.processFile(rootId, file);
        seen.push(file);
      } catch (err) {
        this.logger.warn(`아카이브 처리 실패: ${file} — ${String(err)}`);
      }
      processed += 1;
      if (processed % 5 === 0 || processed === files.length) {
        await this.jobs.setProgress(jobId, processed / Math.max(1, files.length));
      }
    }

    // 사라진 파일은 즉시 삭제하지 않고 missing 표시 (메타 보존)
    await this.prisma.archive.updateMany({
      where: { rootId, path: { notIn: seen } },
      data: { missing: true },
    });

    await this.jobs.done(jobId);
    this.logger.log(
      `인덱싱 완료 (root ${rootId}): ${seen.length}/${files.length} 처리`,
    );
  }

  /** 루트 하위를 재귀 순회하여 지원 아카이브 파일 경로 목록을 모은다. */
  private async collectArchiveFiles(rootPath: string): Promise<string[]> {
    const result: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile() && detectArchiveFormat(e.name)) {
          result.push(full);
        }
      }
    };
    await walk(rootPath);
    return result;
  }

  private async processFile(rootId: number, filePath: string): Promise<void> {
    const format = detectArchiveFormat(filePath);
    if (!format) {
      return;
    }

    const st = await stat(filePath);
    const sizeBytes = BigInt(st.size);
    const mtime = st.mtime;

    const existingByPath = await this.prisma.archive.findUnique({
      where: { path: filePath },
    });

    // 경로/크기/수정시각이 모두 동일하면 이미 인덱싱됨 → 스킵.
    // 단, 구버전 색인이라 직독 오프셋이 없으면 엔트리만 가볍게 보강(해시·썸네일 불변).
    if (
      existingByPath &&
      !existingByPath.missing &&
      existingByPath.sizeBytes === sizeBytes &&
      existingByPath.mtime.getTime() === mtime.getTime()
    ) {
      await this.backfillOffsetsIfNeeded(existingByPath.id, filePath, format);
      return;
    }

    const contentHash = await hashFile(filePath);
    const images = await this.archive.listImageEntries(filePath, format);
    const coverEntry = images[0]?.name ?? null;

    const data = {
      rootId,
      path: filePath,
      fileName: basename(filePath),
      format,
      sizeBytes,
      mtime,
      contentHash,
      pageCount: images.length,
      coverEntry,
      indexedAt: new Date(),
      missing: false,
    };

    // 동일 해시(이동/리네임) 또는 동일 경로(내용 변경) 레코드를 갱신
    const byHash = await this.prisma.archive.findUnique({
      where: { contentHash },
    });
    const target = byHash ?? existingByPath;

    const archiveId = target
      ? (await this.prisma.archive.update({ where: { id: target.id }, data }))
          .id
      : (await this.prisma.archive.create({ data })).id;

    await this.replaceEntries(
      archiveId,
      images.map((e, i) => ({
        name: e.name,
        order: i,
        sizeBytes: BigInt(e.size),
        // ZIP 직독용 위치(있을 때만). RAR 등은 undefined → null.
        method: e.method ?? null,
        locOffset: e.offset !== undefined ? BigInt(e.offset) : null,
        compSize:
          e.compressedSize !== undefined ? BigInt(e.compressedSize) : null,
      })),
    );
    await this.searchIndex.reindex(archiveId);
  }

  /**
   * 변경 없는 아카이브라도 직독 오프셋이 비어 있으면(구버전 색인) 엔트리만 재적재해
   * method/locOffset/compSize 를 채운다. 해시·표지·썸네일 캐시는 건드리지 않는다.
   * ZIP/CBZ 전용(RAR 등은 오프셋 직독을 안 쓰므로 대상 아님).
   */
  private async backfillOffsetsIfNeeded(
    archiveId: number,
    filePath: string,
    format: string,
  ): Promise<void> {
    if (format !== 'zip' && format !== 'cbz') return;
    const missing = await this.prisma.entry.findFirst({
      where: { archiveId, isImage: true, method: null },
      select: { id: true },
    });
    if (!missing) return;
    try {
      const images = await this.archive.listImageEntries(filePath, format);
      await this.replaceEntries(
        archiveId,
        images.map((e, i) => ({
          name: e.name,
          order: i,
          sizeBytes: BigInt(e.size),
          method: e.method ?? null,
          locOffset: e.offset !== undefined ? BigInt(e.offset) : null,
          compSize:
            e.compressedSize !== undefined ? BigInt(e.compressedSize) : null,
        })),
      );
      this.logger.log(`오프셋 보강: ${filePath}`);
    } catch (err) {
      this.logger.warn(`오프셋 보강 실패: ${filePath} — ${String(err)}`);
    }
  }

  private async replaceEntries(
    archiveId: number,
    entries: {
      name: string;
      order: number;
      sizeBytes: bigint;
      method: number | null;
      locOffset: bigint | null;
      compSize: bigint | null;
    }[],
  ): Promise<void> {
    await this.prisma.entry.deleteMany({ where: { archiveId } });
    if (entries.length) {
      await this.prisma.entry.createMany({
        data: entries.map((e) => ({ archiveId, ...e, isImage: true })),
      });
    }
  }
}
