import { Link } from 'react-router-dom';
import {
  Card,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import type { DashboardSummaryResponseDto } from '@qakit/reporting-shared';

import { RunResultChip } from '@/features/run-list/components/RunResultChip';

interface RecentFailuresTableProps {
  failures: DashboardSummaryResponseDto['recent_failures'];
}

export function RecentFailuresTable({ failures }: RecentFailuresTableProps) {
  if (!failures.length) {
    return null;
  }

  return (
    <Card>
      <CardHeader
        title="Recent Failures"
        titleTypographyProps={{ variant: 'h6' }}
        sx={{ pb: 1.5 }}
      />
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Run</TableCell>
              <TableCell>Scenario</TableCell>
              <TableCell align="center">Result</TableCell>
              <TableCell>Created At</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {failures.map((run) => (
              <TableRow key={run.id} hover>
                <TableCell>
                  <Link to={`/runs/${run.id}`} className="font-mono text-sm">
                    {run.id}
                  </Link>
                </TableCell>
                <TableCell>{run.scenario_key}</TableCell>
                <TableCell align="center">
                  <RunResultChip result={run.result} />
                </TableCell>
                <TableCell>{new Date(run.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}
