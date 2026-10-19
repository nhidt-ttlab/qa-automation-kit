import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type {
  PaginatedResponse,
  TestRunDetailResponseDto,
  TestRunListItemResponseDto,
  ReviewRecordResponseDto,
} from '@qakit/reporting-shared';
import { RunsService } from './runs.service';
import { ListRunsQueryDto } from './dto/list-runs-query.dto';
import { sanitizeFilename } from './artifact-storage.util';

/** Types the browser can render in place; everything else is offered as a download. */
const INLINE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/webm',
  'video/mp4',
]);

@ApiTags('runs')
@Controller('api/runs')
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Get()
  @ApiOperation({ summary: 'List test runs with filtering and pagination' })
  @ApiQuery({ name: 'test_case_id', required: false })
  @ApiQuery({ name: 'scenario_key', required: false })
  @ApiQuery({ name: 'run_type', required: false, enum: ['api', 'ui'] })
  @ApiQuery({ name: 'environment', required: false })
  @ApiQuery({ name: 'result', required: false })
  @ApiQuery({ name: 'reviewed', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: true, type: Number })
  @ApiQuery({ name: 'limit', required: true, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated list of test runs' })
  async listRuns(
    @Query() query: ListRunsQueryDto,
  ): Promise<PaginatedResponse<TestRunListItemResponseDto>> {
    return this.runsService.listRuns(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single test run by id' })
  @ApiParam({ name: 'id', description: 'Test run id' })
  @ApiResponse({ status: 200, description: 'Test run detail' })
  async getRun(@Param('id') id: string): Promise<TestRunDetailResponseDto> {
    return this.runsService.getRun(id);
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'Get the full report for a test run' })
  @ApiParam({ name: 'id', description: 'Test run id' })
  @ApiResponse({ status: 200, description: 'Test run report' })
  async getRunReport(
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.runsService.getRunReport(id);
  }

  @Get(':id/review')
  @ApiOperation({ summary: 'Get the review attached to a test run' })
  @ApiParam({ name: 'id', description: 'Test run id' })
  @ApiResponse({ status: 200, description: 'Test run review' })
  async getRunReview(
    @Param('id') id: string,
  ): Promise<ReviewRecordResponseDto> {
    return this.runsService.getRunReview(id);
  }

  @Get(':id/artifacts/:artifactId/download')
  @ApiOperation({ summary: 'Download an artifact for a test run' })
  @ApiParam({ name: 'id', description: 'Test run id' })
  @ApiParam({ name: 'artifactId', description: 'Artifact id' })
  async downloadArtifact(
    @Param('id') id: string,
    @Param('artifactId', ParseIntPipe) artifactId: number,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const result = await this.runsService.getArtifactDownload(id, artifactId);
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${sanitizeFilename(result.filename)}"`,
      ...(result.contentLength != null
        ? { 'Content-Length': String(result.contentLength) }
        : {}),
    });
    result.stream.pipe(res);
  }

  @Get(':id/ui-evidence/:itemId')
  @ApiOperation({
    summary:
      'Serve one UI evidence file (screenshot, video, trace, HAR, console)',
  })
  @ApiParam({ name: 'id', description: 'Test run id' })
  @ApiParam({ name: 'itemId', description: 'Evidence item id, e.g. E-UI-01' })
  async getUiEvidenceFile(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const result = await this.runsService.getUiEvidenceFile(id, itemId);
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }

    // Screenshots and video are rendered in the page, so they must NOT be attachments the
    // way the artifact route serves its Markdown and JSON. A trace zip has nothing to render
    // and stays a download.
    const disposition = INLINE_CONTENT_TYPES.has(result.contentType)
      ? 'inline'
      : 'attachment';

    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `${disposition}; filename="${sanitizeFilename(result.filename)}"`,
      // A run directory is written once and never mutated, so the bytes behind a given
      // (run, item) pair cannot change.
      'Cache-Control': 'private, max-age=31536000, immutable',
      ...(result.contentLength != null
        ? { 'Content-Length': String(result.contentLength) }
        : {}),
    });
    result.stream.pipe(res);
  }
}
