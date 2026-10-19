import type { RegressionJobStatus } from '@qakit/reporting-shared';
import { StatusChip } from '../../../shared/components/StatusChip';
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from '../types';

export function RunJobStatusChip({ status }: { status: RegressionJobStatus }) {
  return (
    <StatusChip
      label={JOB_STATUS_LABEL[status] ?? status}
      tone={JOB_STATUS_TONE[status] ?? 'neutral'}
    />
  );
}
