import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type {
  PaginatedResponse,
  SearchResultResponseDto,
} from '@qakit/reporting-shared';
import { SearchService } from './search.service';
import { SearchQueryDtoClass } from './dto/search-query.dto';

@ApiTags('search')
@Controller('api/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search across test cases, test runs, defects, and bugs',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search term' })
  @ApiQuery({ name: 'entity_type', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated search results' })
  async search(
    @Query() query: SearchQueryDtoClass,
  ): Promise<PaginatedResponse<SearchResultResponseDto>> {
    return this.searchService.search(query.q, query);
  }
}
