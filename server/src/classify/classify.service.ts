import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Archive, ClassifyRule, LibraryRoot, Prisma } from '@prisma/client';
import { Job as BullJob } from 'bullmq';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { moveFile } from '../common/file.util';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { dbJobIdFrom, QueueService } from '../queue/queue.service';
import { SearchIndexService } from '../search/search-index.service';
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
import {
  Assignment,
  buildTagPlan,
  parseAssignments,
  TagPlan,
} from './classify-tagging';

const QUEUE = 'classify';
const QUEUE_REVERT = 'classify-revert';

type RuleWithRoot = ClassifyRule & { root: LibraryRoot | null };
type ArchiveWithMeta = Archive & {
  root: LibraryRoot;
  country: { id: number; code: string } | null;
  models: { modelId: number; model: { name: string } }[];
  tags: { tagId: number; tag: { name: string } }[];
};

/** 컴파일된 규칙 — 매칭 엔진 내부 표현 */
interface CompiledRule {
  rule: RuleWithRoot;
  re: RegExp;
  assignments: Assignment[];
}

/** 한 아카이브에 매칭된 규칙 하나 + 그 규칙의 캡처 토큰. */
interface RuleMatch {
  rule: RuleWithRoot;
  tokens: Record<string, string>;
  assignments: Assignment[];
}

export type MoveStatus =
  | 'move' // 이동 필요
  | 'noop' // 이미 목적지에 있음
  | 'conflict' // 목적지에 동명 파일 존재
  | 'error' // 템플릿/경로/권한 문제로 이동 불가
  | 'none'; // 이동 규칙 없음 (태깅만)

interface MoveResolution {
  status: MoveStatus;
  rule: RuleWithRoot | null;
  destPath: string | null;
  destRel: string | null;
  message?: string;
}

export interface ClassifyPreviewItem {
  archiveId: number;
  fileName: string;
  currentPath: string;
  /** 이동 상태. 'none' 이면 태깅만. */
  status: MoveStatus;
  ruleId: number | null;
  ruleName: string | null;
  /** 이 아카이브에 매칭된 규칙 수. */
  matchCount: number;
  /** 추가/설정될 태그·메타 (표시용 문자열). 예: ["국가:JP","모델:Aoyama","태그:AI"]. */
  tagChanges: string[];
  rootId: number;
  rootLabel: string | null;
  rootPath: string;
  destPath: string | null;
  destRel: string | null;
  message?: string;
}

export interface ClassifyPreview {
  total: number; // 변경(이동 또는 태깅) 대상 아카이브 수
  willMove: number;
  willTag: number;
  sampled: number;
  items: ClassifyPreviewItem[];
}

