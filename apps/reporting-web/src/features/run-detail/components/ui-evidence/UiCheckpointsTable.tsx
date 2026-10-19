import {
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import { UI_EVIDENCE_KIND, summarizeCheckStatuses } from '@qakit/reporting-shared';

import { apiUrl } from '@/shared/api/apiUrl';

import { CheckStatusIcon, checkSummaryText } from '../CheckStatusCell';
import {
  CheckpointLabel,
  CheckpointPriorityCell,
  ChecklistRuleCell,
} from '../CheckpointLabel';
import type { RunChecks, UiEvidence } from './types';

function formatCheckValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * What a QA reviewer reads first: the checklist rule the row answers, the assertion itself, what
 * was expected, what the screen actually showed, and the proof.
 *
 * The `Proof` column links a checkpoint to the screenshot taken for it, matching the
 * manifest's `check_test_id` against `TestRunCheck.test_id` — the runner writes both as the
 * same string, e.g. `TC-UI-A01 / A2`.
 */
export function UiCheckpointsTable({
  checks,
  evidence,
}: {
  checks: RunChecks;
  evidence: UiEvidence;
}) {
  if (!checks.length) return null;

  const screenshotByCheckId = new Map(
    evidence.items
      .filter(
        (item) =>
          item.kind === UI_EVIDENCE_KIND.SCREENSHOT && item.check_test_id,
      )
      .map((item) => [item.check_test_id as string, item]),
  );

  const totals = summarizeCheckStatuses(checks);

  return (
    <Card>
      <CardHeader
        title={`Checkpoints (${checks.length})`}
        subheader={checkSummaryText(totals)}
      />
      <CardContent>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell align="center">Priority</TableCell>
                <TableCell>Business Rule</TableCell>
                <TableCell>Checkpoint</TableCell>
                <TableCell align="center">Result</TableCell>
                <TableCell>Expected</TableCell>
                <TableCell>Actual</TableCell>
                <TableCell align="center">Proof</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {checks.map((check) => {
                const shot = check.test_id
                  ? screenshotByCheckId.get(check.test_id)
                  : undefined;
                return (
                  <TableRow key={check.id} hover>
                    <CheckpointPriorityCell check={check} />
                    <ChecklistRuleCell check={check} />
                    <TableCell className="min-w-[220px]">
                      <CheckpointLabel check={check} />
                    </TableCell>
                    <TableCell align="center">
                      <CheckStatusIcon status={check.status} />
                    </TableCell>
                    <TableCell
                      className="max-w-[240px]"
                      title={formatCheckValue(check.expected)}
                    >
                      <span className="block truncate font-mono text-xs">
                        {formatCheckValue(check.expected)}
                      </span>
                    </TableCell>
                    <TableCell
                      className="max-w-[240px]"
                      title={formatCheckValue(check.actual)}
                    >
                      <span className="block truncate font-mono text-xs">
                        {formatCheckValue(check.actual)}
                      </span>
                    </TableCell>
                    <TableCell align="center">
                      {shot ? (
                        <a
                          href={apiUrl(shot.url)}
                          target="_blank"
                          rel="noreferrer"
                          title={shot.label}
                        >
                          <ImageIcon fontSize="small" className="text-primary-600" />
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
