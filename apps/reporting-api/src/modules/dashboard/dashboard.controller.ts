import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { DashboardSummaryResponseDto } from '@qakit/reporting-shared';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDtoClass } from './dto/dashboard-query.dto';

@ApiTags('dashboard')
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Get dashboard summary metrics for a period/environment',
  })
  @ApiQuery({ name: 'environment', required: false })
  @ApiQuery({ name: 'from_date', required: false })
  @ApiQuery({ name: 'to_date', required: false })
  @ApiResponse({
    status: 200,
    description: 'Dashboard summary retrieved successfully',
  })
  async getSummary(
    @Query() query: DashboardQueryDtoClass,
  ): Promise<DashboardSummaryResponseDto> {
    return this.dashboardService.getSummary(query);
  }
}
