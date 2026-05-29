import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { bullJobIdFor, QueueService } from './queue.service';

/**
 * 부팅 시 DB 의 미완료 Job 과 Redis 큐 상태를 대조해 고아 작업을 정리한다.
 * - 큐에 active/waiting/delayed 가 없는 running/pending Job 은 'failed' 로 마감.
 * - 정상 케이스(서버 재시작 직후)에는 BullMQ 가 active 작업을 stalled 처리해 다시
 *   처리하므로 reconciler 는 건드리지 않음.
 */
@Injectable()
export class JobReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(JobReconcilerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly jobs: JobsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 약간의 지연으로 워커가 등록되어 BullMQ 가 stalled 회복을 시작할 시간을 준다.
    setTimeout(() => {
      void this.reconcile().catch((e) =>
        this.logger.warn(`reconcile 실패: ${String(e)}`),
      );
    }, 1500);
  }

  private async reconcile(): Promise<void> {
    const open = await this.prisma.job.findMany({
      where: { status: { in: ['pending', 'running'] } },
      select: { id: true, type: true, status: true },
    });
    if (open.length === 0) return;

    let cleaned = 0;
    for (const j of open) {
      const q = this.queue.getQueue(j.type);
      const bj = await q.getJob(bullJobIdFor(j.id));
      if (!bj) {
        // BullMQ 에 흔적 없음 → 잃어버린 작업
        await this.jobs.fail(j.id, '서버 재시작으로 중단됨');
        cleaned += 1;
        continue;
      }
      const state = await bj.getState();
      if (state === 'completed') {
        await this.jobs.done(j.id);
      } else if (state === 'failed') {
        await this.jobs.fail(
          j.id,
          bj.failedReason ?? '큐에서 failed 상태로 발견',
        );
      }
      // active / waiting / delayed / paused 는 그대로 둠 — 워커가 처리할 것
    }
    if (cleaned > 0) {
      this.logger.log(`고아 Job ${cleaned}건 정리 완료`);
    }
  }
}
