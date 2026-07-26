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
} from '@nestjs/common';
import { basename } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { compileMatcher } from '../classify/classify.util';
import { ExclusionsService } from './exclusions.service';
import {
  CreateExclusionDto,
  PatchExclusionDto,
  TestExclusionDto,
} from './dto/exclusion.dto';

@Controller('exclusions')
export class ExclusionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: ExclusionsService,
  ) {}

  @Get()
  list() {
    return this.prisma.renderExclusion.findMany({
      orderBy: [{ enabled: 'desc' }, { id: 'asc' }],
    });
  }

  @Post()
  async create(@Body() dto: CreateExclusionDto) {
    const matchType = dto.matchType ?? 'glob';
    this.validate(matchType, dto.pattern);
    const created = await this.prisma.renderExclusion.create({
      data: {
        matchType,
        pattern: dto.pattern,
        enabled: dto.enabled ?? true,
        note: dto.note ?? null,
      },
    });
    await this.svc.reload();
    return created;
  }

  @Patch(':id')
  async patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchExclusionDto,
  ) {
    const existing = await this.prisma.renderExclusion.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('규칙을 찾을 수 없습니다.');
    if (dto.pattern !== undefined || dto.matchType !== undefined) {
      this.validate(
        dto.matchType ?? existing.matchType,
        dto.pattern ?? existing.pattern,
      );
    }
    const updated = await this.prisma.renderExclusion.update({
      where: { id },
      data: {
        ...(dto.matchType !== undefined && { matchType: dto.matchType }),
        ...(dto.pattern !== undefined && { pattern: dto.pattern }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
    await this.svc.reload();
    return updated;
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    const existing = await this.prisma.renderExclusion.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('규칙을 찾을 수 없습니다.');
    await this.prisma.renderExclusion.delete({ where: { id } });
    await this.svc.reload();
    return { ok: true };
  }

  /**
   * 패턴 테스트 — archiveId 가 오면 해당 책의 어떤 엔트리가 매칭되는지 미리보기.
   * 규칙 저장 전에 효과를 확인하는 용도.
   */
  @Post('test')
  @HttpCode(200)
  async test(@Body() dto: TestExclusionDto): Promise<{
    matched: string[];
    total: number;
  }> {
    let re: RegExp;
    try {
      re = compileMatcher(dto.matchType, dto.pattern);
    } catch (e) {
      throw new BadRequestException(`잘못된 패턴: ${String(e)}`);
    }
    if (dto.archiveId === undefined) return { matched: [], total: 0 };
    const entries = await this.prisma.entry.findMany({
      where: { archiveId: dto.archiveId },
      orderBy: { order: 'asc' },
      select: { name: true },
    });
    const matched = entries
      .map((e) => e.name)
      .filter((name) => re.test(basename(name)));
    return { matched, total: entries.length };
  }

  private validate(matchType: string, pattern: string): void {
    try {
      compileMatcher(matchType, pattern);
    } catch (e) {
      throw new BadRequestException(`잘못된 패턴: ${String(e)}`);
    }
  }
}
