import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FilenameParserService } from '../parser/filename.parser';
import { PrismaService } from '../prisma/prisma.service';
import { ArchivesService } from './archives.service';
import { BatchArchiveDto } from './dto/batch-archive.dto';
import { ListArchivesDto } from './dto/list-archives.dto';
import { PatchArchiveDto } from './dto/patch-archive.dto';

@Controller('archives')
export class ArchivesController {
  constructor(
    private readonly archives: ArchivesService,
    private readonly prisma: PrismaService,
    private readonly parser: FilenameParserService,
  ) {}

  @Get()
  list(@Query() dto: ListArchivesDto) {
    return this.archives.list(dto);
  }

  /** 랜덤 N개 — 사이드바 "랜덤" 메뉴용. n 은 1~200 범위로 클램프. */
  @Get('random')
  random(@Query('n') n?: string) {
    const parsed = Number.parseInt(n ?? '20', 10);
    const count = Number.isFinite(parsed)
      ? Math.max(1, Math.min(200, parsed))
      : 20;
    return this.archives.random(count);
  }

  @Post('batch')
  batch(@Body() dto: BatchArchiveDto) {
    return this.archives.batch(dto);
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const archive = await this.archives.detail(id);
    if (!archive) {
      throw new NotFoundException('아카이브를 찾을 수 없습니다.');
    }
    return archive;
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchArchiveDto,
  ) {
    return this.archives.patch(id, dto);
  }

  @Get(':id/entries')
  entries(@Param('id', ParseIntPipe) id: number) {
    return this.archives.entries(id);
  }

  /** 파일명 휴리스틱 파서 — 출판사/모델 후보를 기존 엔티티와 매칭해 돌려준다. */
  @Get(':id/suggestions')
  async suggestions(@Param('id', ParseIntPipe) id: number) {
    const a = await this.prisma.archive.findUnique({
      where: { id },
      select: { fileName: true },
    });
    if (!a) throw new NotFoundException('아카이브를 찾을 수 없습니다.');
    return this.parser.suggest(a.fileName);
  }
}
