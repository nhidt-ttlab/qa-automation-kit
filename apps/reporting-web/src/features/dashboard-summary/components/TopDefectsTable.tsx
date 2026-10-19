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

import { DefectSeverityChip } from '@/features/defect-signature-list/components/DefectSeverityChip';

interface TopDefectsTableProps {
  defects: DashboardSummaryResponseDto['top_defects'];
}

export function TopDefectsTable({ defects }: TopDefectsTableProps) {
  if (!defects.length) {
    return null;
  }

  return (
    // The table sits directly on the card: a `Paper` container inside a card draws a second
    // border and shadow around the same content.
    <Card>
      <CardHeader
        title="Top Recurring Defects"
        titleTypographyProps={{ variant: 'h6' }}
        sx={{ pb: 1.5 }}
      />
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Defect Title</TableCell>
              <TableCell align="center">Occurrences</TableCell>
              <TableCell align="center">Severity</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {defects.map((defect) => (
              <TableRow key={defect.id} hover>
                <TableCell>{defect.title}</TableCell>
                <TableCell align="center" className="font-semibold">
                  {defect.observation_count}
                </TableCell>
                <TableCell align="center">
                  <DefectSeverityChip severity={defect.severity} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}
