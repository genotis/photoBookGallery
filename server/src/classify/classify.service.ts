import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Archive, ClassifyRule, LibraryRoot } from '@prisma/client';
import { Job as BullJob } from 'bullmq';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { moveFile } from '../common/file.util';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { dbJobIdFrom, QueueService } from '../queue/queue.service';
import {
  ClassifyApplyDto,
  ClassifyPreviewDto,
  ClassifyRevertDto,
} from './dto/classify.dto';
import {
  compileMatcher,
  matchFile,
  renderTemplate,
  safeResolveUnderRoot,
  TemplateError,
} from './classify.util';

const QUEUE = 'classify';
const QUEUE_REVERT = 'classify-revert';

type RuleWithRoot = ClassifyRule & { root: LibraryRoot | null };
type ArchiveWithRoot = Archive & { root: LibraryRoot };

/** 컴파일된 규칙 — 매칭 엔진 내부 표현 */
interface CompiledRule {
  rule: RuleWithRoot;
  re: RegExp;
}

export type ResolveStatus =
  | 'move' // 이동 필요
  | 'noop' // 이미 목적지에 있음
  | 'conflict' // 목적지에 동명 파일 존재
  | 'error' // 템플릿/경로/권한 문제로 이동 불가
  | 'nomatch'; // 어떤 규칙에도 매칭 안 됨

export interface Resolution {
  status: ResolveStatus;
  rule: RuleWithRoot | null;
  /** 최종 파일 절대경로 (move/noop/conflict 일 때) */
  destPath: string | null;
  /** 루트 상대 목적지 디렉터리 (표시용) */
  destRel: string | null;
  message?: string;
}

export interface ClassifyPreviewItem {
  archiveId: number;
  fileName: string;
  currentPath: string;
  status: ResolveStatus;
  ruleId: number | null;
  ruleName: string | null;
  /** 목적지가 속한 루트 (= 아카이브의 루트). 규칙이 "모든 루트" 대상일 때 특히 유용. */
  rootId: number;
  rootLabel: string | null;
  rootPath: string;
  destPath: string | null;
  destRel: string | null;
  message?: string;
}

export interface ClassifyPreview {
  total: number; // 매칭되어 이동 대상이 되는 아카이브 수 (move + conflict + error)
  willMove: number;
  sampled: number;
  items: ClassifyPreviewItem[];
}

export interface ApplyStats {
  matched: number;
  moved: number;
  noop: number;
  conflicts: number;
  errors: number;
}

export interface RevertStats {
  total: number;
  reverted: number;
  conflicts: number;
  errors: number;
  skipped: number;
}

@Injectable()
export class ClassifyService implements OnModuleInit {
  private readonly logger = new Logger(ClassifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker<ClassifyApplyDto>(QUEUE, (job) =>
      this.process(job),
    );
    this.queue.registerWorker<ClassifyRevertDto>(QUEUE_REVERT, (job) =>
      this.processRevert(job),
    );
  }

  // ---- 규칙 CRUD 는 컨트롤러에서 직접 prisma 사용 ----

