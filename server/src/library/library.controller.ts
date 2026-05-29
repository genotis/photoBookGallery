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
import { LibraryRoot } from '@prisma/client';
import { stat } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { IndexerService } from './indexer.service';
import { CreateRootDto, PatchRootDto } from './dto/create-root.dto';
import { SchedulerService } from './scheduler.service';

@Controller('roots')
export class LibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
    private readonly scheduler: SchedulerService,
  ) {}

  @Get()
  list(): Promise<(LibraryRoot & { _count: { archives: number } })[]> {
    return this.prisma.libraryRoot.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { archives: true } } },
    });
  }

  @Post()
  async create(@Body() dto: CreateRootDto): Promise<LibraryRoot> {
    let st;
    try {
      st = await stat(dto.path);
    } catch {
      throw new BadRequestException(`경로에 접근할 수 없습니다: ${dto.path}`);
    }
    if (!st.isDirectory()) {
      throw new BadRequestException('디렉터리 경로가 아닙니다.');
    }
    if (dto.scanCron && !SchedulerService.isValid(dto.scanCron)) {
      throw new BadRequestException(`잘못된 cron 식: ${dto.scanCron}`);
    }
    const root = await this.prisma.libraryRoot.create({
      data: {
        path: dto.path,
        label: dto.label ?? null,
        readOnly: dto.readOnly ?? false,
        scanCron: dto.scanCron ?? null,
      },
    });
    await this.scheduler.reload();
    return root;
  }

  @Patch(':id')
  async patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchRootDto,
  ): Promise<LibraryRoot> {
    const root = await this.prisma.libraryRoot.findUnique({ where: { id } });
    if (!root) throw new NotFoundException('루트를 찾을 수 없습니다.');
    if (
      dto.scanCron !== undefined &&
      dto.scanCron !== null &&
      !SchedulerService.isValid(dto.scanCron)
    ) {
      throw new BadRequestException(`잘못된 cron 식: ${dto.scanCron}`);
    }
    const data: Record<string, unknown> = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.readOnly !== undefined) data.readOnly = dto.readOnly;
    if (dto.scanCron !== undefined) data.scanCron = dto.scanCron;
    const updated = await this.prisma.libraryRoot.update({
      where: { id },
      data,
    });
    if ('scanCron' in data) await this.scheduler.reload();
    return updated;
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    const root = await this.prisma.libraryRoot.findUnique({ where: { id } });
    if (!root) {
      throw new NotFoundException('루트를 찾을 수 없습니다.');
    }
    // 아카이브 레코드도 함께 제거 (원본 파일은 건드리지 않음)
    await this.prisma.archive.deleteMany({ where: { rootId: id } });
    await this.prisma.libraryRoot.delete({ where: { id } });
    await this.scheduler.reload();
    return { ok: true };
  }

  @Post(':id/scan')
  @HttpCode(202)
  async scan(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ jobId: number }> {
    const root = await this.prisma.libraryRoot.findUnique({ where: { id } });
    if (!root) {
      throw new NotFoundException('루트를 찾을 수 없습니다.');
    }
    const jobId = await this.indexer.startScan(id);
    return { jobId };
  }
}
