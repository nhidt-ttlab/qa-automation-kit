import Tooltip from '@mui/material/Tooltip';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { CHECK_STATUS, type CheckStatus } from '@qakit/reporting-shared';

/**
 * A check has three outcomes, not two. `not_evaluated` means the harness could not score the
 * assertion at all (missing fixture, undecided business rule, no endpoint) — it is neither a pass
 * nor a defect, and rendering it as a green tick is how a `PARTIAL` run ends up looking clean.
 *
 * The API derives `status` from the `NOT_EVALUATED` marker the harness leaves on expected/actual;
 * `passed` is trivially `true` for those rows, so never branch on it here.
 */
const PRESENTATION: Record<
  CheckStatus,
  { Icon: typeof CheckCircleIcon; className: string; label: string }
> = {
  [CHECK_STATUS.PASSED]: {
    Icon: CheckCircleIcon,
    className: 'text-green-500',
    label: 'Passed',
  },
  [CHECK_STATUS.FAILED]: {
    Icon: CancelIcon,
    className: 'text-red-500',
    label: 'Failed',
  },
  [CHECK_STATUS.NOT_EVALUATED]: {
    Icon: WarningAmberIcon,
    className: 'text-amber-500',
    label: 'Not evaluated — this assertion could not be scored',
  },
};

export function CheckStatusIcon({ status }: { status: CheckStatus }) {
  const { Icon, className, label } = PRESENTATION[status];
  return (
    <Tooltip title={label}>
      <Icon className={className} fontSize="small" aria-label={label} />
    </Tooltip>
  );
}

/**
 * Card subheader that keeps not-evaluated rows visible instead of folding them into "all passed".
 */
export function checkSummaryText(totals: Record<CheckStatus, number>): string {
  const parts: string[] = [];
  if (totals[CHECK_STATUS.FAILED] > 0) parts.push(`${totals[CHECK_STATUS.FAILED]} failed`);
  if (totals[CHECK_STATUS.NOT_EVALUATED] > 0) {
    parts.push(`${totals[CHECK_STATUS.NOT_EVALUATED]} not evaluated`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'all passed';
}
