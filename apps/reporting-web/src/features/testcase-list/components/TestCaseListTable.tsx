import { useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
} from '@mui/material';
import { RUN_TYPE } from '@qakit/reporting-shared';
import type { RunType, TestCaseListItemResponseDto } from '@qakit/reporting-shared';

import { RunResultChip } from '@/features/run-list/components/RunResultChip';
import { featureLabel } from '@/shared/components/GroupingFilters';

interface TestCaseListTableProps {
  testCases: TestCaseListItemResponseDto[];
  total: number;
  page: number;
  pageSize: number;
  /** UI cases show a screenshot count where API cases show the environment. */
  runType: RunType;
  onPageChange: (page: number) => void;
}

export function TestCaseListTable({ testCases, total, page, pageSize, runType, onPageChange }: TestCaseListTableProps) {
  const navigate = useNavigate();
  // Two columns differ by tab. Every UI run executes against the same browser environment, so
  // that column carries no information here; screenshot count does. And the UI tab is the one
  // whose cases are reconciled row-by-row against the Feature List workbook, so it shows the
  // feature id where the API tab shows the scenario key.
  const isUiTab = runType === RUN_TYPE.UI;

  return (
    <Card>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Test Case ID</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>{isUiTab ? 'Feature ID' : 'Scenario'}</TableCell>
              <TableCell>Feature</TableCell>
              <TableCell align="center">Latest Result</TableCell>
              <TableCell>{isUiTab ? 'Screens' : 'Latest Environment'}</TableCell>
              <TableCell>Latest Run</TableCell>
              <TableCell align="right">Total Runs</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {testCases.map((tc) => (
              <TableRow
                key={tc.id}
                hover
                className="cursor-pointer"
                onClick={() => navigate(`/test-cases/${tc.id}`)}
              >
                <TableCell className="font-mono text-sm">{tc.id}</TableCell>
                <TableCell>{tc.title}</TableCell>
                <TableCell className={isUiTab ? 'font-mono text-sm' : undefined}>
                  {isUiTab ? (tc.feature_id ?? '—') : tc.scenario_key}
                </TableCell>
                <TableCell>{featureLabel(tc.domain)}</TableCell>
                <TableCell align="center">
                  {tc.latest_run_result ? <RunResultChip result={tc.latest_run_result} /> : '—'}
                </TableCell>
                <TableCell>
                  {isUiTab
                    ? (tc.latest_run_screenshot_count ?? '—')
                    : (tc.latest_run_environment ?? '—')}
                </TableCell>
                <TableCell>{tc.latest_run_started_at ? new Date(tc.latest_run_started_at).toLocaleString() : '—'}</TableCell>
                <TableCell align="right">{tc.total_run_count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={Math.max(page - 1, 0)}
        onPageChange={(_e, newPage) => onPageChange(newPage + 1)}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[pageSize]}
      />
    </Card>
  );
}
