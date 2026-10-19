import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { SearchQueryDto } from '@qakit/reporting-shared';

export class SearchQueryDtoClass implements SearchQueryDto {
  @IsString()
  q!: string;

  @IsOptional()
  @IsIn(['test_case', 'test_run', 'defect', 'bug', 'resolution_issue'])
  entity_type?: SearchQueryDto['entity_type'];

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  limit: number = 20;
}
