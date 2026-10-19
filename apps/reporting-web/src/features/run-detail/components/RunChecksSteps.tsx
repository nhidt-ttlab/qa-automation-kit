import {
  Card,
  CardHeader,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';
import { summarizeCheckStatuses } from '@qakit/reporting-shared';

import { CheckStatusIcon, checkSummaryText } from './CheckStatusCell';
import {
  CheckpointLabel,
  CheckpointPriorityCell,
  ChecklistRuleCell,
} from './CheckpointLabel';

type Checks = NonNullable<TestRunDetailResponseDto['checks']>;
type Steps = NonNullable<TestRunDetailResponseDto['steps']>;

function formatCheckValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function RunChecksTable({ checks }: { checks: Checks }) {
  if (!checks.length) return null;

  const totals = summarizeCheckStatuses(checks);

  return (
    <Card>
      <CardHeader
        title={`Checks (${checks.length})`}
        subheader={checkSummaryText(totals)}
      />
      <CardContent>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell align="center">Priority</TableCell>
                <TableCell>Business Rule</TableCell>
                <TableCell>Name</TableCell>
                <TableCell align="center">Result</TableCell>
                <TableCell>Expected</TableCell>
                <TableCell>Actual</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {checks.map((check) => (
                <TableRow key={check.id} hover>
                  <CheckpointPriorityCell check={check} />
                  <ChecklistRuleCell check={check} />
                  <TableCell className="min-w-[220px]">
                    <CheckpointLabel check={check} />
                  </TableCell>
                  <TableCell align="center">
                    <CheckStatusIcon status={check.status} />
                  </TableCell>
                  <TableCell className="max-w-[240px]" title={formatCheckValue(check.expected)}>
                    <span className="block truncate font-mono text-xs">
                      {formatCheckValue(check.expected)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[240px]" title={formatCheckValue(check.actual)}>
                    <span className="block truncate font-mono text-xs">
                      {formatCheckValue(check.actual)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

export function RunStepsList({ steps }: { steps: Steps }) {
  if (!steps.length) return null;

  return (
    <Card>
      <CardHeader title={`Steps (${steps.length})`} />
      <CardContent className="space-y-2">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2 border-b border-gray-100 py-2 last:border-0">
            <Chip
              label={step.status}
              size="small"
              color={step.status === 'passed' ? 'success' : step.status === 'failed' ? 'error' : 'default'}
            />
            <span className="text-sm">{step.name}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
