import {
  Card,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
} from '@mui/material';
import type { DefectSignatureSummaryResponseDto } from '@qakit/reporting-shared';

import { DefectSeverityChip } from './DefectSeverityChip';

interface DefectListTableProps {
  defects: DefectSignatureSummaryResponseDto[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function DefectListTable({ defects, total, page, pageSize, onPageChange }: DefectListTableProps) {
  return (
    <Card>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Scenario</TableCell>
              <TableCell align="center">Severity</TableCell>
              <TableCell align="center">Status</TableCell>
              <TableCell align="center">Occurrences</TableCell>
              <TableCell align="center">Bug Links</TableCell>
              <TableCell>Last Seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {defects.map((defect) => (
              <TableRow key={defect.id} hover>
                <TableCell>{defect.title}</TableCell>
                <TableCell>{defect.scenario_key}</TableCell>
                <TableCell align="center">
                  <DefectSeverityChip severity={defect.severity} />
                </TableCell>
                <TableCell align="center">
                  <Chip label={defect.status} size="small" variant="outlined" />
                </TableCell>
                <TableCell align="center" className="font-semibold">
                  {defect.observation_count}
                </TableCell>
                <TableCell align="center">{defect.bug_link_count}</TableCell>
                <TableCell>{new Date(defect.last_seen_at).toLocaleString()}</TableCell>
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
