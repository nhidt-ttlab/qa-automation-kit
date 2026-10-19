import { observer } from 'mobx-react-lite';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Tooltip,
  Typography,
} from '@mui/material';
import { SyncRounded } from '@mui/icons-material';
import { useState } from 'react';
import { REGRESSION_WORKSPACE_SYNC_STATUS } from '@qakit/reporting-shared';
import type { RegressionRunStore } from '../store/RegressionRunStore';
import { isLiveStatus } from '../types';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * "Where do the test scripts come from, and are they current?" — the checkout's branch and
 * revision, with the button that pulls the latest scripts so a scenario pushed an hour ago can be
 * selected and run without a shell on the server.
 *
 * The sync is refused by the API while a run is live; the button says why instead of letting the
 * click fail.
 */
export const WorkspaceSyncCard = observer(({ store }: { store: RegressionRunStore }) => {
  const [showOutput, setShowOutput] = useState(false);
  const ws = store.workspace;
  const result = store.syncResult;
  const hasLiveJob = store.jobs.some((j) => isLiveStatus(j.status));

  let blocker: string | null = null;
  if (store.actor.trim().length === 0) blocker = 'Enter your name below first; a sync is recorded like a run.';
  else if (ws && !ws.is_git_repo) blocker = 'The runner checkout is not a git repository, so it cannot be synced.';
  else if (ws && ws.upstream === null) blocker = 'The checked-out branch has no tracking branch to pull from.';
  else if (hasLiveJob) blocker = 'A run is in progress; scripts cannot change under it.';
  else if (ws?.sync_in_progress) blocker = 'Another sync is already running.';

  const severity =
    result?.status === REGRESSION_WORKSPACE_SYNC_STATUS.FAILED
      ? 'error'
      : result?.status === REGRESSION_WORKSPACE_SYNC_STATUS.UPDATED
        ? 'success'
        : 'info';

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-wrap items-start justify-between gap-3">
          <Box className="flex flex-col gap-1">
            <Typography variant="h6">Test scripts</Typography>
            {store.workspaceError ? (
              <Typography variant="body2" className="text-red-600">
                {store.workspaceError}
              </Typography>
            ) : ws ? (
              <Box className="flex flex-wrap items-center gap-2">
                {ws.branch && <Chip size="small" label={ws.branch} />}
                {ws.head_short_sha && (
                  <Tooltip title={ws.head_sha ?? ''}>
                    <Chip size="small" variant="outlined" className="font-mono" label={ws.head_short_sha} />
                  </Tooltip>
                )}
                <Typography variant="body2" className="text-gray-600">
                  {ws.head_subject}
                  {ws.head_committed_at ? ` · ${formatWhen(ws.head_committed_at)}` : ''}
                </Typography>
                {ws.dirty_file_count > 0 && (
                  <Tooltip title="Tracked files edited on the server. A pull that touches one of them fails until the edit is committed or reverted there.">
                    <Chip size="small" color="warning" variant="outlined" label={`${ws.dirty_file_count} local change(s)`} />
                  </Tooltip>
                )}
              </Box>
            ) : (
              <Typography variant="body2" className="text-gray-500">
                {store.isLoadingWorkspace ? 'Reading the checkout…' : 'Checkout status unavailable.'}
              </Typography>
            )}
            {ws?.upstream && (
              <Typography variant="caption" className="text-gray-500 font-mono">
                {ws.runner_root} ← {ws.upstream}
              </Typography>
            )}
          </Box>

          <Tooltip title={blocker ?? 'git pull --ff-only, then reload the scenario catalog'}>
            {/* A disabled button fires no events, so the Tooltip needs a wrapper to attach to. */}
            <span>
              <Button
                variant="outlined"
                startIcon={store.isSyncing ? <CircularProgress size={16} /> : <SyncRounded />}
                disabled={!store.canSync}
                onClick={() => void store.syncWorkspace()}
              >
                {store.isSyncing ? 'Syncing…' : 'Sync test scripts'}
              </Button>
            </span>
          </Tooltip>
        </Box>

        {result && (
          <Alert
            severity={severity}
            onClose={() => store.clearSyncResult()}
            action={
              result.output ? (
                <Button color="inherit" size="small" onClick={() => setShowOutput((v) => !v)}>
                  {showOutput ? 'Hide output' : 'Show output'}
                </Button>
              ) : undefined
            }
          >
            <Typography variant="body2">
              {result.message}
              <span className="text-gray-500">
                {' '}
                · by {result.requested_by} at {formatWhen(result.finished_at)}
                {result.before_sha && result.after_sha && result.before_sha !== result.after_sha
                  ? ` · ${result.before_sha.slice(0, 8)} → ${result.after_sha.slice(0, 8)}`
                  : ''}
              </span>
            </Typography>
            {result.status === REGRESSION_WORKSPACE_SYNC_STATUS.UPDATED && result.scenario_files_changed > 0 && (
              <Box className="mt-1 flex flex-wrap gap-1">
                {result.changed_files
                  .filter((f) => /\.scenario\.ts$/i.test(f))
                  .slice(0, 12)
                  .map((f) => (
                    <Chip key={f} size="small" variant="outlined" className="font-mono" label={f.replace(/^src\/suites\//, '')} />
                  ))}
                {result.scenario_files_changed > 12 && (
                  <Chip size="small" label={`+${result.scenario_files_changed - 12} more`} />
                )}
              </Box>
            )}
            {result.status === REGRESSION_WORKSPACE_SYNC_STATUS.UPDATED && (
              <Typography variant="body2" className="mt-1 text-gray-600">
                The module and test case lists below now include the new scripts.
              </Typography>
            )}
            <Collapse in={showOutput}>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-900 p-2 text-xs text-gray-100">
                {result.output}
              </pre>
            </Collapse>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
});
