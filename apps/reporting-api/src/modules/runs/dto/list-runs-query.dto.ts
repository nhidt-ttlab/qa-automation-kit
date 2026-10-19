import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { RUN_TYPE } from '@qakit/reporting-shared';
import type { ListTestRunsQueryDto } from '@qakit/reporting-shared';

export class ListRunsQueryDto implements ListTestRunsQueryDto {
  @IsOptional()
  @IsString()
  test_case_id?: string;

  @IsOptional()
  @IsString()
  scenario_key?: string;

  @IsOptional()
  @IsIn(Object.values(RUN_TYPE))
  run_type?: ListTestRunsQueryDto['run_type'];

  // Validated as free strings rather than @IsIn(SUITE_MODULE): the suite tree grows, and a module
  // this package has not caught up with must still filter rather than 400. Like every param here,
  // it has to be declared or Nest's whitelist silently drops it and returns an unfiltered list.
  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  result?: ListTestRunsQueryDto['result'];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  reviewed?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dry_run?: boolean;

  @IsOptional()
  tags?: string[];

  @IsOptional()
  @IsString()
  from_date?: string;

  @IsOptional()
  @IsString()
  to_date?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit!: number;

  @IsOptional()
  @IsIn(['created_at', 'started_at', 'result'])
  sort_by?: 'created_at' | 'started_at' | 'result';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sort_order?: 'ASC' | 'DESC';
}
