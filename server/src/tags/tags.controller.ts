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
import { TagsService } from './tags.service';
import { PatchTagDto, UpsertTagDto } from './dto/tag.dto';

@Controller('tags')
export class TagsController {
  constructor(private readonly svc: TagsService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.svc.list(q);
  }

  @Post()
  create(@Body() dto: UpsertTagDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchTagDto,
  ) {
    return this.svc.patch(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}
