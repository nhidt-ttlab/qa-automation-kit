import { IsOptional, IsString } from 'class-validator';
import type { DashboardQueryDto } from '@qakit/reporting-shared';

export class DashboardQueryDtoClass implements DashboardQueryDto {
  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  from_date?: string;

  @IsOptional()
  @IsString()
  to_date?: string;
}
