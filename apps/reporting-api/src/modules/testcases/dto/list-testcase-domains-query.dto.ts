import { IsIn, IsOptional } from 'class-validator';
import { RUN_TYPE } from '@qakit/reporting-shared';
import type { ListTestCaseDomainsQueryDto as ListTestCaseDomainsQueryContract } from '@qakit/reporting-shared';

export class ListTestCaseDomainsQueryDto implements ListTestCaseDomainsQueryContract {
  // Must be declared: Nest's whitelist validation drops unknown query params, which would
  // silently return every domain instead of the active tab's.
  @IsOptional()
  @IsIn(Object.values(RUN_TYPE))
  run_type?: ListTestCaseDomainsQueryContract['run_type'];
}
