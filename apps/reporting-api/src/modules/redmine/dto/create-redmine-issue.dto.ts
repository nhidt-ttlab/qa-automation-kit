import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  CreateRedmineIssueRequestDto,
  DefectSeverity,
  RedmineCustomFieldValue,
} from '@qakit/reporting-shared';
import { REDMINE_PRIORITY } from '@qakit/reporting-shared';

export class RedmineCustomFieldDto implements RedmineCustomFieldValue {
  @IsInt()
  @IsPositive()
  id!: number;

  // string | string[] — list-type custom fields with multiple values send an array.
  value!: string | string[];
}

export class CreateRedmineIssueDto implements CreateRedmineIssueRequestDto {
  @IsString()
  @MinLength(1)
  project_key!: string;

  @IsString()
  @MinLength(1)
  tracker!: string;

  @IsString()
  @MinLength(1)
  subject!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn([...REDMINE_PRIORITY])
  priority?: CreateRedmineIssueRequestDto['priority'];

  @IsOptional()
  @IsString()
  assigned_to?: string;

  @IsOptional()
  @IsString()
  target_version?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RedmineCustomFieldDto)
  custom_fields?: RedmineCustomFieldValue[];

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  build_version?: string;

  @IsOptional()
  @IsString()
  device_os?: string;

  @IsOptional()
  @IsIn(['FE', 'BE', 'API'])
  bug_type?: 'FE' | 'BE' | 'API';

  @IsOptional()
  @IsString()
  sprint?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  steps_to_reproduce?: string[];

  @IsOptional()
  @IsString()
  actual_result?: string;

  @IsOptional()
  @IsString()
  expected_result?: string;

  @IsOptional()
  @IsString()
  impact?: string;

  @IsOptional()
  @IsIn(['Critical', 'High', 'Medium', 'Low'])
  severity?: DefectSeverity;

  @IsOptional()
  @IsBoolean()
  is_regression?: boolean;

  @IsOptional()
  @IsString()
  related_bugs?: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
