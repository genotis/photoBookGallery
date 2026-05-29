import { Controller, Get, Post, Query } from '@nestjs/common';
import { SearchIndexService } from './search-index.service';
import { SearchService } from './search.service';
import { FacetsDto, SearchDto } from './dto/search.dto';

@Controller()
export class SearchController {
  constructor(
    private readonly svc: SearchService,
    private readonly index: SearchIndexService,
  ) {}

  @Get('search')
  search(@Query() dto: SearchDto) {
    return this.svc.search(dto);
  }

  @Get('facets')
  facets(@Query() dto: FacetsDto) {
    return this.svc.facets(dto);
  }

  @Post('search/rebuild')
  rebuild(): Promise<{ indexed: number }> {
    return this.index.rebuildAll();
  }
}
