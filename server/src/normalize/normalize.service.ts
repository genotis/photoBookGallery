import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job as BullJob } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { dbJobIdFrom, QueueService } from '../queue/queue.service';
import { RepackService } from '../repack/repack.service';

const QUEUE = 'normalize';

// 비-store(압축) 후보: zip/cbz 이고 이미지 엔트리 중 method != 0(=압축)이 하나라도.
// method=null(미보강/RAR)은 NOT IN 특성상 제외되므로, 재스캔으로 오프셋 보강된
// 아카이브만 대상이 된다.
const CANDIDATE_WHERE: Prisma.ArchiveWhereInput = {
  missing: false,
  format: { in: ['zip', 'cbz'] },
  entries: { some: { isImage: true, method: { notIn: [0] } } },
};

interface LiveProgress {
  total: number;
  done: number;
  converted: number;
  failed: number;
}

/**
 * Deflate→Store 정규화 배치. 압축이 걸린(0%짜리 순수 낭비) 아카이브를 무압축
 * .cbz 로 재작성해, 오프셋 직독이 순수 바이트 읽기가 되도록 라이브러리를 통일한다.
 * 단일 BullMQ 잡이 후보를 하나씩 순차 처리(NAS 스로틀) — 재시작하면 남은 후보를
 * 다시 조회하므로 자연 재개된다. 인-프로세스 취소 플래그로 중단 가능.
 */
@Injectable()
export class NormalizeService implements OnModuleInit {
  private readonly logger = new Logger(NormalizeService.name);
  private readonly cancelling = new Set<number>();
  private readonly live = new Map<number, LiveProgress>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly queue: QueueService,
    private readonly repack: RepackService,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker(QUEUE, (job) => this.process(job));
  }

  candidateCount(): Promise<number> {
    return this.prisma.archive.count({ where: CANDIDATE_WHERE });
  }

  private async candidateIds(): Promise<number[]> {
    const rows = await this.prisma.archive.findMany({
      where: CANDIDATE_WHERE,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private runningJob() {
    return this.prisma.job.findFirst({
      where: { type: 'normalize', status: { in: ['pending', 'running'] } },
      orderBy: { id: 'desc' },
    });
  }

  /** 배치 시작(이미 실행 중이면 그 잡을 반환). */
  async start(): Promise<{ jobId: number; candidates: number; running: boolean }> {
    const candidates = await this.candidateCount();
    const running = await this.runningJob();
    if (running) return { jobId: running.id, candidates, running: true };
    if (candidates === 0) return { jobId: 0, candidates: 0, running: false };
    const job = await this.jobs.create('normalize', { total: candidates });
    await this.queue.enqueue(QUEUE, job.id, {});
    return { jobId: job.id, candidates, running: false };
  }

  async cancel(): Promise<{ ok: true; cancelled: boolean }> {
    const running = await this.runningJob();
    if (running) {
      this.cancelling.add(running.id);
      return { ok: true, cancelled: true };
    }
    return { ok: true, cancelled: false };
  }

  async status(): Promise<{
    job: { id: number; status: string; progress: number } | null;
    remaining: number;
    live: LiveProgress | null;
  }> {
    const job = await this.prisma.job.findFirst({
      where: { type: 'normalize' },
      orderBy: { id: 'desc' },
      select: { id: true, status: true, progress: true },
    });
    const remaining = await this.candidateCount();
    return {
      job,
      remaining,
      live: job ? (this.live.get(job.id) ?? null) : null,
    };
  }

  private async process(bullJob: BullJob): Promise<void> {
    const jobId = dbJobIdFrom(bullJob.id);
    try {
      await this.jobs.start(jobId);
      const ids = await this.candidateIds();
      const progress: LiveProgress = {
        total: ids.length,
        done: 0,
        converted: 0,
        failed: 0,
      };
      this.live.set(jobId, progress);
      this.logger.log(`정규화 배치 시작 (job ${jobId}): 후보 ${ids.length}건`);

      for (const id of ids) {
        if (this.cancelling.has(jobId)) {
          this.logger.log(`정규화 배치 취소됨 (job ${jobId})`);
          break;
        }
        try {
          const r = await this.repack.normalizeOne(id);
          if (r === 'converted') progress.converted += 1;
        } catch (e) {
          progress.failed += 1;
          this.logger.warn(`정규화 실패 (archive ${id}): ${String(e)}`);
        }
        progress.done += 1;
        await this.jobs.setProgress(
          jobId,
          progress.done / Math.max(1, ids.length),
        );
      }

      this.cancelling.delete(jobId);
      await this.jobs.done(jobId);
      this.logger.log(
        `정규화 배치 완료 (job ${jobId}): 변환 ${progress.converted}, ` +
          `실패 ${progress.failed}, 처리 ${progress.done}/${ids.length}`,
      );
    } catch (err) {
      this.cancelling.delete(jobId);
      await this.jobs.fail(jobId, err);
      throw err;
    }
  }
}
