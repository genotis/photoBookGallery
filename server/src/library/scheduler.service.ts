import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import cron from 'node-cron';
import { PrismaService } from '../prisma/prisma.service';
import { IndexerService } from './indexer.service';

/**
 * 각 LibraryRoot 의 scanCron 식에 따라 인덱싱을 자동 트리거한다.
 * 부팅 시 / 루트가 추가/변경/삭제될 때 reload() 를 호출해 작업을 재구성.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private tasks = new Map<number, cron.ScheduledTask>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  onModuleDestroy(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
  }

  /** 현재 DB 상태에 맞춰 cron 작업들을 재구성. 멱등 */
  async reload(): Promise<void> {
    const roots = await this.prisma.libraryRoot.findMany({
      where: { scanCron: { not: null } },
    });

    const wanted = new Set(roots.map((r) => r.id));
    // 더 이상 필요 없는 task 제거
    for (const [id, task] of this.tasks) {
      if (!wanted.has(id)) {
        task.stop();
        this.tasks.delete(id);
      }
    }

    for (const root of roots) {
      const expr = root.scanCron!;
      if (!cron.validate(expr)) {
        this.logger.warn(`잘못된 cron 식 (root ${root.id}): ${expr} — 건너뜀`);
        continue;
      }
      // 기존 task 가 동일하면 그대로 두기 위해 expression 도 추적
      const existing = this.tasks.get(root.id) as
        | (cron.ScheduledTask & { _expr?: string })
        | undefined;
      if (existing && existing._expr === expr) continue;
      if (existing) existing.stop();

      const task = cron.schedule(
        expr,
        () => {
          void this.indexer.startScan(root.id).catch((e) => {
            this.logger.error(`예약 스캔 실패 (root ${root.id})`, e as Error);
          });
        },
        { scheduled: true },
      ) as cron.ScheduledTask & { _expr?: string };
      task._expr = expr;
      this.tasks.set(root.id, task);
      this.logger.log(`예약 스캔 등록: root ${root.id} — '${expr}'`);
    }
  }

  /** cron 식 검증 — UI 입력 검증용 */
  static isValid(expr: string): boolean {
    return cron.validate(expr);
  }
}
