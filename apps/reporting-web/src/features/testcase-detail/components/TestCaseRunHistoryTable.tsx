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
import type { TestRunListItemResponseDto } from '@qakit/reporting-shared';

import { RunResultChip } from '@/features/run-list/components/RunResultChip';

interface TestCaseRunHistoryTableProps {
  runs: TestRunListItemResponseDto[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function TestCaseRunHistoryTable({ runs, total, page, pageSize, onPageChange }: TestCaseRunHistoryTableProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Run ID</TableCell>
              <TableCell>Environment</TableCell>
              <TableCell align="center">Result</TableCell>
              <TableCell>Started At</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.map((run) => (
              <TableRow
                key={run.id}
                hover
                className="cursor-pointer"
                onClick={() => navigate(`/runs/${run.id}`)}
              >
                <TableCell className="font-mono text-sm">{run.id}</TableCell>
                <TableCell>{run.environment}</TableCell>
                <TableCell align="center">
                  <RunResultChip result={run.result} />
                </TableCell>
                <TableCell>{new Date(run.started_at).toLocaleString()}</TableCell>
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
