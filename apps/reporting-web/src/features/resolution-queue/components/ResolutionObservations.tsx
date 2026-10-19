import { Link } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { CHECK_STATUS } from '@qakit/reporting-shared';
import type { ResolutionIssueDetailResponseDto } from '@qakit/reporting-shared';
import { CheckStatusIcon } from '../../run-detail/components/CheckStatusCell';

/**
 * The evidence behind the issue: which test cases and runs it was observed in, and the verbatim
 * reason each occurrence recorded.
 *
 * Unresolved checks render through the same `CheckStatusIcon` the run detail page uses, so a
 * NOT_EVALUATED assertion shows as the amber "could not be scored" marker here too and never as
 * a green tick — the raw `passed` flag on these rows is `true` by construction.
 */
export function ResolutionObservations({
  issue,
}: {
  issue: ResolutionIssueDetailResponseDto;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Affected test cases (${issue.affected_test_cases.length})`}
          subheader={`${issue.affected_runs.length} run(s), ${issue.observation_count} occurrence(s)`}
        />
        <CardContent className="pt-0">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Test case</TableCell>
                <TableCell>Scenario</TableCell>
                <TableCell align="center">Occurrences</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {issue.affected_test_cases.map((tc) => (
                <TableRow key={tc.test_case_id} hover>
                  <TableCell>
                    <Link to={`/test-cases/${tc.test_case_id}`} className="font-mono text-sm">
                      {tc.test_case_id}
                    </Link>
                    {tc.title && (
                      <Typography variant="caption" className="block text-gray-500">
                        {tc.title}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{tc.scenario_key}</TableCell>
                  <TableCell align="center">{tc.observation_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title={`Unresolved evidence (${issue.observations.length})`}
          subheader="Newest first. Reasons are shown exactly as the runner recorded them."
        />
        <CardContent className="pt-0">
          {issue.observations.map((o) => (
            <Accordion key={o.id} disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <div className="flex w-full flex-wrap items-center gap-2">
                  {o.observed_result === 'NOT_EVALUATED' ? (
                    <CheckStatusIcon status={CHECK_STATUS.NOT_EVALUATED} />
                  ) : (
                    <Chip label={o.observed_result} size="small" variant="outlined" />
                  )}
                  <Typography variant="body2" className="font-mono">
                    {o.check_test_id ?? (o.check_sequence != null ? `check ${o.check_sequence}` : 'run-level')}
                  </Typography>
                  <Link to={`/runs/${o.run_id}`} className="font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                    {o.run_id}
                  </Link>
                  <Typography variant="caption" className="ml-auto text-gray-500">
                    {new Date(o.observed_at).toLocaleString()}
                  </Typography>
                </div>
              </AccordionSummary>
              <AccordionDetails>
                {o.check_label && (
                  <Typography variant="body2" className="mb-2 text-dark-900">
                    {o.check_label}
                  </Typography>
                )}
                {/* Plain text, never HTML: reasons routinely contain markup-looking characters
                    and are written by scenario authors, not by this app. */}
                <Typography
                  variant="body2"
                  component="pre"
                  className="whitespace-pre-wrap break-words rounded bg-gray-50 p-3 font-mono text-xs text-dark-900"
                >
                  {o.raw_reason}
                </Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
