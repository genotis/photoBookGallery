import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job as BullJob } from 'bullmq';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { detectArchiveFormat } from '../common/file.util';
import { hashFile } from '../common/hash.util';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { dbJobIdFrom, QueueService } from '../queue/queue.service';

const QUEUE = 'duplicates';

interface FileRecord {
  rootId: number;
  path: string;
  size: number;
  mtimeMs: number;
}

export interface DuplicateSet {
  contentHash: string;
  size: number;
  paths: { rootId: number; path: string }[];
}

export interface DuplicateScanResult {
  scannedAt: string;
  totalFiles: number;
  hashedFiles: number;
  reusedHashes: number;
  duplicateSets: DuplicateSet[];
}

@Injectable()
export class DuplicatesService implements OnModuleInit {
  private readonly logger = new Logger(DuplicatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker(QUEUE, (job) => this.process(job));
  }

  async startScan(): Promise<number> {
    const job = await this.jobs.create('duplicates', {});
    await this.queue.enqueue(QUEUE, job.id, {});
    return job.id;
  }

  private async process(bullJob: BullJob): Promise<void> {
    const jobId = dbJobIdFrom(bullJob.id);
    try {
      await this.run(jobId);
    } catch (err) {
      this.logger.error(`중복 탐지 실패 (job ${jobId})`, err as Error);
      await this.jobs.fail(jobId, err);
      throw err;
    }
  }

  /** 최근 완료된 duplicates 결과 (없으면 null) */
  async latest(): Promise<DuplicateScanResult | null> {
    const job = await this.prisma.job.findFirst({
      where: { type: 'duplicates', status: 'done' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!job?.payload) return null;
    try {
      const parsed = JSON.parse(job.payload) as {
        result?: DuplicateScanResult;
      };
      return parsed.result ?? null;
    } catch {
      return null;
    }
  }

  private async run(jobId: number): Promise<void> {
    await this.jobs.start(jobId);

    const roots = await this.prisma.libraryRoot.findMany();
    const all: FileRecord[] = [];
    for (const root of roots) {
      const files = await this.collectFiles(root.id, root.path);
      all.push(...files);
    }

    if (all.length === 0) {
      await this.persist(jobId, {
        scannedAt: new Date().toISOString(),
        totalFiles: 0,
        hashedFiles: 0,
        reusedHashes: 0,
        duplicateSets: [],
      });
      await this.jobs.done(jobId);
      return;
    }

    // DB 인덱스: 동일 path+size+mtime 면 저장된 contentHash 재사용
    const archives = await this.prisma.archive.findMany({
      select: {
        path: true,
        sizeBytes: true,
        mtime: true,
        contentHash: true,
      },
    });
    const cached = new Map<string, string>();
    for (const a of archives) {
      cached.set(
        `${a.path}|${a.sizeBytes.toString()}|${a.mtime.getTime()}`,
        a.contentHash,
      );
    }

    const hashByPath = new Map<string, string>();
    let hashedFiles = 0;
    let reusedHashes = 0;
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      const key = `${f.path}|${f.size}|${f.mtimeMs}`;
      const cachedHash = cached.get(key);
      if (cachedHash) {
        hashByPath.set(f.path, cachedHash);
        reusedHashes += 1;
      } else {
        try {
          hashByPath.set(f.path, await hashFile(f.path));
          hashedFiles += 1;
        } catch (e) {
          this.logger.warn(`해시 실패: ${f.path} — ${String(e)}`);
        }
      }
      if ((i + 1) % 10 === 0 || i + 1 === all.length) {
        await this.jobs.setProgress(jobId, (i + 1) / all.length);
      }
    }

    // 해시 → 경로[]
    const groups = new Map<string, FileRecord[]>();
    for (const f of all) {
      const h = hashByPath.get(f.path);
      if (!h) continue;
      const list = groups.get(h) ?? [];
      list.push(f);
      groups.set(h, list);
    }

    const duplicateSets: DuplicateSet[] = [];
    for (const [hash, files] of groups) {
      if (files.length < 2) continue;
      duplicateSets.push({
        contentHash: hash,
        size: files[0].size,
        paths: files.map((f) => ({ rootId: f.rootId, path: f.path })),
      });
    }
    duplicateSets.sort((a, b) => b.size * b.paths.length - a.size * a.paths.length);

    const result: DuplicateScanResult = {
      scannedAt: new Date().toISOString(),
      totalFiles: all.length,
      hashedFiles,
      reusedHashes,
      duplicateSets,
    };
    await this.persist(jobId, result);
    await this.jobs.done(jobId);
    this.logger.log(
      `중복 탐지 완료 (job ${jobId}): 파일 ${all.length}, 해시 신규 ${hashedFiles}, 재사용 ${reusedHashes}, ` +
        `중복군 ${duplicateSets.length}`,
    );
  }

  private async persist(jobId: number, result: DuplicateScanResult): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { payload: JSON.stringify({ result }) },
    });
  }

  private async collectFiles(
    rootId: number,
    rootPath: string,
  ): Promise<FileRecord[]> {
    const out: FileRecord[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (e) {
        this.logger.warn(`디렉터리 읽기 실패: ${dir} — ${String(e)}`);
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile() && detectArchiveFormat(e.name)) {
          try {
            const st = await stat(full);
            out.push({
              rootId,
              path: full,
              size: st.size,
              mtimeMs: st.mtime.getTime(),
            });
          } catch {
            // 사라진 파일 무시
          }
        }
      }
    };
    await walk(rootPath);
    return out;
  }
}
