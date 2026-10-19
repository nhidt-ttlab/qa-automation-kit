import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { REVIEW_VERDICT, RUN_TYPE } from '@qakit/reporting-shared';
import type { ReviewVerdict, RunType } from '@qakit/reporting-shared';

/**
 * Filters for the review CSV export. All optional — the default is every run that has a review.
 *
 * Note the split in how these are applied (see ReviewsService.exportReviewsCsv): the run-shaped
 * filters below become SQL, while `verdict` and `should_improve_testcase` cannot, because a
 * review is a JSON blob in `artifacts` rather than a table with columns.
 */
export class ExportReviewsQuery {
  // Open vocabularies stay plain strings: the suite tree and the documentation modules grow
  // without a release here, and rejecting a value this package has not caught up with would be
  // worse than returning its (correct) empty result. Same reasoning as ListRunsQueryDto.module.
  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsIn(Object.values(RUN_TYPE))
  run_type?: RunType;

  /** Run started at or after this ISO date. */
  @IsOptional()
  @IsString()
  from_date?: string;

  /** Run started at or before this ISO date. */
  @IsOptional()
  @IsString()
  to_date?: string;

  /**
   * Only runs whose latest review was written at or after this ISO instant -- the way to leave
   * out reviews already acted on. Unlike `from_date`, this is the review's date, not the run's.
   * There is deliberately no upper bound: capping it would let a superseded older review stand
   * in for a run whose real latest review falls after the cap.
   */
  @IsOptional()
  @IsDateString()
  reviewed_from?: string;

  @IsOptional()
  @IsIn(Object.values(REVIEW_VERDICT))
  verdict?: ReviewVerdict;

  /**
   * Deliberately not the `@Type(() => Boolean)` used by the other query DTOs here: query params
   * arrive as strings, and `Boolean("false")` is `true`, so that idiom cannot express a false
   * filter. This one has to, because "the reviews that do NOT need a testcase rewrite" is a
   * question worth asking of this export.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  should_improve_testcase?: boolean;
}
