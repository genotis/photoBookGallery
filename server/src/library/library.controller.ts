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
  Post,
} from '@nestjs/common';
import { LibraryRoot } from '@prisma/client';
import { stat } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { IndexerService } from './indexer.service';
import { CreateRootDto } from './dto/create-root.dto';

@Controller('roots')
export class LibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
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
    return this.prisma.libraryRoot.create({
      data: {
        path: dto.path,
        label: dto.label ?? null,
        readOnly: dto.readOnly ?? false,
      },
    });
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
