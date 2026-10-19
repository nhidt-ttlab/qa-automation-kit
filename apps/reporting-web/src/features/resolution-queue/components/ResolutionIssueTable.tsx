import { useNavigate } from 'react-router-dom';
import {
  Card,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import LaunchIcon from '@mui/icons-material/Launch';
import ReplayIcon from '@mui/icons-material/Replay';
import type {
  ListResolutionIssuesQueryDto,
  ResolutionIssueSummaryResponseDto,
} from '@qakit/reporting-shared';
import { featureLabel } from '@/shared/components/GroupingFilters';
import { ResolutionKindChip, ResolutionStatusChip } from './ResolutionStatusChip';

type SortBy = NonNullable<ListResolutionIssuesQueryDto['sort_by']>;

interface ResolutionIssueTableProps {
  issues: ResolutionIssueSummaryResponseDto[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: SortBy;
  sortOrder: 'ASC' | 'DESC';
  onPageChange: (page: number) => void;
  onSortChange: (sortBy: SortBy, sortOrder: 'ASC' | 'DESC') => void;
}

const SORTABLE: Array<{ key: SortBy; label: string; align?: 'center' | 'right' }> = [
  { key: 'display_key', label: 'Key' },
  { key: 'observation_count', label: 'Occurrences', align: 'center' },
  { key: 'priority', label: 'Priority', align: 'center' },
  { key: 'first_seen_at', label: 'First seen' },
  { key: 'last_seen_at', label: 'Last seen' },
];

function isSortable(key: string): key is SortBy {
  return SORTABLE.some((s) => s.key === key);
}

export function ResolutionIssueTable({
  issues,
  total,
  page,
  pageSize,
  sortBy,
  sortOrder,
  onPageChange,
  onSortChange,
}: ResolutionIssueTableProps) {
  const navigate = useNavigate();

  const header = (key: string, label: string, align?: 'center' | 'right') => {
    if (!isSortable(key)) {
      return (
        <TableCell key={key} align={align}>
          {label}
        </TableCell>
      );
    }
    const active = sortBy === key;
    return (
      <TableCell key={key} align={align} sortDirection={active ? (sortOrder === 'ASC' ? 'asc' : 'desc') : false}>
        <TableSortLabel
          active={active}
          direction={active && sortOrder === 'ASC' ? 'asc' : 'desc'}
          onClick={() => onSortChange(key, active && sortOrder === 'DESC' ? 'ASC' : 'DESC')}
        >
          {label}
        </TableSortLabel>
      </TableCell>
    );
  };

  return (
    <Card>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              {header('display_key', 'Key')}
              <TableCell>Issue</TableCell>
              <TableCell>Feature</TableCell>
              <TableCell align="center">Kind</TableCell>
              <TableCell align="center">Status</TableCell>
              <TableCell>Owner</TableCell>
              {header('priority', 'Priority', 'center')}
              <TableCell align="center">Test cases</TableCell>
              {header('observation_count', 'Occurrences', 'center')}
              {header('last_seen_at', 'Last seen')}
              <TableCell align="center">Links</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {issues.map((issue) => (
              <TableRow
                key={issue.id}
                hover
                className="cursor-pointer"
                onClick={() => navigate(`/resolution-queue/${issue.id}`)}
              >
                <TableCell>
                  <Typography variant="body2" className="font-mono">
                    {issue.display_key}
                  </Typography>
                </TableCell>
                <TableCell className="max-w-[420px]">
                  <Typography variant="body2" noWrap title={issue.title}>
                    {issue.title}
                  </Typography>
                </TableCell>
                <TableCell>{featureLabel(issue.domain ?? undefined)}</TableCell>
                <TableCell align="center">
                  <ResolutionKindChip kind={issue.kind} />
                </TableCell>
                <TableCell align="center">
                  <div className="flex items-center justify-center gap-1">
                    <ResolutionStatusChip status={issue.workflow_status} />
                    {issue.recurrence_count > 0 && (
                      // Recurrence survives a later re-verification, so the marker is driven by
                      // the counter rather than by the current status.
                      <Tooltip
                        title={`Came back ${issue.recurrence_count} time(s) after being verified`}
                      >
                        <ReplayIcon className="text-red-500" fontSize="small" aria-label="Recurred" />
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell>{issue.owner ?? '—'}</TableCell>
                <TableCell align="center">
                  {issue.priority ? <Chip label={issue.priority} size="small" variant="outlined" /> : '—'}
                </TableCell>
                <TableCell align="center">{issue.affected_test_case_count}</TableCell>
                <TableCell align="center">{issue.observation_count}</TableCell>
                <TableCell>{new Date(issue.last_seen_at).toLocaleString()}</TableCell>
                <TableCell align="center">
                  <div className="flex items-center justify-center gap-1">
                    {issue.defect_signature_id && (
                      <Tooltip title={`Linked to defect ${issue.defect_signature_id}`}>
                        <BugReportIcon fontSize="small" className="text-gray-500" />
                      </Tooltip>
                    )}
                    {issue.redmine_issue_count > 0 && (
                      <Tooltip title={`${issue.redmine_issue_count} Redmine issue(s)`}>
                        <LaunchIcon fontSize="small" className="text-gray-500" />
                      </Tooltip>
                    )}
                    {!issue.defect_signature_id && issue.redmine_issue_count === 0 && '—'}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        // The API is 1-based; MUI is 0-based.
        page={Math.max(page - 1, 0)}
        onPageChange={(_e, newPage) => onPageChange(newPage + 1)}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[pageSize]}
      />
    </Card>
  );
}
