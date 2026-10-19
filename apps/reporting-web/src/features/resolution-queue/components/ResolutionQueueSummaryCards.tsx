import { Box, Card, CardContent, Chip, Typography } from '@mui/material';
import {
  RESOLUTION_KIND,
  RESOLUTION_WORKFLOW_STATUS,
} from '@qakit/reporting-shared';
import type { ResolutionQueueSummaryResponseDto } from '@qakit/reporting-shared';
import { KIND_LABEL, WORKFLOW_STATUS_LABEL } from '../types';

/**
 * The queue header: where the work actually is, before any filter is applied.
 *
 * "Needs a decision" and "Recurred" lead because they are the two states with a person waiting on
 * the other side. Unclassified is shown last and plainly — on a fresh import it is nearly the
 * whole queue, and dressing that up as an alert would make the row meaningless.
 */
export function ResolutionQueueSummaryCards({
  summary,
}: {
  summary: ResolutionQueueSummaryResponseDto | null;
}) {
  if (!summary) return null;

  const tiles = [
    {
      label: 'Waiting for decision',
      value: summary.by_status[RESOLUTION_WORKFLOW_STATUS.WAITING_FOR_DECISION],
      tone: 'text-amber-600',
    },
    {
      label: 'Recurred after verification',
      value: summary.by_status[RESOLUTION_WORKFLOW_STATUS.RECURRED],
      tone: 'text-red-600',
    },
    {
      label: 'Ready for rerun',
      value: summary.by_status[RESOLUTION_WORKFLOW_STATUS.READY_FOR_RERUN],
      tone: 'text-sky-700',
    },
    {
      label: 'Verified',
      value: summary.by_status[RESOLUTION_WORKFLOW_STATUS.VERIFIED],
      tone: 'text-green-700',
    },
    {
      label: 'Unclassified',
      value: summary.by_kind[RESOLUTION_KIND.UNCLASSIFIED],
      tone: 'text-dark-900',
    },
  ];

  const kinds = Object.values(RESOLUTION_KIND)
    .filter((k) => k !== RESOLUTION_KIND.UNCLASSIFIED && summary.by_kind[k] > 0)
    .map((k) => ({ kind: k, total: summary.by_kind[k] }));

  return (
    <Box className="space-y-3">
      <Box className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardContent className="py-3">
              <Typography variant="caption" className="text-gray-500">
                {tile.label}
              </Typography>
              <Typography variant="h5" className={`font-bold ${tile.tone}`}>
                {tile.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
      <Box className="flex flex-wrap items-center gap-2">
        <Typography variant="caption" className="text-gray-500">
          {summary.total} issues total
        </Typography>
        {Object.values(RESOLUTION_WORKFLOW_STATUS)
          .filter((s) => summary.by_status[s] > 0)
          .map((s) => (
            <Chip
              key={s}
              size="small"
              variant="outlined"
              label={`${WORKFLOW_STATUS_LABEL[s]}: ${summary.by_status[s]}`}
            />
          ))}
        {kinds.map(({ kind, total }) => (
          <Chip key={kind} size="small" label={`${KIND_LABEL[kind]}: ${total}`} />
        ))}
      </Box>
    </Box>
  );
}