export interface ApplyStats {
  matched: number;
  moved: number;
  noop: number;
  conflicts: number;
  errors: number;
  /** batchLimit 로 이번 실행에서 미루어진(다음 실행 대상) 이동 건수. */
  remaining: number;
  // 태깅
  tagged: number; // 메타/태그가 바뀐 아카이브 수
  newCountries: number;
  newPublishers: number;
  newSeries: number;
  newModels: number;
  newTags: number;
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
    private readonly searchIndex: SearchIndexService,
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
        compiled.push({
          rule,
          re: compileMatcher(rule.matchType, rule.pattern),
          assignments: parseAssignments(rule.assignments),
        });
      } catch (e) {
        this.logger.warn(
          `분류 규칙 컴파일 실패 (rule ${rule.id} "${rule.name}"): ${String(e)}`,
        );
      }
    }
    return compiled;
  }

  /** 아카이브에 매칭되는 모든 규칙(우선순위 순) + 각 규칙의 캡처 토큰. */
  private matchAll(
    archive: ArchiveWithMeta,
    rules: CompiledRule[],
  ): RuleMatch[] {
    const out: RuleMatch[] = [];
    for (const { rule, re, assignments } of rules) {
      if (rule.rootId != null && rule.rootId !== archive.rootId) continue;
      const { matched, tokens } = matchFile(re, archive.fileName);
      if (!matched) continue;
      out.push({ rule, tokens, assignments });
    }
    return out;
  }

  /**
   * 이동 목적지 산출 — destTemplate 이 있는 첫 매칭 규칙 기준.
   * 템플릿 토큰 = 그 규칙의 캡처 그룹 + 메타 토큰({country}=국가코드, {name}=첫 모델).
   * 이동 규칙이 없으면 status='none'.
   */
  private resolveMove(
    archive: ArchiveWithMeta,
    matches: RuleMatch[],
    plan: TagPlan,
  ): MoveResolution {
    const mv = matches.find((m) => m.rule.destTemplate.trim() !== '');
    if (!mv) {
      return { status: 'none', rule: null, destPath: null, destRel: null };
    }
    const rule = mv.rule;
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

    // 메타 토큰 — 이번 실행 태그 계획 우선, 없으면 기존 메타.
    const metaTokens: Record<string, string> = { ...mv.tokens };
    const country = plan.country ?? archive.country?.code;
    const firstModel = plan.models[0] ?? archive.models[0]?.model.name;
    if (country) metaTokens.country = country;
    if (firstModel) metaTokens.name = firstModel;

    let destRel: string;
    try {
      destRel = renderTemplate(rule.destTemplate, metaTokens);
    } catch (e) {
      const msg = e instanceof TemplateError ? e.message : '템플릿 렌더링 실패';
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
    if (dirname(archive.path) === destDir) {
      return { status: 'noop', rule, destPath, destRel };
    }
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

  /** 태그 계획 대비 실제로 바뀔 항목만 사람이 읽는 문자열로. (preview 표시용) */
  private tagChangesFor(archive: ArchiveWithMeta, plan: TagPlan): string[] {
    const out: string[] = [];
    if (plan.country && !archive.countryId) out.push(`국가:${plan.country}`);
    if (plan.publisher && !archive.publisherId)
      out.push(`출판사:${plan.publisher}`);
    if (plan.series && !archive.seriesId) out.push(`시리즈:${plan.series}`);
    if (plan.title && !archive.title) out.push(`제목:${plan.title}`);
    const haveModels = new Set(
      archive.models.map((m) => m.model.name.toLowerCase()),
    );
    for (const n of plan.models) {
      if (!haveModels.has(n.toLowerCase())) out.push(`모델:${n}`);
    }
    const haveTags = new Set(archive.tags.map((t) => t.tag.name.toLowerCase()));
    for (const n of plan.tags) {
      if (!haveTags.has(n.toLowerCase())) out.push(`태그:${n}`);
    }
    return out;
  }

  /** 후보 아카이브 (미싱 제외) + 루트·국가·모델·태그 포함 로드. */
  private loadCandidates(): Promise<ArchiveWithMeta[]> {
    return this.prisma.archive.findMany({
      where: { missing: false },
      include: {
        root: true,
        country: { select: { id: true, code: true } },
        models: { select: { modelId: true, model: { select: { name: true } } } },
        tags: { select: { tagId: true, tag: { select: { name: true } } } },
      },
      orderBy: { id: 'asc' },
    });
  }

  /** 변경 없이 어떤 아카이브가 어떻게 태깅/이동될지 미리보기. */
  async preview(dto: ClassifyPreviewDto): Promise<ClassifyPreview> {
    const rules = await this.compileRules(dto.ruleIds, false);
    const candidates = await this.loadCandidates();
    const limit = dto.sampleLimit ?? 50;

    let total = 0;
    let willMove = 0;
    let willTag = 0;
    const items: ClassifyPreviewItem[] = [];

    for (const a of candidates) {
      const matches = this.matchAll(a, rules);
      if (matches.length === 0) continue;

      const plan = buildTagPlan(matches);
      const tagChanges = this.tagChangesFor(a, plan);
      const mv = this.resolveMove(a, matches, plan);

      const movesFile = mv.status === 'move';
      const hasMoveIssue = mv.status === 'conflict' || mv.status === 'error';
      const changes = tagChanges.length > 0 || movesFile || hasMoveIssue;
      if (!changes) continue; // noop 이동 + 태그 변경 없음 → 스킵

      total += 1;
      if (movesFile) willMove += 1;
      if (tagChanges.length > 0) willTag += 1;

      if (items.length < limit) {
        items.push({
          archiveId: a.id,
          fileName: a.fileName,
          currentPath: a.path,
          status: mv.status,
          ruleId: mv.rule?.id ?? matches[0].rule.id,
          ruleName: mv.rule?.name ?? matches[0].rule.name,
          matchCount: matches.length,
          tagChanges,
          rootId: a.rootId,
          rootLabel: a.root.label,
          rootPath: a.root.path,
          destPath: mv.destPath,
          destRel: mv.destRel,
          message: mv.message,
        });
      }
    }

    return { total, willMove, willTag, sampled: items.length, items };
  }

  /** DB Job 생성 + 큐 enqueue. 즉시 jobId 반환. */
  async startApply(dto: ClassifyApplyDto): Promise<number> {
    const job = await this.jobs.create('classify', {
      ruleIds: dto.ruleIds ?? null,
      force: dto.force ?? false,
      limit: dto.limit ?? null,
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
    const caches = await this.loadEntityCaches();

    // 한 실행 최대 이동 건수. dto.limit 우선, 아니면 단일 규칙의 batchLimit.
    const limit =
      dto.limit ?? (rules.length === 1 ? rules[0].rule.batchLimit ?? undefined : undefined);

    const stats: ApplyStats = {
      matched: 0,
      moved: 0,
      noop: 0,
      conflicts: 0,
      errors: 0,
      remaining: 0,
      tagged: 0,
      newCountries: 0,
      newPublishers: 0,
      newSeries: 0,
      newModels: 0,
      newTags: 0,
    };

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      const matches = this.matchAll(a, rules);
      if (matches.length === 0) continue;
      stats.matched += 1;

      const plan = buildTagPlan(matches);

      // 1) 태깅 (누적) — 이동 여부와 무관하게 적용. 이미 분류된 파일도 태그가 채워짐.
      try {
        const changed = await this.applyTagPlan(a, plan, caches, stats);
        if (changed) stats.tagged += 1;
      } catch (e) {
        stats.errors += 1;
        this.logger.warn(`태깅 실패 archive=${a.id}: ${String(e)}`);
      }

      // 2) 이동 (첫 매칭 규칙 목적지)
      const mv = this.resolveMove(a, matches, plan);
      try {
        switch (mv.status) {
          case 'move':
            if (limit !== undefined && stats.moved >= limit) {
              stats.remaining += 1; // 한도 도달 → 다음 실행으로
            } else {
              await this.performMove(a, mv.destPath!, mv.rule, jobId);
              stats.moved += 1;
            }
            break;
          case 'noop':
            stats.noop += 1;
            break;
          case 'conflict':
            stats.conflicts += 1;
            this.logger.warn(
              `분류 스킵(충돌) archive=${a.id}: ${mv.message} → ${mv.destPath}`,
            );
            break;
          case 'error':
            stats.errors += 1;
            this.logger.warn(`분류 스킵(오류) archive=${a.id}: ${mv.message}`);
            break;
          default:
            break; // none — 이동 규칙 없음
        }
      } catch (e) {
        stats.errors += 1;
        this.logger.warn(`분류 이동 실패 archive=${a.id}: ${String(e)}`);
      }

      if ((i + 1) % 10 === 0 || i + 1 === candidates.length) {
        await this.jobs.setProgress(jobId, (i + 1) / Math.max(1, candidates.length));
      }
    }

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
      `분류 완료 (job ${jobId}): 태깅 ${stats.tagged}, 이동 ${stats.moved}, ` +
        `충돌 ${stats.conflicts}, 오류 ${stats.errors}, 제자리 ${stats.noop}` +
        (stats.remaining > 0 ? `, 다음 실행 대기 ${stats.remaining}` : ''),
    );
  }

  /** 엔티티 이름→id 캐시 — 배치 내 중복 생성 방지. */
  private async loadEntityCaches() {
    const [countries, publishers, series, models, tags] = await Promise.all([
      this.prisma.country.findMany({ select: { id: true, code: true } }),
      this.prisma.publisher.findMany({ select: { id: true, name: true } }),
      this.prisma.series.findMany({ select: { id: true, name: true } }),
      this.prisma.model.findMany({ select: { id: true, name: true } }),
      this.prisma.tag.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      country: new Map(countries.map((c) => [c.code.toUpperCase(), c.id])),
      publisher: new Map(publishers.map((p) => [p.name.toLowerCase(), p.id])),
      series: new Map(series.map((s) => [s.name.toLowerCase(), s.id])),
      model: new Map(models.map((m) => [m.name.toLowerCase(), m.id])),
      tag: new Map(tags.map((t) => [t.name.toLowerCase(), t.id])),
    };
  }

  /**
   * 태그 계획을 아카이브에 적용. 단일값(country/publisher/series/title)은
   * 비어있을 때만 설정(수동 편집 보존), 다중값(model/tag)은 누적(중복 스킵).
   * 없는 엔티티는 생성. 변경이 있었으면 true.
   */
  private async applyTagPlan(
    archive: ArchiveWithMeta,
    plan: TagPlan,
    caches: Awaited<ReturnType<ClassifyService['loadEntityCaches']>>,
    stats: ApplyStats,
  ): Promise<boolean> {
    let changed = false;
    const data: Prisma.ArchiveUncheckedUpdateInput = {};

    if (plan.country && !archive.countryId) {
      const code = plan.country.toUpperCase();
      let id = caches.country.get(code);
      if (!id) {
        id = (
          await this.prisma.country.create({ data: { code, name: code } })
        ).id;
        caches.country.set(code, id);
        stats.newCountries += 1;
      }
      data.countryId = id;
      changed = true;
    }
    if (plan.publisher && !archive.publisherId) {
      const key = plan.publisher.toLowerCase();
      let id = caches.publisher.get(key);
      if (!id) {
        id = (
          await this.prisma.publisher.create({ data: { name: plan.publisher } })
        ).id;
        caches.publisher.set(key, id);
        stats.newPublishers += 1;
      }
      data.publisherId = id;
      changed = true;
    }
    if (plan.series && !archive.seriesId) {
      const key = plan.series.toLowerCase();
      let id = caches.series.get(key);
      if (!id) {
        id = (
          await this.prisma.series.create({ data: { name: plan.series } })
        ).id;
        caches.series.set(key, id);
        stats.newSeries += 1;
      }
      data.seriesId = id;
      changed = true;
    }
    if (plan.title && !archive.title) {
      data.title = plan.title;
      changed = true;
    }

    const haveModels = new Set(archive.models.map((m) => m.modelId));
    const linkModels: number[] = [];
    for (const name of plan.models) {
      const key = name.toLowerCase();
      let id = caches.model.get(key);
      if (!id) {
        id = (await this.prisma.model.create({ data: { name } })).id;
        caches.model.set(key, id);
        stats.newModels += 1;
      }
      if (!haveModels.has(id)) {
        linkModels.push(id);
        haveModels.add(id);
        changed = true;
      }
    }

    const haveTags = new Set(archive.tags.map((t) => t.tagId));
    const linkTags: number[] = [];
    for (const name of plan.tags) {
      const key = name.toLowerCase();
      let id = caches.tag.get(key);
      if (!id) {
        id = (await this.prisma.tag.create({ data: { name } })).id;
        caches.tag.set(key, id);
        stats.newTags += 1;
      }
      if (!haveTags.has(id)) {
        linkTags.push(id);
        haveTags.add(id);
        changed = true;
      }
    }

    if (Object.keys(data).length || linkModels.length || linkTags.length) {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length) {
          await tx.archive.update({ where: { id: archive.id }, data });
        }
        if (linkModels.length) {
          await tx.archiveModel.createMany({
            data: linkModels.map((modelId) => ({ archiveId: archive.id, modelId })),
          });
        }
        if (linkTags.length) {
          await tx.archiveTag.createMany({
            data: linkTags.map((tagId) => ({ archiveId: archive.id, tagId })),
          });
        }
      });
      if ('title' in data) await this.searchIndex.reindex(archive.id);
    }
    return changed;
  }

  /**
   * 물리 이동 + DB 경로 갱신 + 이력 적재. 파일명은 그대로, 디렉터리만 변경.
   * contentHash 는 내용이 바뀌지 않아 불변 → 썸네일/프리뷰 캐시 그대로 유효.
   * 이동 성공 시 ClassifyMove 이력을 남겨 원복(undo) 가능하게 한다.
   */
  private async performMove(
    archive: ArchiveWithMeta,
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
