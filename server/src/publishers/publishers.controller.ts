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
import { PublishersService } from './publishers.service';
import { PatchPublisherDto, UpsertPublisherDto } from './dto/publisher.dto';

@Controller('publishers')
export class PublishersController {
  constructor(private readonly svc: PublishersService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.svc.list(q);
  }

  @Post()
  create(@Body() dto: UpsertPublisherDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchPublisherDto,
  ) {
    return this.svc.patch(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}
