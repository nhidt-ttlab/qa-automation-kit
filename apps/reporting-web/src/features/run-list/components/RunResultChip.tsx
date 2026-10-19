import type { TestRunResult } from '@qakit/reporting-shared';

import { StatusChip, type StatusTone } from '@/shared/components/StatusChip';

const RESULT_TONE: Record<TestRunResult, StatusTone> = {
  PASS: 'success',
  PARTIAL: 'warning',
  FAIL: 'error',
  BLOCKED: 'neutral',
  ERROR: 'error',
};

export function RunResultChip({ result }: { result: TestRunResult }) {
  return <StatusChip label={result} tone={RESULT_TONE[result] ?? 'neutral'} />;
}
