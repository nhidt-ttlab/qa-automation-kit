import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TEST_RUN_RESULT } from '@qakit/reporting-shared';
import type {
  PaginatedResponse,
  TestCaseDomainListResponseDto,
  TestCaseListItemResponseDto,
  TestCaseDetailResponseDto,
  TestRunListItemResponseDto,
} from '@qakit/reporting-shared';
import { TestCasesService } from './testcases.service';
import { ListTestCaseDomainsQueryDto } from './dto/list-testcase-domains-query.dto';
import { ListTestCasesQueryDto } from './dto/list-testcases-query.dto';
import { ListRunsQueryDto } from '../runs/dto/list-runs-query.dto';

@ApiTags('testcases')
@Controller('api/testcases')
export class TestCasesController {
  constructor(private readonly testCasesService: TestCasesService) {}

  @Get()
  @ApiOperation({ summary: 'List test cases with filtering and pagination' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'owner', required: false })
  @ApiQuery({ name: 'scenario_key', required: false })
  @ApiQuery({
    name: 'run_type',
    required: false,
    enum: ['api', 'ui'],
    description: 'Which layer the case exercises. Backs the API/UI tabs.',
  })
  @ApiQuery({
    name: 'feature_id',
    required: false,
    description:
      'Feature List screen number. Case-insensitive substring match, so a prefix returns the whole group.',
  })
  @ApiQuery({
    name: 'csv_checklist_id',
    required: false,
    description:
      'Hardening-checklist id some run of the case has a check answering. Case-insensitive substring, so a prefix selects a sheet family.',
  })
  @ApiQuery({
    name: 'csv_testcase_id',
    required: false,
    description:
      'Checklist row id. Case-insensitive substring over each check\'s recorded rows (a check may store several joined with " | "). Combine with csv_checklist_id to pin one row of one sheet.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Keyword search across id, title, scenario_key',
  })
  @ApiQuery({
    name: 'latest_run_result',
    required: false,
    enum: TEST_RUN_RESULT,
    description: 'Filter by latest test run result',
  })
  @ApiQuery({ name: 'page', required: true, type: Number })
  @ApiQuery({ name: 'limit', required: true, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated list of test cases' })
  async listTestCases(
    @Query() query: ListTestCasesQueryDto,
  ): Promise<PaginatedResponse<TestCaseListItemResponseDto>> {
    return this.testCasesService.listTestCases(query);
  }

  // Declared BEFORE `:id`, or Nest would match `domains` as a test case id.
  @Get('domains')
  @ApiOperation({ summary: 'Distinct feature domains stamped on test cases' })
  @ApiQuery({
    name: 'run_type',
    required: false,
    enum: ['api', 'ui'],
    description: 'Only domains that have cases of this layer. Omit for both.',
  })
  @ApiResponse({ status: 200, description: 'Domains, ascending, `_unknown` last' })
  async listDomains(
    @Query() query: ListTestCaseDomainsQueryDto,
  ): Promise<TestCaseDomainListResponseDto> {
    return this.testCasesService.listDomains(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single test case by id' })
  @ApiParam({ name: 'id', description: 'Test case id' })
  @ApiResponse({ status: 200, description: 'Test case detail' })
  async getTestCase(
    @Param('id') id: string,
  ): Promise<TestCaseDetailResponseDto> {
    return this.testCasesService.getTestCase(id);
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Get the run history for a test case' })
  @ApiParam({ name: 'id', description: 'Test case id' })
  @ApiQuery({ name: 'page', required: true, type: Number })
  @ApiQuery({ name: 'limit', required: true, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated run history for the test case',
  })
  async getTestCaseRuns(
    @Param('id') id: string,
    @Query() query: ListRunsQueryDto,
  ): Promise<PaginatedResponse<TestRunListItemResponseDto>> {
    return this.testCasesService.getTestCaseRuns(id, query);
  }
}
