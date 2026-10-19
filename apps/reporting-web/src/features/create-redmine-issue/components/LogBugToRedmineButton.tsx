import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';
import { REDMINE_BUG_PRIORITY } from '@qakit/reporting-shared';

import { useRedmineStore } from '@/app/store/provider';

const PRIORITY_OPTIONS = REDMINE_BUG_PRIORITY;
type BugPriority = (typeof PRIORITY_OPTIONS)[number];

// The project *identifier* from Redmine's URL (/projects/<identifier>) — not its display name, which
// the REST API rejects. Set VITE_REDMINE_PROJECT_KEY at build time.
const DEFAULT_PROJECT_KEY = import.meta.env.VITE_REDMINE_PROJECT_KEY || '';
const DEFAULT_TRACKER = 'Bug';

function buildSubject(run: TestRunDetailResponseDto): string {
  const summary = run.defect_statement || run.error_summary || `${run.result} in ${run.scenario_key}`;
  return `[${run.environment}] ${summary}`.slice(0, 200);
}

export const LogBugToRedmineButton = observer(({
  run,
  onCreated,
}: {
  run: TestRunDetailResponseDto;
  /** Fired after the issue is created, so the caller can refetch the run. */
  onCreated?: () => void;
}) => {
  const redmineStore = useRedmineStore();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<BugPriority | ''>('');
  const [note, setNote] = useState('');

  const handleOpen = () => {
    redmineStore.reset();
    setPriority('');
    setNote('');
    setOpen(true);
  };

  const handleClose = () => {
    if (redmineStore.isCreatingIssue) return;
    setOpen(false);
  };

  const handleSubmit = async () => {
    if (!priority) return;

    await redmineStore.createRedmineIssue(run.id, {
      project_key: DEFAULT_PROJECT_KEY,
      tracker: DEFAULT_TRACKER,
      subject: buildSubject(run),
      priority,
      notes: note.trim() || undefined,
    }).then(
      () => onCreated?.(),
      () => {
        // Error is surfaced via redmineStore.issueCreationError below.
      },
    );
  };

  const createdIssue = redmineStore.lastCreatedIssue;

  return (
    <>
      <Button variant="outlined" color="error" startIcon={<BugReportIcon />} onClick={handleOpen}>
        Log Bug to Redmine
      </Button>

      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>Log Bug to Redmine</DialogTitle>
        <DialogContent className="space-y-4 !pt-2">
          {createdIssue ? (
            <Alert severity="success">
              Created issue #{createdIssue.id} —{' '}
              <a href={createdIssue.url} target="_blank" rel="noreferrer">
                {createdIssue.subject}
              </a>
            </Alert>
          ) : (
            <>
              <TextField
                select
                required
                fullWidth
                label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as BugPriority)}
                disabled={redmineStore.isCreatingIssue}
                helperText="Required — how urgently should this be fixed?"
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Note"
                placeholder="Optional context for the bug report (e.g. what you observed, anything unusual)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={redmineStore.isCreatingIssue}
              />

              {redmineStore.issueCreationError && (
                <Alert severity="error">{redmineStore.issueCreationError}</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          {createdIssue ? (
            <Button onClick={handleClose}>Close</Button>
          ) : (
            <>
              <Button onClick={handleClose} disabled={redmineStore.isCreatingIssue}>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={!priority || redmineStore.isCreatingIssue}
              >
                {redmineStore.isCreatingIssue ? 'Submitting…' : 'Submit'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
});
