import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RUN_TYPE, TEST_RUN_RESULT } from '@qakit/reporting-shared';
import type { ListTestCasesQueryDto as ListTestCasesQueryContract } from '@qakit/reporting-shared';

export class ListTestCasesQueryDto implements ListTestCasesQueryContract {
  @IsOptional()
  @IsIn(['active', 'deprecated', 'draft'])
  status?: ListTestCasesQueryContract['status'];

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  scenario_key?: string;

  // Backs the API/UI tabs. Must be declared here: Nest's whitelist validation drops unknown
  // query params, which would silently return an unfiltered list instead of erroring.
  @IsOptional()
  @IsIn(Object.values(RUN_TYPE))
  run_type?: ListTestCasesQueryContract['run_type'];

  // Free strings, not @IsIn(SUITE_MODULE)/@IsIn(FEATURE_DOMAIN): the vocabularies grow with the
  // suite tree and the docs, and a 400 on a valid-but-newer module would be worse than an empty page.
  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  // Free string too: the workbook coins new screen numbers ahead of any enum we could pin here.
  @IsOptional()
  @IsString()
  feature_id?: string;

  // Free strings for the same reason: the vocabulary is whatever the runs recorded, and a value
  // that no run has yet is an empty page, not a 400.
  @IsOptional()
  @IsString()
  csv_checklist_id?: string;

  @IsOptional()
  @IsString()
  csv_testcase_id?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(Object.values(TEST_RUN_RESULT))
  latest_run_result?: ListTestCasesQueryContract['latest_run_result'];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit!: number;

  @IsOptional()
  @IsIn(['created_at', 'updated_at', 'title'])
  sort_by?: 'created_at' | 'updated_at' | 'title';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sort_order?: 'ASC' | 'DESC';
}
