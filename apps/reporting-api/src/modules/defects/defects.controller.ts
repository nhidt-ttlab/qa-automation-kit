import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type {
  PaginatedResponse,
  DefectSignatureSummaryResponseDto,
  DefectSignatureDetailResponseDto,
  LinkRedmineRequestDto,
} from '@qakit/reporting-shared';
import { DefectsService } from './defects.service';
import { ListDefectsQueryDto } from './dto/list-defects-query.dto';

@ApiTags('defects')
@Controller('api/defects')
export class DefectsController {
  constructor(private readonly defectsService: DefectsService) {}

  @Get()
  @ApiOperation({
    summary: 'List defect signatures with filtering and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of defect signatures',
  })
  async listDefects(
    @Query() query: ListDefectsQueryDto,
  ): Promise<PaginatedResponse<DefectSignatureSummaryResponseDto>> {
    return this.defectsService.listDefects(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single defect signature by id' })
  @ApiParam({ name: 'id', description: 'Defect signature id' })
  @ApiResponse({ status: 200, description: 'Defect signature detail' })
  async getDefect(
    @Param('id') id: string,
  ): Promise<DefectSignatureDetailResponseDto> {
    return this.defectsService.getDefect(id);
  }

  @Post('/from-run/:runId')
  @ApiOperation({
    summary: 'Create or link a defect signature from a failed test run',
  })
  @ApiParam({ name: 'runId', description: 'Test run id' })
  @ApiResponse({
    status: 201,
    description: 'Defect signature created or matched',
  })
  async createFromRun(
    @Param('runId') runId: string,
  ): Promise<DefectSignatureDetailResponseDto> {
    return this.defectsService.createFromRun(runId);
  }

  @Post(':id/link-redmine')
  @ApiOperation({ summary: 'Link a defect signature to a Redmine issue' })
  @ApiParam({ name: 'id', description: 'Defect signature id' })
  @ApiBody({ description: 'Redmine link payload' })
  @ApiResponse({
    status: 200,
    description: 'Defect signature linked to Redmine issue',
  })
  async linkRedmine(
    @Param('id') id: string,
    @Body() dto: LinkRedmineRequestDto,
  ): Promise<DefectSignatureDetailResponseDto> {
    return this.defectsService.linkRedmine(id, dto);
  }
}
