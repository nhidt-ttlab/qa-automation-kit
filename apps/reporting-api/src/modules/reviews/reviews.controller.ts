import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type {
  CreateReviewRequestDto,
  ReviewRecordResponseDto,
} from '@qakit/reporting-shared';
import { ReviewsService } from './reviews.service';
import { ExportReviewsQuery } from './dto/export-reviews-query.dto';
import { sanitizeFilename } from '../runs/artifact-storage.util';

@ApiTags('reviews')
@Controller('api/reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a review verdict for a test run' })
  @ApiBody({
    description:
      'Review payload: test_run_id, verdict, optional note, plus optional structured fields ' +
      '(testcase_quality, should_improve_testcase, improvement_summary, missing_coverage, ' +
      'suggested_steps, suggested_assertions, suggested_test_data, ai_generation_hint)',
  })
  @ApiResponse({ status: 201, description: 'Review created' })
  async createReview(
    @Body() dto: CreateReviewRequestDto,
  ): Promise<ReviewRecordResponseDto> {
    return this.reviewsService.createReview(dto);
  }

  // Declared before any future `:id` route so Nest does not route it into a detail handler --
  // the same ordering constraint noted in ResolutionController.
  @Get('export')
  @ApiOperation({
    summary: 'Export every reviewed run as CSV, one row per suggestion',
    description:
      'Intended to be handed to an agent that updates the scenario scripts the reviews were ' +
      'written about, so each row carries the scenario_script path to edit alongside a single ' +
      'actionable suggestion. Only the latest review of each run is exported. Runs with no ' +
      'review are omitted; a review with no suggestions appears once as `review_only`.',
  })
  @ApiResponse({ status: 200, description: 'text/csv attachment' })
  async exportReviews(
    @Query() query: ExportReviewsQuery,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { filename, csv } = await this.reviewsService.exportReviewsCsv(query);
    res.set({
      // charset=utf-8 alongside the BOM the body already carries: the header is for anything
      // reading over HTTP, the BOM is for Excel opening the saved file.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${sanitizeFilename(filename)}"`,
      'Content-Length': String(Buffer.byteLength(csv, 'utf8')),
    });
    res.end(csv);
  }
}
