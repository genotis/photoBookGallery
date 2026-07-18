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
  ClassifyApplyDto,
  ClassifyPreviewDto,
  ClassifyRevertDto,
  CreateClassifyRuleDto,
  PatchClassifyRuleDto,
} from './dto/classify.dto';

@Controller('classify')
export class ClassifyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: ClassifyService,
    private readonly scheduler: ClassifyScheduler,
  ) {}

  @Get('rules')
  listRules(): Promise<ClassifyRule[]> {
    return this.prisma.classifyRule.findMany({
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
  }

  @Post('rules')
  async createRule(
    @Body() dto: CreateClassifyRuleDto,
  ): Promise<ClassifyRule> {
    this.validatePattern(dto.matchType ?? 'regex', dto.pattern);
    this.validateCron(dto.scanCron);
    await this.validateRoot(dto.rootId ?? null);

    const rule = await this.prisma.classifyRule.create({
      data: {
        name: dto.name,
        priority: dto.priority ?? 0,
        enabled: dto.enabled ?? true,
        rootId: dto.rootId ?? null,
        matchType: dto.matchType ?? 'regex',
        pattern: dto.pattern,
        destTemplate: dto.destTemplate,
        scanCron: dto.scanCron ?? null,
        scheduleOn: dto.scheduleOn ?? false,
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

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.rootId !== undefined) data.rootId = dto.rootId;
    if (dto.matchType !== undefined) data.matchType = dto.matchType;
    if (dto.pattern !== undefined) data.pattern = dto.pattern;
    if (dto.destTemplate !== undefined) data.destTemplate = dto.destTemplate;
    if (dto.scanCron !== undefined) data.scanCron = dto.scanCron;
    if (dto.scheduleOn !== undefined) data.scheduleOn = dto.scheduleOn;

    const updated = await this.prisma.classifyRule.update({
      where: { id },
      data,
    });
    await this.scheduler.reload();
    return updated;
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
