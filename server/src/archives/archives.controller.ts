import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ArchivesService } from './archives.service';
import { ListArchivesDto } from './dto/list-archives.dto';

@Controller('archives')
export class ArchivesController {
  constructor(private readonly archives: ArchivesService) {}

  @Get()
  list(@Query() dto: ListArchivesDto) {
    return this.archives.list(dto);
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const archive = await this.archives.detail(id);
    if (!archive) {
      throw new NotFoundException('아카이브를 찾을 수 없습니다.');
    }
    return archive;
  }

  @Get(':id/entries')
  entries(@Param('id', ParseIntPipe) id: number) {
    return this.archives.entries(id);
  }
}
