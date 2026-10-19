import {
  Card,
  CardHeader,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import type { DashboardSummaryResponseDto } from '@qakit/reporting-shared';

import { featureLabel } from '@/shared/components/GroupingFilters';

interface DomainBreakdownTableProps {
  rows: DashboardSummaryResponseDto['by_domain'];
}

/**
 * Pass rate per feature — where the regression suite is healthy and where it is not.
 *
 * Counted over the latest run of each test case, matching the Pass Rate card. The all-executions
 * total stays visible as a separate column so a feature that has been re-run heavily is still
 * legible as such.
 */
export function DomainBreakdownTable({ rows }: DomainBreakdownTableProps) {
  if (!rows.length) {
    return null;
  }

  return (
    <Card>
      <CardHeader
        title="Pass Rate by Feature"
        titleTypographyProps={{ variant: 'h6' }}
        sx={{ pb: 1.5 }}
      />
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Feature</TableCell>
              <TableCell align="right">Test Cases</TableCell>
              <TableCell align="right">Passing</TableCell>
              <TableCell align="right">Total Runs</TableCell>
              <TableCell align="center" className="w-1/3">
                Pass Rate
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.domain} hover>
                <TableCell>{featureLabel(row.domain)}</TableCell>
                <TableCell align="right">{row.latest_total}</TableCell>
                <TableCell align="right">{row.latest_passed}</TableCell>
                <TableCell align="right">{row.total_runs}</TableCell>
                <TableCell align="center">
                  <div className="flex items-center gap-2">
                    <LinearProgress
                      variant="determinate"
                      value={row.pass_rate}
                      color={row.pass_rate >= 90 ? 'success' : row.pass_rate >= 60 ? 'warning' : 'error'}
                      className="grow"
                    />
                    <span className="w-14 text-right text-sm font-semibold">{row.pass_rate}%</span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}
