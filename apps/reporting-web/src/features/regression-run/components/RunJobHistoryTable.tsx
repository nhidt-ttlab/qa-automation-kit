import {
  Box,
  Card,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { CancelRounded, ReplayRounded } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { RegressionJobSummaryResponseDto } from '@qakit/reporting-shared';
import { isLiveStatus, selectorLabel } from '../types';
import { RunJobStatusChip } from './RunJobStatusChip';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function duration(job: RegressionJobSummaryResponseDto): string {
  const ms =
    job.duration_ms ??
    (job.started_at ? Date.now() - new Date(job.started_at).getTime() : null);
  if (ms === null) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}

function scenarioCell(job: RegressionJobSummaryResponseDto): string {
  const done = (job.pass_count ?? 0) + (job.blocked_count ?? 0) + (job.fail_count ?? 0);
  if (isLiveStatus(job.status)) return `${done} / ${job.selected_count ?? '?'}`;
  return `${job.selected_count ?? done}`;
}

export function RunJobHistoryTable({
  jobs,
  total,
  page,
  pageSize,
  onPageChange,
  onCancel,
  onRerun,
}: {
  jobs: RegressionJobSummaryResponseDto[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onCancel: (id: number) => void;
  onRerun: (job: RegressionJobSummaryResponseDto) => void;
}) {
  const navigate = useNavigate();

  return (
    <Card>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Started</TableCell>
              <TableCell>Selection</TableCell>
              <TableCell>Env</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Scenarios</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>By</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map((job) => (
              <TableRow
                key={job.id}
                hover
                className="cursor-pointer"
                onClick={() => navigate(`/regression-runs/${job.id}`)}
              >
                <TableCell>
                  <Tooltip title={new Date(job.queued_at).toLocaleString()}>
                    <span>{relativeTime(job.queued_at)}</span>
                  </Tooltip>
                </TableCell>
                <TableCell>{selectorLabel(job)}</TableCell>
                <TableCell>{job.environment}</TableCell>
                <TableCell>
                  <RunJobStatusChip status={job.status} />
                </TableCell>
                <TableCell>
                  <Box className="flex items-center gap-2">
                    <span>{scenarioCell(job)}</span>
                    {(job.fail_count ?? 0) > 0 && (
                      <Typography variant="body2" component="span" className="text-red-600">
                        {job.fail_count} failed
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>{duration(job)}</TableCell>
                <TableCell>{job.requested_by}</TableCell>
                <TableCell align="right">
                  {/* stopPropagation, or the row's own onClick would navigate as well. */}
                  {isLiveStatus(job.status) && (
                    <Tooltip title="Cancel this run">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancel(job.id);
                        }}
                      >
                        <CancelRounded fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="Load this selection into the form">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRerun(job);
                      }}
                    >
                      <ReplayRounded fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        // The API is 1-based and MUI is 0-based, the same conversion every table here makes.
        page={Math.max(page - 1, 0)}
        onPageChange={(_e, newPage) => onPageChange(newPage + 1)}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[pageSize]}
      />
    </Card>
  );
}
