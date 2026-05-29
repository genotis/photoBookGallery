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
import { ModelsService } from './models.service';
import {
  MergeModelDto,
  PatchModelDto,
  UpsertModelDto,
} from './dto/model.dto';

@Controller('models')
export class ModelsController {
  constructor(private readonly svc: ModelsService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.svc.list(q);
  }

  @Post()
  create(@Body() dto: UpsertModelDto) {
    return this.svc.create(dto);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchModelDto,
  ) {
    return this.svc.patch(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  @Post(':id/merge')
  merge(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MergeModelDto,
  ) {
    return this.svc.merge(id, dto);
  }
}
