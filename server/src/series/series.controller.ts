import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SeriesService } from './series.service';
import { PatchSeriesDto, UpsertSeriesDto } from './dto/series.dto';

@Controller('series')
export class SeriesController {
  constructor(private readonly svc: SeriesService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.svc.list(q);
  }

  @Post()
  create(@Body() dto: UpsertSeriesDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchSeriesDto,
  ) {
    return this.svc.patch(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}
