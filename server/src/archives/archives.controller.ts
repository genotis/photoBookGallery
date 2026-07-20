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
import { ArchivesService } from './archives.service';
import { BatchArchiveDto } from './dto/batch-archive.dto';
import { ListArchivesDto } from './dto/list-archives.dto';
import { PatchArchiveDto } from './dto/patch-archive.dto';

@Controller('archives')
export class ArchivesController {
  constructor(private readonly archives: ArchivesService) {}

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
}
