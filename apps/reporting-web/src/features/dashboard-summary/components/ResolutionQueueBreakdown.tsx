import { Link } from 'react-router-dom';
import {
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
import type { DashboardSummaryResponseDto } from '@qakit/reporting-shared';
import { featureLabel } from '@/shared/components/GroupingFilters';

/**
 * Resolution Queue health on the dashboard.
 *
 * Kept in its own card, next to but never merged with the defect numbers: an unresolved blocker
 * means "the source does not say what to expect", which is a different problem from a confirmed
 * product defect, and adding the two together produces a number that misrepresents both.
 *
 * Each tile links into the queue pre-filtered, so a count is a starting point rather than a fact
 * to write down.
 */
export function ResolutionQueueBreakdown({
  data,
}: {
  data: DashboardSummaryResponseDto;
}) {
  const queue = data.resolution;
  if (!queue) return null;

  const tiles = [
    { label: 'Waiting for decision', value: queue.waiting_for_decision, filter: 'workflow_status=WAITING_FOR_DECISION' },
    { label: 'Recurred', value: queue.recurring, filter: 'workflow_status=RECURRED' },
    { label: 'Ready for rerun', value: queue.ready_for_rerun, filter: 'workflow_status=READY_FOR_RERUN' },
    { label: 'Open', value: queue.open_blockers, filter: 'workflow_status=OPEN' },
    { label: 'Unclassified', value: queue.unclassified, filter: 'kind=UNCLASSIFIED' },
    { label: 'Verified', value: queue.verified, filter: 'workflow_status=VERIFIED' },
  ];

  return (
    <Card>
      <CardHeader
        title="Resolution Queue"
        subheader="Unresolved blockers — not counted as product defects."
        action={
          <Link to="/resolution-queue" className="mr-4 text-sm">
            Open queue
          </Link>
        }
      />
      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {tiles.map((tile) => (
            <Link key={tile.label} to={`/resolution-queue?${tile.filter}`} className="no-underline">
              <div className="rounded border border-gray-200 p-3">
                <Typography variant="caption" className="text-gray-500">
                  {tile.label}
                </Typography>
                <Typography variant="h6" className="font-bold text-dark-900">
                  {tile.value}
                </Typography>
              </div>
            </Link>
          ))}
        </div>

        {queue.by_kind.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {queue.by_kind.map((k) => (
              <Chip
                key={k.kind}
                size="small"
                variant="outlined"
                label={`${k.kind.replaceAll('_', ' ').toLowerCase()}: ${k.total}`}
              />
            ))}
          </div>
        )}

        {queue.oldest_unresolved.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Longest unresolved</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>First seen</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {queue.oldest_unresolved.map((i) => (
                <TableRow key={i.id} hover>
                  <TableCell>
                    <Link to={`/resolution-queue/${i.id}`} className="font-mono text-sm">
                      {i.display_key}
                    </Link>
                    <Typography variant="caption" className="block text-gray-500" noWrap>
                      {i.title}
                    </Typography>
                  </TableCell>
                  <TableCell>{i.workflow_status.replaceAll('_', ' ').toLowerCase()}</TableCell>
                  <TableCell>{new Date(i.first_seen_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {queue.by_domain.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {queue.by_domain.slice(0, 8).map((d) => (
              <Chip
                key={d.domain}
                size="small"
                label={`${featureLabel(d.domain)}: ${d.unresolved}`}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
