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
import { CountriesService } from './countries.service';
import { PatchCountryDto, UpsertCountryDto } from './dto/country.dto';

@Controller('countries')
export class CountriesController {
  constructor(private readonly svc: CountriesService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.svc.list(q);
  }

  @Post()
  create(@Body() dto: UpsertCountryDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchCountryDto,
  ) {
    return this.svc.patch(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}
