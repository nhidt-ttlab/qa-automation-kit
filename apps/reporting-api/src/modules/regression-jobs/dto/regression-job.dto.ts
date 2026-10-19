/**
 * Request DTOs for the regression-jobs endpoints.
 *
 * Each class implements the matching interface from @qakit/reporting-shared, so the wire contract
 * lives in the shared package and these carry only validation metadata — the same split every
 * other module here uses.
 *
 * Note what is deliberately NOT validated with `@IsIn` at this layer: `modules` is an open
 * vocabulary (the runner matches suite modules, docs domains and aliases, and a new suite folder
 * adds one without a release), and `environment` grows with the runner's config directory. Both
 * are checked against a live catalog in normalizeRegressionSpec instead, where a helpful error can
 * name the valid values. Everything closed is enumerated here so a bad value never reaches a spawn.
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_REGRESSION_GREP_LENGTH,
  MAX_REGRESSION_MODULES,
  MAX_REGRESSION_REQUESTED_BY_LENGTH,
  MAX_REGRESSION_TEST_CASE_IDS,
  MAX_REGRESSION_UI_SLOWMO_MS,
  MAX_REGRESSION_LOG_TAIL_LIMIT,
  REGRESSION_CLEAN_SCOPE,
  REGRESSION_DATA_MODE,
  REGRESSION_SUITE_KIND,
  type CancelRegressionJobRequestDto,
  type CreateRegressionJobRequestDto,
  type PreviewRegressionJobRequestDto,
  type SyncRegressionWorkspaceRequestDto,
  type RegressionCleanScope,
  type RegressionDataMode,
  type RegressionSuiteKind,
} from '@qakit/reporting-shared';

export class PreviewRegressionJobBody implements PreviewRegressionJobRequestDto {
  @IsOptional()
  @IsIn(Object.values(REGRESSION_SUITE_KIND))
  kind?: RegressionSuiteKind;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REGRESSION_MODULES)
  @IsString({ each: true })
  modules?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REGRESSION_TEST_CASE_IDS)
  @IsString({ each: true })
  test_case_ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REGRESSION_GREP_LENGTH)
  grep?: string;
}

export class CreateRegressionJobBody
  extends PreviewRegressionJobBody
  implements CreateRegressionJobRequestDto
{
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REGRESSION_REQUESTED_BY_LENGTH)
  requested_by!: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsIn(Object.values(REGRESSION_CLEAN_SCOPE))
  clean_scope?: RegressionCleanScope;

  @IsOptional()
  @IsIn(Object.values(REGRESSION_DATA_MODE))
  data_mode?: RegressionDataMode;

  @IsOptional()
  @IsBoolean()
  write_mode?: boolean;

  @IsOptional()
  @IsBoolean()
  bail?: boolean;

  /**
   * Tri-state: an absent key means "let the runner decide", which is not the same as `false`.
   * `@IsOptional()` skips validation for null/undefined, which is exactly the behaviour needed.
   */
  @IsOptional()
  @IsBoolean()
  cleanup?: boolean;

  @IsOptional()
  @IsBoolean()
  headed?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_REGRESSION_UI_SLOWMO_MS)
  ui_slowmo_ms?: number;

  /**
   * Custom parameters, handed to the runner as environment variables.
   *
   * Shape only at this layer. Name and value rules, and the reserved-name refusal, live in
   * `normalizeCustomEnv`, where the error can name the offending key and say why - the same split
   * `modules` and `environment` already use.
   */
  @IsOptional()
  @IsObject()
  custom_env?: Record<string, string>;

  /** Required by the service when clean_scope is 'all'; see the check in createJob. */
  @IsOptional()
  @IsBoolean()
  confirm_clean_all?: boolean;
}

export class CancelRegressionJobBody implements CancelRegressionJobRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REGRESSION_REQUESTED_BY_LENGTH)
  requested_by!: string;
}

export class SyncRegressionWorkspaceBody implements SyncRegressionWorkspaceRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REGRESSION_REQUESTED_BY_LENGTH)
  requested_by!: string;
}

export class ListRegressionJobsQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  status?: string;
}

export class RegressionJobLogQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from_seq = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_REGRESSION_LOG_TAIL_LIMIT)
  limit = 1000;
}
