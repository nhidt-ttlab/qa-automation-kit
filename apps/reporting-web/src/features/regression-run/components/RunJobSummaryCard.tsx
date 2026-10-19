import { Box, Card, CardContent, Chip, LinearProgress, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { RegressionJobDetailResponseDto } from '@qakit/reporting-shared';
import { isLiveStatus, selectorLabel } from '../types';
import { RunJobStatusChip } from './RunJobStatusChip';

export function RunJobSummaryCard({ job }: { job: RegressionJobDetailResponseDto }) {
  const done = (job.pass_count ?? 0) + (job.blocked_count ?? 0) + (job.fail_count ?? 0);
  const total = job.selected_count ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const live = isLiveStatus(job.status);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-wrap items-center gap-3">
          <RunJobStatusChip status={job.status} />
          <Typography variant="body2" className="text-gray-600">
            {job.environment} · {selectorLabel(job)} · started by {job.requested_by}
          </Typography>
        </Box>

        <Box className="flex flex-wrap items-center gap-4">
          <Typography variant="body2">
            <strong>{done}</strong> / {total || '?'} scenarios
          </Typography>
          <Typography variant="body2" className="text-green-700">
            {job.pass_count ?? 0} pass
          </Typography>
          <Typography variant="body2" className="text-amber-600">
            {job.blocked_count ?? 0} blocked
          </Typography>
          <Typography variant="body2" className="text-red-600">
            {job.fail_count ?? 0} fail
          </Typography>
          {job.duration_ms !== null && job.duration_ms !== undefined && (
            <Typography variant="body2" className="text-gray-500">
              {(job.duration_ms / 1000).toFixed(1)}s
            </Typography>
          )}
        </Box>

        {live && <LinearProgress variant={total > 0 ? 'determinate' : 'indeterminate'} value={pct} />}

        <Box className="flex flex-wrap gap-1">
          {job.argv.map((arg, i) => (
            <Chip key={`${arg}-${i}`} label={arg} size="small" variant="outlined" />
          ))}
        </Box>

        <Box className="flex flex-wrap gap-4">
          {job.exit_code !== null && job.exit_code !== undefined && (
            <Typography variant="body2" className="text-gray-500">
              exit {job.exit_code}
            </Typography>
          )}
          {job.sync_status && (
            <Typography variant="body2" className="text-gray-500">
              sync {job.sync_status.toLowerCase()}
              {job.synced_run_count !== null && job.synced_run_count !== undefined
                ? ` · ${job.synced_run_count} run(s) imported`
                : ''}
            </Typography>
          )}
          {/*
            The batch is only useful once its runs are in the reporting database, which is what
            SYNCING means is still happening. Offering the link before then would land on nothing.
          */}
          {job.sync_status === 'OK' && (job.synced_run_count ?? 0) > 0 && (
            <Typography variant="body2" component={RouterLink} to="/" className="text-sky-700">
              Open in Test Cases →
            </Typography>
          )}
        </Box>

        {job.summary_path && (
          <Typography variant="body2" className="text-gray-500 font-mono">
            {job.summary_path}
          </Typography>
        )}

        {job.error_summary && (
          <Typography variant="body2" className="text-red-600">
            {job.error_summary}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
