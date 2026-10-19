import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { ListDefectSignaturesQueryDto } from '@qakit/reporting-shared';

export class ListDefectsQueryDto implements ListDefectSignaturesQueryDto {
  @IsOptional()
  @IsString()
  test_case_id?: string;

  @IsOptional()
  @IsString()
  scenario_key?: string;

  // Filtered through the signature's test case — defect_signatures carries only scenario_key.
  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsIn(['Critical', 'High', 'Medium', 'Low'])
  severity?: ListDefectSignaturesQueryDto['severity'];

  @IsOptional()
  @IsIn(['draft', 'submitted', 'duplicate', 'resolved', 'wontfix'])
  status?: ListDefectSignaturesQueryDto['status'];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit!: number;
}
