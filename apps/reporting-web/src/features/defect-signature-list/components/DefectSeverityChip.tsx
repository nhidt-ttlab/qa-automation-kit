import type { DefectSeverity } from '@qakit/reporting-shared';

import { StatusChip, type StatusTone } from '@/shared/components/StatusChip';

const SEVERITY_TONE: Record<DefectSeverity, StatusTone> = {
  Critical: 'error',
  High: 'warning',
  Medium: 'info',
  Low: 'neutral',
};

export function DefectSeverityChip({ severity }: { severity: DefectSeverity }) {
  return <StatusChip label={severity} tone={SEVERITY_TONE[severity] ?? 'neutral'} />;
}
