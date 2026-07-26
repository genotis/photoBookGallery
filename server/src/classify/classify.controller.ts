import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClassifyRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClassifyScheduler } from './classify-scheduler.service';
import { ClassifyService } from './classify.service';
import { compileMatcher } from './classify.util';
import {
  Assignment,
  parseAssignments,
  validateAssignments,
} from './classify-tagging';
import {
  AssignmentDto,
  ClassifyApplyDto,
  ClassifyPreviewDto,
  ClassifyRevertDto,
  CreateClassifyRuleDto,
  ImportClassifyRulesDto,
  PatchClassifyRuleDto,
  ReorderRulesDto,
} from './dto/classify.dto';

@Controller('classify')
export class ClassifyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: ClassifyService,
    private readonly scheduler: ClassifyScheduler,
  ) {}

  @Get('rules')
  async listRules() {
    const rules = await this.prisma.classifyRule.findMany({
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    // assignments 는 JSON 문자열로 저장 → 배열로 파싱해 반환.
    return rules.map((r) => ({
      ...r,
      assignments: parseAssignments(r.assignments),
    }));
  }

  /** 전체 규칙을 이식 가능한 JSON 백업으로 내보낸다. 루트는 경로 스냅샷으로. */
  @Get('rules/export')
  async exportRules() {
    const rules = await this.prisma.classifyRule.findMany({
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      include: { root: { select: { path: true } } },
    });
    return {
      type: 'photobookgallery-classify-rules',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: rules.length,
      rules: rules.map((r) => ({
        name: r.name,
        priority: r.priority,
        enabled: r.enabled,
        matchType: r.matchType,
        pattern: r.pattern,
        destTemplate: r.destTemplate,
        assignments: parseAssignments(r.assignments),
        scanCron: r.scanCron,
        scheduleOn: r.scheduleOn,
        batchLimit: r.batchLimit,
        rootPath: r.root?.path ?? null,
      })),
    };
  }

  /** JSON 백업에서 규칙을 복구. merge(추가) 또는 replace(대체). */
  @Post('rules/import')
  async importRules(@Body() dto: ImportClassifyRulesDto): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
    warnings: string[];
  }> {
    const mode = dto.mode ?? 'merge';

    const roots = await this.prisma.libraryRoot.findMany({
      select: { id: true, path: true },
    });
    const rootByPath = new Map(roots.map((r) => [r.path, r.id]));

    if (mode === 'replace') {
      await this.prisma.classifyRule.deleteMany({});
    }

    // merge 중복 방지 키 = 이름 + 패턴 + 목적지
    const dedupKey = (r: {
      name: string;
      pattern: string;
      destTemplate?: string | null;
    }) => `${r.name} ${r.pattern} ${r.destTemplate ?? ""}`;
    const existing = await this.prisma.classifyRule.findMany({
      select: { name: true, pattern: true, destTemplate: true },
    });
    const seen = new Set(existing.map(dedupKey));

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const r of dto.rules) {
      const matchType = r.matchType ?? 'regex';
      try {
        compileMatcher(matchType, r.pattern);
      } catch {
        errors.push(`"${r.name}": 잘못된 패턴 — 건너뜀`);
        skipped += 1;
        continue;
      }
      if (r.scanCron && !ClassifyScheduler.isValid(r.scanCron)) {
        errors.push(`"${r.name}": 잘못된 cron 식 — 건너뜀`);
        skipped += 1;
        continue;
      }
      if (seen.has(dedupKey(r))) {
        skipped += 1;
        continue;
      }

      let rootId: number | null = null;
      if (r.rootPath) {
        const found = rootByPath.get(r.rootPath);
        if (found === undefined) {
          warnings.push(
            `"${r.name}": 루트 '${r.rootPath}' 없음 → 모든 루트로 설정`,
          );
        } else {
          rootId = found;
        }
      }

      await this.prisma.classifyRule.create({
        data: {
          name: r.name,
          priority: r.priority ?? 0,
          enabled: r.enabled ?? true,
          rootId,
          matchType,
          pattern: r.pattern,
          destTemplate: (r.destTemplate ?? '').trim(),
          assignments: this.assignJson(r.assignments),
          scanCron: r.scanCron ?? null,
          scheduleOn: r.scheduleOn ?? false,
          batchLimit: r.batchLimit ?? null,
        },
      });
      seen.add(dedupKey(r));
      imported += 1;
    }

    await this.scheduler.reload();
    return { imported, skipped, errors, warnings };
  }

  @Post('rules')
  async createRule(
    @Body() dto: CreateClassifyRuleDto,
  ): Promise<ClassifyRule> {
    this.validatePattern(dto.matchType ?? 'regex', dto.pattern);
    this.validateCron(dto.scanCron);
    await this.validateRoot(dto.rootId ?? null);
    const destTemplate = (dto.destTemplate ?? '').trim();
    const assignments = this.assignJson(dto.assignments);
    this.validateActions(destTemplate, dto.assignments);

    const rule = await this.prisma.classifyRule.create({
      data: {
        name: dto.name,
        priority: dto.priority ?? 0,
        enabled: dto.enabled ?? true,
        rootId: dto.rootId ?? null,
        matchType: dto.matchType ?? 'regex',
        pattern: dto.pattern,
        destTemplate,
        assignments,
        scanCron: dto.scanCron ?? null,
        scheduleOn: dto.scheduleOn ?? false,
        batchLimit: dto.batchLimit ?? null,
      },
    });
    await this.scheduler.reload();
    return rule;
  }

  @Patch('rules/:id')
  async patchRule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchClassifyRuleDto,
  ): Promise<ClassifyRule> {
    const existing = await this.prisma.classifyRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('규칙을 찾을 수 없습니다.');

    const matchType = dto.matchType ?? existing.matchType;
    if (dto.pattern !== undefined || dto.matchType !== undefined) {
      this.validatePattern(matchType, dto.pattern ?? existing.pattern);
    }
    if (dto.scanCron !== undefined) this.validateCron(dto.scanCron);
    if (dto.rootId !== undefined) await this.validateRoot(dto.rootId);

    // 이번 patch 후의 실효 액션(이동/태깅) 확인 — 둘 다 비면 거부.
    const effDest =
      dto.destTemplate !== undefined
        ? dto.destTemplate.trim()
        : existing.destTemplate;
    const effAssigns =
      dto.assignments !== undefined
        ? dto.assignments
        : parseAssignments(existing.assignments);
    this.validateActions(effDest, effAssigns);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.rootId !== undefined) data.rootId = dto.rootId;
    if (dto.matchType !== undefined) data.matchType = dto.matchType;
    if (dto.pattern !== undefined) data.pattern = dto.pattern;
    if (dto.destTemplate !== undefined) data.destTemplate = dto.destTemplate.trim();
    if (dto.assignments !== undefined) {
      data.assignments = this.assignJson(dto.assignments);
    }
    if (dto.scanCron !== undefined) data.scanCron = dto.scanCron;
    if (dto.scheduleOn !== undefined) data.scheduleOn = dto.scheduleOn;
    if (dto.batchLimit !== undefined) data.batchLimit = dto.batchLimit;

    const updated = await this.prisma.classifyRule.update({
      where: { id },
      data,
    });
    await this.scheduler.reload();
    return updated;
  }

  /** 드래그 재정렬 — ids 순서대로 priority 0,1,2… 로 설정. */
  @Post('rules/reorder')
  @HttpCode(200)
  async reorderRules(
    @Body() dto: ReorderRulesDto,
  ): Promise<{ ok: true }> {
    await this.prisma.$transaction(
      dto.ids.map((id, i) =>
        this.prisma.classifyRule.update({
          where: { id },
          data: { priority: i },
        }),
      ),
    );
    return { ok: true };
  }

  @Delete('rules/:id')
  @HttpCode(200)
  async removeRule(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    const existing = await this.prisma.classifyRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('규칙을 찾을 수 없습니다.');
    await this.prisma.classifyRule.delete({ where: { id } });
    await this.scheduler.reload();
    return { ok: true };
  }

  /** 단일 아카이브 규칙 기반 메타/태그 제안 (MetaPanel). */
  @Get('suggest/:archiveId')
  suggest(@Param('archiveId', ParseIntPipe) archiveId: number) {
    return this.svc.suggestForArchive(archiveId);
  }

  @Post('preview')
  preview(@Body() dto: ClassifyPreviewDto) {
    return this.svc.preview(dto);
  }

  @Post('apply')
  @HttpCode(202)
  async apply(@Body() dto: ClassifyApplyDto): Promise<{ jobId: number }> {
    const jobId = await this.svc.startApply(dto);
    return { jobId };
  }

  @Get('history')
  history(
    @Query('jobId') jobId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listHistory({
      jobId: jobId !== undefined ? Number(jobId) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('revert')
  @HttpCode(202)
  async revert(@Body() dto: ClassifyRevertDto): Promise<{ jobId: number }> {
    const jobId = await this.svc.startRevert(dto);
    return { jobId };
  }

  /** assignments 배열 → DB 저장용 JSON(없으면 null). 형식 검증 포함. */
  private assignJson(
    list: AssignmentDto[] | undefined,
  ): string | null {
    if (!list || list.length === 0) return null;
    const err = validateAssignments(list as Assignment[]);
    if (err) throw new BadRequestException(`잘못된 태깅 액션: ${err}`);
    return JSON.stringify(list);
  }

  /** 규칙은 이동(destTemplate) 또는 태깅(assignments) 중 하나 이상 있어야 한다. */
  private validateActions(
    destTemplate: string,
    assignments: { target: string }[] | undefined,
  ): void {
    if (!destTemplate && (!assignments || assignments.length === 0)) {
      throw new BadRequestException(
        '규칙은 이동 목적지 또는 태깅 액션 중 하나 이상이 필요합니다.',
      );
    }
  }

  private validatePattern(matchType: string, pattern: string): void {
    try {
      compileMatcher(matchType, pattern);
    } catch (e) {
      throw new BadRequestException(`잘못된 패턴: ${String(e)}`);
    }
  }

  private validateCron(cronExpr: string | null | undefined): void {
    if (cronExpr && !ClassifyScheduler.isValid(cronExpr)) {
      throw new BadRequestException(`잘못된 cron 식: ${cronExpr}`);
    }
  }

  private async validateRoot(rootId: number | null): Promise<void> {
    if (rootId == null) return;
    const root = await this.prisma.libraryRoot.findUnique({
      where: { id: rootId },
    });
    if (!root) throw new BadRequestException('루트를 찾을 수 없습니다.');
  }
}
