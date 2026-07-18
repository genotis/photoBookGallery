import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import cron from 'node-cron';
import { PrismaService } from '../prisma/prisma.service';
import { ClassifyService } from './classify.service';

/**
 * 분류 규칙별 scanCron 에 따라 해당 규칙만 자동 실행한다.
 * scheduleOn && enabled && 유효한 cron 인 규칙만 등록.
 * 규칙 생성/수정/삭제 시 reload() 로 재구성. (SchedulerService 와 동일 패턴)
 */
@Injectable()
export class ClassifyScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClassifyScheduler.name);
  private tasks = new Map<number, cron.ScheduledTask>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly classify: ClassifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  onModuleDestroy(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
  }

  /** 현재 DB 상태에 맞춰 cron 작업을 재구성. 멱등. */
  async reload(): Promise<void> {
    const rules = await this.prisma.classifyRule.findMany({
      where: { scheduleOn: true, enabled: true, scanCron: { not: null } },
    });

    const wanted = new Set(rules.map((r) => r.id));
    for (const [id, task] of this.tasks) {
      if (!wanted.has(id)) {
        task.stop();
        this.tasks.delete(id);
      }
    }

    for (const rule of rules) {
      const expr = rule.scanCron!;
      if (!cron.validate(expr)) {
        this.logger.warn(
          `잘못된 cron 식 (rule ${rule.id}): ${expr} — 건너뜀`,
        );
        continue;
      }
      const existing = this.tasks.get(rule.id) as
        | (cron.ScheduledTask & { _expr?: string })
        | undefined;
      if (existing && existing._expr === expr) continue;
      if (existing) existing.stop();

      const task = cron.schedule(
        expr,
        () => {
          void this.classify
            .startApply({ ruleIds: [rule.id], force: true })
            .catch((e) =>
              this.logger.error(
                `예약 분류 실패 (rule ${rule.id})`,
                e as Error,
              ),
            );
        },
        { scheduled: true },
      ) as cron.ScheduledTask & { _expr?: string };
      task._expr = expr;
      this.tasks.set(rule.id, task);
      this.logger.log(`예약 분류 등록: rule ${rule.id} — '${expr}'`);
    }
  }

  /** cron 식 검증 — UI 입력 검증용 */
  static isValid(expr: string): boolean {
    return cron.validate(expr);
  }
}
