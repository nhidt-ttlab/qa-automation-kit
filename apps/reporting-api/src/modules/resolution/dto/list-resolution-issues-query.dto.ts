import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  RESOLUTION_KIND,
  RESOLUTION_OBSERVED_RESULT,
  RESOLUTION_PRIORITY,
  RESOLUTION_WORKFLOW_STATUS,
} from '@qakit/reporting-shared';
import type { ListResolutionIssuesQueryDto } from '@qakit/reporting-shared';

export class ListResolutionIssuesQuery implements ListResolutionIssuesQueryDto {
  /** Free text over display_key, title, source_summary and user_summary. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  display_key?: string;

  @IsOptional()
  @IsIn(Object.values(RESOLUTION_KIND))
  kind?: ListResolutionIssuesQueryDto['kind'];

  @IsOptional()
  @IsIn(Object.values(RESOLUTION_WORKFLOW_STATUS))
  workflow_status?: ListResolutionIssuesQueryDto['workflow_status'];

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsIn(Object.values(RESOLUTION_PRIORITY))
  priority?: ListResolutionIssuesQueryDto['priority'];

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
  @IsString()
  scenario_key?: string;

  @IsOptional()
  @IsString()
  test_case_id?: string;

  @IsOptional()
  @IsIn(Object.values(RESOLUTION_OBSERVED_RESULT))
  observed_result?: ListResolutionIssuesQueryDto['observed_result'];

  @IsOptional()
  @IsString()
  first_seen_from?: string;

  @IsOptional()
  @IsString()
  first_seen_to?: string;

  @IsOptional()
  @IsString()
  last_seen_from?: string;

  @IsOptional()
  @IsString()
  last_seen_to?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  has_defect?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  has_redmine?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit!: number;

  @IsOptional()
  @IsIn([
    'last_seen_at',
    'first_seen_at',
    'observation_count',
    'priority',
    'display_key',
  ])
  sort_by?: ListResolutionIssuesQueryDto['sort_by'];

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sort_order?: 'ASC' | 'DESC';
}

/**
 * The export takes the same filters as the list, without pagination: it returns everything the
 * filters select, so `page` and `limit` would only be misleading. They stay declared (and
 * optional) rather than rejected, so the UI can hand its current query object straight through
 * without stripping fields first.
 */
export class ExportResolutionIssuesQuery extends ListResolutionIssuesQuery {
  // `declare` keeps the base property and only re-declares its validation metadata; without it
  // TypeScript flags the redeclaration, and an initializer here would defeat @IsOptional.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare page: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare limit: number;
}
