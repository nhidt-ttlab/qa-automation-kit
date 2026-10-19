import { Chip, Tooltip } from '@mui/material';
import type { ResolutionKind, ResolutionWorkflowStatus } from '@qakit/reporting-shared';
import { StatusChip } from '../../../shared/components/StatusChip';
import { KIND_HINT, KIND_LABEL, WORKFLOW_STATUS_LABEL, WORKFLOW_STATUS_TONE } from '../types';

export function ResolutionStatusChip({ status }: { status: ResolutionWorkflowStatus }) {
  return (
    <StatusChip
      label={WORKFLOW_STATUS_LABEL[status] ?? status}
      tone={WORKFLOW_STATUS_TONE[status] ?? 'neutral'}
    />
  );
}

/**
 * Kind is an outline chip, not a tinted one: it is a category, not a state, and giving it the
 * same visual weight as the workflow status would make every row read as two competing badges.
 */
export function ResolutionKindChip({ kind }: { kind: ResolutionKind }) {
  return (
    <Tooltip title={KIND_HINT[kind] ?? ''}>
      <Chip label={KIND_LABEL[kind] ?? kind} size="small" variant="outlined" />
    </Tooltip>
  );
}
