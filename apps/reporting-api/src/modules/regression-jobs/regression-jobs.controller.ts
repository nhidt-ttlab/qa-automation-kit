import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import type {
  PaginatedResponse,
  RegressionJobDetailResponseDto,
  RegressionJobLogTailResponseDto,
  RegressionJobOptionsResponseDto,
  RegressionJobSummaryResponseDto,
  RegressionPreviewResponseDto,
  RegressionWorkspaceStatusResponseDto,
  RegressionWorkspaceSyncResponseDto,
} from '@qakit/reporting-shared';
import { RegressionJobsService } from './regression-jobs.service';
import { RunnerWorkspaceSyncService } from './runner-workspace-sync.service';
import {
  CancelRegressionJobBody,
  CreateRegressionJobBody,
  ListRegressionJobsQuery,
  PreviewRegressionJobBody,
  RegressionJobLogQuery,
  SyncRegressionWorkspaceBody,
} from './dto/regression-job.dto';

@ApiTags('regression-jobs')
@Controller('api/regression-jobs')
export class RegressionJobsController {
  constructor(
    private readonly service: RegressionJobsService,
    private readonly workspace: RunnerWorkspaceSyncService,
  ) {}

  // The literal routes are declared BEFORE `:id`, or Nest would match `preview` as an id.
  // Same ordering rule (and the same reason) as `summary`/`export` in ResolutionController.

  @Get('workspace')
  @ApiOperation({
    summary: 'The test-script checkout the runner executes from: branch, revision, local changes',
  })
  @ApiResponse({ status: 200, description: 'Workspace status and the last sync outcome' })
  async workspaceStatus(): Promise<RegressionWorkspaceStatusResponseDto> {
    return this.workspace.getStatus();
  }

  @Post('workspace/sync')
  @ApiOperation({
    summary: 'Pull the latest test scripts into the runner checkout',
    description:
      'Runs `git pull --ff-only` in the repository that holds the runner, installs dependencies ' +
      'when its manifest changed, and refreshes the scenario catalog so new test cases can be ' +
      'selected and run. Refused (409) while a regression run or another sync is in progress. ' +
      'A pull that fails (local commits, conflicting edits) is reported in the body with status ' +
      '"failed", not as an HTTP error.',
  })
  @ApiBody({ type: SyncRegressionWorkspaceBody })
  @ApiResponse({ status: 201, description: 'The sync outcome' })
  @ApiResponse({ status: 409, description: 'A run or another sync is in progress' })
  async syncWorkspace(
    @Body() body: SyncRegressionWorkspaceBody,
  ): Promise<RegressionWorkspaceSyncResponseDto> {
    return this.workspace.sync(body.requested_by.trim(), () => this.service.invalidateCatalog());
  }

  @Post('preview')
  @ApiOperation({
    summary: 'Resolve a selector to the scenarios it would run, without running anything',
    description:
      'Shells the runner with --list, which returns before it reads its environment config, ' +
      'resolves credentials or opens a session. Safe to call on every form change.',
  })
  @ApiBody({ type: PreviewRegressionJobBody })
  @ApiResponse({ status: 201, description: 'Matching scenarios and any advisories' })
  async preview(
    @Body() body: PreviewRegressionJobBody,
  ): Promise<RegressionPreviewResponseDto> {
    return this.service.preview(body);
  }

  @Get('options')
  @ApiOperation({ summary: 'Environments, module tokens and the scenario catalog' })
  @ApiResponse({ status: 200, description: 'Form options and runner availability' })
  async options(): Promise<RegressionJobOptionsResponseDto> {
    return this.service.getOptions();
  }

  @Get('active')
  @ApiOperation({ summary: 'The job currently holding the run slot, if any' })
  @ApiResponse({ status: 200, description: 'The active job, or null' })
  async active(): Promise<RegressionJobDetailResponseDto | null> {
    return this.service.getActiveJob();
  }

  @Post()
  @ApiOperation({
    summary: 'Start a regression batch',
    description:
      'Returns as soon as the job row exists; the batch runs in the background. Responds 409 ' +
      'with details.active_job_id when another job is already in flight.',
  })
  @ApiBody({ type: CreateRegressionJobBody })
  @ApiResponse({ status: 201, description: 'The created job' })
  @ApiResponse({ status: 409, description: 'A regression run is already in progress' })
  async create(
    @Body() body: CreateRegressionJobBody,
  ): Promise<RegressionJobDetailResponseDto> {
    return this.service.createJob(body);
  }

  @Get()
  @ApiOperation({ summary: 'List regression jobs, newest first' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  @ApiResponse({ status: 200, description: 'Paginated job history' })
  async list(
    @Query() query: ListRegressionJobsQuery,
  ): Promise<PaginatedResponse<RegressionJobSummaryResponseDto>> {
    return this.service.listJobs(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one regression job' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Job detail' })
  async get(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RegressionJobDetailResponseDto> {
    return this.service.getJob(id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Ask a running batch to stop',
    description:
      'Writes a cancel file the runner checks between scenarios, so the session is torn down and ' +
      'the batch summary is still written. Signals follow only as an escalation.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiBody({ type: CancelRegressionJobBody })
  @ApiResponse({ status: 201, description: 'The job, with the cancellation recorded' })
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CancelRegressionJobBody,
  ): Promise<RegressionJobDetailResponseDto> {
    return this.service.cancelJob(id, body);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Read a slice of a job log, for reconnect and download' })
  @ApiParam({ name: 'id', type: Number })
  @ApiQuery({ name: 'from_seq', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Log lines after from_seq' })
  async logs(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: RegressionJobLogQuery,
  ): Promise<RegressionJobLogTailResponseDto> {
    return this.service.getLogTail(id, query);
  }

  @Sse(':id/logs/stream')
  @ApiOperation({
    summary: 'Live job log as Server-Sent Events',
    description:
      'Replays from from_seq (or the Last-Event-ID header, which EventSource resends on reconnect) ' +
      'and then streams live lines. Every event carries the line sequence as its id.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiQuery({ name: 'from_seq', required: false, type: Number })
  async stream(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: RegressionJobLogQuery,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    // An explicit from_seq wins so a non-browser consumer can rewind deliberately; otherwise the
    // browser's own Last-Event-ID resumes exactly where the dropped connection stopped.
    const fromLastEvent = lastEventId ? Number(lastEventId) : NaN;
    const fromSeq = query.from_seq || (Number.isFinite(fromLastEvent) ? fromLastEvent : 0);
    return this.service.streamLog(id, fromSeq);
  }
}