  /** enabled(또는 지정 id) 규칙을 우선순위 순으로 컴파일. 잘못된 패턴은 제외하고 경고. */
  private async compileRules(
    ruleIds: number[] | undefined,
    force: boolean,
  ): Promise<CompiledRule[]> {
    const rules = await this.prisma.classifyRule.findMany({
      where: {
        ...(ruleIds?.length ? { id: { in: ruleIds } } : {}),
        ...(force ? {} : { enabled: true }),
      },
      include: { root: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });

    const compiled: CompiledRule[] = [];
    for (const rule of rules) {
      try {
        compiled.push({ rule, re: compileMatcher(rule.matchType, rule.pattern) });
      } catch (e) {
        this.logger.warn(
          `분류 규칙 컴파일 실패 (rule ${rule.id} "${rule.name}"): ${String(e)}`,
        );
      }
    }
    return compiled;
  }

  /** 아카이브 하나에 대해 우선순위 첫 매칭 규칙을 찾아 목적지를 산출. */
  private resolve(
    archive: ArchiveWithRoot,
    rules: CompiledRule[],
  ): Resolution {
    for (const { rule, re } of rules) {
      // 루트 필터 — rule.rootId 가 지정되면 해당 루트 아카이브만
      if (rule.rootId != null && rule.rootId !== archive.rootId) continue;

      const { matched, tokens } = matchFile(re, archive.fileName);
      if (!matched) continue;

      // 첫 매칭 확정 — 이후 규칙은 보지 않는다 (우선순위 첫 매칭)
      const root = archive.root;
      if (root.readOnly) {
        return {
          status: 'error',
          rule,
          destPath: null,
          destRel: null,
          message: '읽기 전용 루트라 이동할 수 없습니다.',
        };
      }

      let destRel: string;
      try {
        destRel = renderTemplate(rule.destTemplate, tokens);
      } catch (e) {
        const msg =
          e instanceof TemplateError ? e.message : '템플릿 렌더링 실패';
        return { status: 'error', rule, destPath: null, destRel: null, message: msg };
      }

      const destDir = safeResolveUnderRoot(root.path, destRel);
      if (!destDir) {
        return {
          status: 'error',
          rule,
          destPath: null,
          destRel,
          message: '목적지가 루트를 벗어납니다.',
        };
      }

      const destPath = join(destDir, archive.fileName);

      // 이미 목적 디렉터리에 있으면 이동 불필요
      if (dirname(archive.path) === destDir) {
        return { status: 'noop', rule, destPath, destRel };
      }
      // 목적지에 동명 파일이 이미 있으면 덮어쓰지 않고 스킵
      if (existsSync(destPath)) {
        return {
          status: 'conflict',
          rule,
          destPath,
          destRel,
          message: '목적지에 동명 파일이 있습니다.',
        };
      }
      return { status: 'move', rule, destPath, destRel };
    }
    return { status: 'nomatch', rule: null, destPath: null, destRel: null };
  }

  /** 후보 아카이브 (미싱 제외) + 루트 포함 로드. */
  private loadCandidates(): Promise<ArchiveWithRoot[]> {
    return this.prisma.archive.findMany({
      where: { missing: false },
      include: { root: true },
      orderBy: { id: 'asc' },
    });
  }

  /** 변경 없이 어떤 아카이브가 어디로 이동할지 미리보기. */
  async preview(dto: ClassifyPreviewDto): Promise<ClassifyPreview> {
    const rules = await this.compileRules(dto.ruleIds, false);
    const candidates = await this.loadCandidates();
    const limit = dto.sampleLimit ?? 50;

    let total = 0;
    let willMove = 0;
    const items: ClassifyPreviewItem[] = [];

    for (const a of candidates) {
      const r = this.resolve(a, rules);
      if (r.status === 'nomatch' || r.status === 'noop') continue;
      total += 1;
      if (r.status === 'move') willMove += 1;
      if (items.length < limit) {
        items.push({
          archiveId: a.id,
          fileName: a.fileName,
          currentPath: a.path,
          status: r.status,
          ruleId: r.rule?.id ?? null,
          ruleName: r.rule?.name ?? null,
          rootId: a.rootId,
          rootLabel: a.root.label,
          rootPath: a.root.path,
          destPath: r.destPath,
          destRel: r.destRel,
          message: r.message,
        });
      }
    }

    return { total, willMove, sampled: items.length, items };
  }

  /** DB Job 생성 + 큐 enqueue. 즉시 jobId 반환. */
  async startApply(dto: ClassifyApplyDto): Promise<number> {
    const job = await this.jobs.create('classify', {
      ruleIds: dto.ruleIds ?? null,
      force: dto.force ?? false,
    });
    await this.queue.enqueue<ClassifyApplyDto>(QUEUE, job.id, dto);
    return job.id;
  }

  private async process(bullJob: BullJob<ClassifyApplyDto>): Promise<void> {
    const jobId = dbJobIdFrom(bullJob.id);
    try {
      await this.runApply(jobId, bullJob.data);
    } catch (err) {
      this.logger.error(`파일 분류 실패 (job ${jobId})`, err as Error);
      await this.jobs.fail(jobId, err);
      throw err;
    }
  }

  private async runApply(jobId: number, dto: ClassifyApplyDto): Promise<void> {
    await this.jobs.start(jobId);

    const rules = await this.compileRules(dto.ruleIds, dto.force ?? false);
    const candidates = await this.loadCandidates();

    const stats: ApplyStats = {
      matched: 0,
      moved: 0,
      noop: 0,
      conflicts: 0,
      errors: 0,
    };

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      const r = this.resolve(a, rules);
      try {
        switch (r.status) {
          case 'move':
            stats.matched += 1;
            await this.performMove(a, r.destPath!, r.rule, jobId);
            stats.moved += 1;
            break;
          case 'noop':
            stats.noop += 1;
            break;
          case 'conflict':
            stats.matched += 1;
            stats.conflicts += 1;
            this.logger.warn(
              `분류 스킵(충돌) archive=${a.id}: ${r.message} → ${r.destPath}`,
            );
            break;
          case 'error':
            stats.matched += 1;
            stats.errors += 1;
            this.logger.warn(`분류 스킵(오류) archive=${a.id}: ${r.message}`);
            break;
          default:
            break; // nomatch
        }
      } catch (e) {
        stats.errors += 1;
        this.logger.warn(`분류 이동 실패 archive=${a.id}: ${String(e)}`);
      }

      if ((i + 1) % 10 === 0 || i + 1 === candidates.length) {
        await this.jobs.setProgress(jobId, (i + 1) / Math.max(1, candidates.length));
      }
    }

    // 이번 실행에 참여한 규칙들의 lastRunAt 갱신
    const ranIds = rules.map((c) => c.rule.id);
    if (ranIds.length) {
      await this.prisma.classifyRule.updateMany({
        where: { id: { in: ranIds } },
        data: { lastRunAt: new Date() },
      });
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: { payload: JSON.stringify({ ...dto, stats }) },
    });
    await this.jobs.done(jobId);
    this.logger.log(
      `파일 분류 완료 (job ${jobId}): 이동 ${stats.moved}, 충돌 ${stats.conflicts}, ` +
        `오류 ${stats.errors}, 제자리 ${stats.noop}`,
    );
  }

  /**
   * 물리 이동 + DB 경로 갱신 + 이력 적재. 파일명은 그대로, 디렉터리만 변경.
   * contentHash 는 내용이 바뀌지 않아 불변 → 썸네일/프리뷰 캐시 그대로 유효.
   * 이동 성공 시 ClassifyMove 이력을 남겨 원복(undo) 가능하게 한다.
   */
  private async performMove(
    archive: ArchiveWithRoot,
    destPath: string,
    rule: RuleWithRoot | null,
    jobId: number,
  ): Promise<void> {
    const fromPath = archive.path;
    await mkdir(dirname(destPath), { recursive: true });
    await moveFile(fromPath, destPath);
    await this.prisma.$transaction([
      this.prisma.archive.update({
        where: { id: archive.id },
        data: { path: destPath, fileName: basename(destPath) },
      }),
      this.prisma.classifyMove.create({
        data: {
          archiveId: archive.id,
          contentHash: archive.contentHash,
          fileName: basename(destPath),
          fromPath,
          toPath: destPath,
          jobId,
          ruleId: rule?.id ?? null,
          ruleName: rule?.name ?? null,
          status: 'moved',
        },
      }),
    ]);
    this.logger.log(`이동: archive=${archive.id} ${fromPath} → ${destPath}`);
  }

  // ---- 이력 / 원복 ----

  /** 이동 이력 조회. 최신순. jobId 로 특정 실행만 필터 가능. */
  listHistory(opts: { jobId?: number; limit?: number }) {
    return this.prisma.classifyMove.findMany({
      where: opts.jobId !== undefined ? { jobId: opts.jobId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 200,
    });
  }

  /** DB Job 생성 + 원복 큐 enqueue. 즉시 jobId 반환. */
  async startRevert(dto: ClassifyRevertDto): Promise<number> {
    const job = await this.jobs.create('classify-revert', {
      moveIds: dto.moveIds ?? null,
      targetJobId: dto.jobId ?? null,
    });
    await this.queue.enqueue<ClassifyRevertDto>(QUEUE_REVERT, job.id, dto);
    return job.id;
  }

  private async processRevert(
    bullJob: BullJob<ClassifyRevertDto>,
  ): Promise<void> {
    const jobId = dbJobIdFrom(bullJob.id);
    try {
      await this.runRevert(jobId, bullJob.data);
    } catch (err) {
      this.logger.error(`분류 원복 실패 (job ${jobId})`, err as Error);
      await this.jobs.fail(jobId, err);
      throw err;
    }
  }

  private async runRevert(
    jobId: number,
    dto: ClassifyRevertDto,
  ): Promise<void> {
    await this.jobs.start(jobId);

    // 대상 이동 이력 로드 — status='moved' 만. 최신→과거 순으로 원복해
    // 같은 파일의 연속 이동(A→B→C)도 올바르게 역순 체이닝.
    const moves = await this.prisma.classifyMove.findMany({
      where: {
        status: 'moved',
        ...(dto.moveIds?.length ? { id: { in: dto.moveIds } } : {}),
        ...(dto.jobId !== undefined ? { jobId: dto.jobId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const stats: RevertStats = {
      total: moves.length,
      reverted: 0,
      conflicts: 0,
      errors: 0,
      skipped: 0,
    };

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      try {
        const result = await this.performRevertOne(m);
        stats[result] += 1;
      } catch (e) {
        stats.errors += 1;
        this.logger.warn(`원복 실패 move=${m.id}: ${String(e)}`);
      }
      if ((i + 1) % 10 === 0 || i + 1 === moves.length) {
        await this.jobs.setProgress(jobId, (i + 1) / Math.max(1, moves.length));
      }
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: { payload: JSON.stringify({ ...dto, stats }) },
    });
    await this.jobs.done(jobId);
    this.logger.log(
      `분류 원복 완료 (job ${jobId}): 원복 ${stats.reverted}, 충돌 ${stats.conflicts}, ` +
        `오류 ${stats.errors}, 스킵 ${stats.skipped}`,
    );
  }

  /**
   * 이동 하나를 원복 — toPath 파일을 fromPath 로 되돌리고 DB 경로 복원 후
   * 이력 status='reverted'. 원본이 사라졌거나 목적지가 점유되면 스킵/충돌.
   */
  private async performRevertOne(m: {
    id: number;
    archiveId: number;
    contentHash: string;
    fromPath: string;
    toPath: string;
  }): Promise<'reverted' | 'conflict' | 'skipped'> {
    // 현재 파일이 toPath 에 있어야 원복 가능. 없으면(이미 이동/삭제됨) 상태 유지 후 스킵.
    if (!existsSync(m.toPath)) {
      this.logger.warn(`원복 스킵: 현재 파일 없음 ${m.toPath}`);
      return 'skipped';
    }
    // 되돌릴 자리에 다른 파일이 있으면 덮어쓰지 않는다
    if (existsSync(m.fromPath)) {
      this.logger.warn(`원복 충돌: 원위치 점유 ${m.fromPath}`);
      return 'conflict';
    }

    await mkdir(dirname(m.fromPath), { recursive: true });
    await moveFile(m.toPath, m.fromPath);

    // contentHash 로 아카이브를 찾아 경로 복원 (id 가 바뀌었을 수도 있어 해시 우선)
    const archive =
      (await this.prisma.archive.findUnique({
        where: { contentHash: m.contentHash },
      })) ??
      (await this.prisma.archive.findUnique({ where: { id: m.archiveId } }));

    await this.prisma.$transaction(async (tx) => {
      if (archive) {
        await tx.archive.update({
          where: { id: archive.id },
          data: {
            path: m.fromPath,
            fileName: basename(m.fromPath),
            missing: false,
          },
        });
      }
      await tx.classifyMove.update({
        where: { id: m.id },
        data: { status: 'reverted', revertedAt: new Date() },
      });
    });
    this.logger.log(`원복: ${m.toPath} → ${m.fromPath}`);
    return 'reverted';
  }
}
