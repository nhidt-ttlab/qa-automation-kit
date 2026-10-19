import { Button, Tooltip } from '@mui/material';
import { ReplayRounded } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { rerunSearchParams } from '../types';

/**
 * Exported from the feature barrel and used by the run-detail and testcase-detail pages, the same
 * way LogBugToRedmineButton reaches across from create-redmine-issue.
 *
 * It navigates to a PREFILLED FORM; it does not create the job. That is the load-bearing decision:
 * clean scope defaults to "everything", so a one-click rerun from a detail page would wipe the
 * whole artifact tree and the runner's history - exactly the accident the confirmation dialog
 * exists to prevent. The tooltip says so, so the button is not mistaken for fire-and-forget.
 */
export function RerunButton({
  testCaseIds,
  kind,
  label = 'Rerun',
}: {
  testCaseIds: string[];
  kind?: string | null;
  label?: string;
}) {
  const navigate = useNavigate();
  return (
    <Tooltip title="Opens the run form with this test case pre-selected. Nothing runs until you confirm the preview.">
      <Button
        variant="outlined"
        startIcon={<ReplayRounded />}
        onClick={() => navigate(`/regression-runs?${rerunSearchParams(testCaseIds, kind)}`)}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
