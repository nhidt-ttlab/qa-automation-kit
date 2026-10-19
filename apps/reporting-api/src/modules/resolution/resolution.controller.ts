import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type {
  PaginatedResponse,
  ResolutionCommentResponseDto,
  ResolutionEventResponseDto,
  ResolutionIssueDetailResponseDto,
  ResolutionIssueSummaryResponseDto,
  ResolutionQueueSummaryResponseDto,
} from '@qakit/reporting-shared';
import { ResolutionService } from './resolution.service';
import { sanitizeFilename } from '../runs/artifact-storage.util';
import {
  ExportResolutionIssuesQuery,
  ListResolutionIssuesQuery,
} from './dto/list-resolution-issues-query.dto';
import {
  ChangeResolutionStatusBody,
  CreateResolutionCommentBody,
  LinkResolutionDefectBody,
  LinkResolutionRedmineBody,
  RecordResolutionDecisionBody,
  RecordResolutionResolutionBody,
  ReopenResolutionIssueBody,
  UpdateResolutionIssueBody,
  VerifyResolutionIssueBody,
} from './dto/resolution-request.dto';

/**
 * HTTP surface for the Resolution Queue.
 *
 * Thin by design: every route hands straight to the service, which delegates every state change
 * to `ResolutionWorkflowService`. Errors are the shared `ApiError` hierarchy, which
 * `ApiErrorFilter` renders as `{ error: { code, message, details } }`.
 *
 * The four verbs are separate endpoints because they mean different things, and collapsing them
 * into one PATCH is exactly how a comment ends up being treated as a decision:
 *
 *   comment      discussion; changes nothing
 *   decision     the authoritative answer to "what should the system do"
 *   resolution   what was changed or prepared as a result
 *   verify       evidence from a later execution that it worked
 */
@ApiTags('resolution-queue')
@Controller('api/resolution-issues')
export class ResolutionController {
  constructor(private readonly resolutionService: ResolutionService) {}

  // `summary` is declared before `:id` so Nest does not route it into the detail handler.
  @Get('summary')
  @ApiOperation({ summary: 'Queue counts by status, kind, domain and owner' })
  @ApiResponse({ status: 200, description: 'Resolution Queue summary' })
  async getSummary(): Promise<ResolutionQueueSummaryResponseDto> {
    return this.resolutionService.getSummary();
  }

  // Also declared before `:id`, for the same reason as `summary`.
  @Get('export')
  @ApiOperation({
    summary:
      'Export the filtered issues as CSV, one row per affected test case',
    description:
      'Takes the same filters as the list endpoint, without pagination. Intended for updating ' +
      'the spec documents and testcases an answer came from, so each row carries the decision, ' +
      'the resolution, the discussion and the test case to edit.',
  })
  @ApiResponse({ status: 200, description: 'text/csv attachment' })
  async exportIssues(
    @Query() query: ExportResolutionIssuesQuery,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { filename, csv } =
      await this.resolutionService.exportIssuesCsv(query);
    res.set({
      // charset=utf-8 alongside the BOM the body already carries: the header is for anything
      // reading over HTTP, the BOM is for Excel opening the saved file.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${sanitizeFilename(filename)}"`,
      'Content-Length': String(Buffer.byteLength(csv, 'utf8')),
    });
    res.end(csv);
  }

  @Get()
  @ApiOperation({
    summary: 'List resolution issues with filtering and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of resolution issues',
  })
  async listIssues(
    @Query() query: ListResolutionIssuesQuery,
  ): Promise<PaginatedResponse<ResolutionIssueSummaryResponseDto>> {
    return this.resolutionService.listIssues(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one resolution issue with its observations and history',
  })
  @ApiParam({ name: 'id', description: 'Resolution issue id' })
  async getIssue(
    @Param('id') id: string,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.getIssue(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update the user-owned fields: kind, owner, priority, summary, title',
  })
  @ApiBody({ type: UpdateResolutionIssueBody })
  async updateIssue(
    @Param('id') id: string,
    @Body() body: UpdateResolutionIssueBody,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.updateIssue(id, body);
  }

  @Post(':id/status')
  @ApiOperation({
    summary:
      'Move to a status that needs no extra evidence (waiting, ready for rerun, won’t resolve)',
  })
  @ApiBody({ type: ChangeResolutionStatusBody })
  async changeStatus(
    @Param('id') id: string,
    @Body() body: ChangeResolutionStatusBody,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.changeStatus(id, body);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Comment timeline, oldest first' })
  async listComments(
    @Param('id') id: string,
  ): Promise<ResolutionCommentResponseDto[]> {
    return this.resolutionService.listComments(id);
  }

  @Post(':id/comments')
  @ApiOperation({
    summary: 'Add a comment. Discussion only — this never changes the status',
  })
  @ApiBody({ type: CreateResolutionCommentBody })
  @ApiResponse({ status: 201, description: 'Comment created' })
  async addComment(
    @Param('id') id: string,
    @Body() body: CreateResolutionCommentBody,
  ): Promise<ResolutionCommentResponseDto> {
    return this.resolutionService.addComment(id, body);
  }

  @Patch(':id/decision')
  @ApiOperation({
    summary: 'Record the authoritative decision; moves the issue to DECIDED',
  })
  @ApiBody({ type: RecordResolutionDecisionBody })
  async recordDecision(
    @Param('id') id: string,
    @Body() body: RecordResolutionDecisionBody,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.recordDecision(id, body);
  }

  @Patch(':id/resolution')
  @ApiOperation({
    summary:
      'Record what was done; moves the issue to READY_FOR_RERUN, never to VERIFIED',
  })
  @ApiBody({ type: RecordResolutionResolutionBody })
  async recordResolution(
    @Param('id') id: string,
    @Body() body: RecordResolutionResolutionBody,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.recordResolution(id, body);
  }

  @Post(':id/verify')
  @ApiOperation({
    summary:
      'Verify against a later rerun, or with an explicitly audited manual override',
  })
  @ApiBody({ type: VerifyResolutionIssueBody })
  async verify(
    @Param('id') id: string,
    @Body() body: VerifyResolutionIssueBody,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.verify(id, body);
  }

  @Post(':id/reopen')
  @ApiOperation({
    summary: 'Reopen with a mandatory reason; prior history is preserved',
  })
  @ApiBody({ type: ReopenResolutionIssueBody })
  async reopen(
    @Param('id') id: string,
    @Body() body: ReopenResolutionIssueBody,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.reopen(id, body);
  }

  @Post(':id/link-defect')
  @ApiOperation({
    summary: 'Link (or unlink, with null) an existing defect signature',
  })
  @ApiBody({ type: LinkResolutionDefectBody })
  async linkDefect(
    @Param('id') id: string,
    @Body() body: LinkResolutionDefectBody,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.linkDefect(id, body);
  }

  @Post(':id/link-redmine')
  @ApiOperation({
    summary:
      'Link an existing Redmine issue. Only allowed once classified as PRODUCT_DEFECT',
  })
  @ApiBody({ type: LinkResolutionRedmineBody })
  async linkRedmine(
    @Param('id') id: string,
    @Body() body: LinkResolutionRedmineBody,
  ): Promise<ResolutionIssueDetailResponseDto> {
    return this.resolutionService.linkRedmine(id, body);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Append-only audit timeline' })
  async listEvents(
    @Param('id') id: string,
  ): Promise<ResolutionEventResponseDto[]> {
    return this.resolutionService.listEvents(id);
  }
}
