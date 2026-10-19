import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { RedmineIssueResponseDto } from '@qakit/reporting-shared';
import { RedmineService } from './redmine.service';
import { CreateRedmineIssueDto } from './dto/create-redmine-issue.dto';

@ApiTags('redmine')
@Controller('api/runs')
export class RedmineController {
  constructor(private readonly redmineService: RedmineService) {}

  @Post(':runId/redmine')
  @ApiOperation({
    summary:
      'Create a Redmine issue for a test run using the bug-report-template.md structure; always tagged Autotest',
  })
  @ApiParam({ name: 'runId', description: 'Test run id' })
  @ApiBody({
    description:
      'Redmine issue payload. Fields left unset are enriched from the run record where possible.',
    type: CreateRedmineIssueDto,
  })
  @ApiResponse({ status: 201, description: 'Redmine issue created' })
  async createIssueForRun(
    @Param('runId') runId: string,
    @Body() dto: CreateRedmineIssueDto,
  ): Promise<RedmineIssueResponseDto> {
    return this.redmineService.createIssueForRun(runId, dto);
  }
}
