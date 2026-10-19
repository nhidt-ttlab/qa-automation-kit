import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from '@mui/material';
import type { RegressionPreviewResponseDto } from '@qakit/reporting-shared';
import { AsyncSection } from '../../../shared/components/AsyncState';
import { PREVIEW_SAMPLE_SIZE, type CleanChoice } from '../types';

/**
 * The confirmation step, and the only thing standing between a click and an irreversible delete.
 *
 * It is never skippable, for two independent reasons. It is the one warning before clean-all, and
 * it is the only place the user learns what the selector actually matched - a grep of `TC-DH-L0`
 * quietly takes nine scenarios, and a "rerun this one test" that silently ran nine would be worse
 * than a slow click.
 */
export function RunPreviewDialog({
  open,
  preview,
  isLoading,
  error,
  clean,
  writeMode,
  customEnv,
  isSubmitting,
  conflictJobId,
  actionError,
  onChangeClean,
  onWatchConflict,
  onRetry,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  preview: RegressionPreviewResponseDto | null;
  isLoading: boolean;
  error: string | null;
  clean: CleanChoice;
  writeMode: boolean;
  /**
   * The custom parameters about to be set, from the draft rather than from `preview.warnings`.
   * The preview endpoint takes the selector only - the same reason `writeMode` is a prop here -
   * so the server's matching advisory is a backstop for API callers, not this dialog's source.
   */
  customEnv?: Record<string, string>;
  isSubmitting: boolean;
  conflictJobId: number | null;
  actionError: string | null;
  onChangeClean: (clean: CleanChoice) => void;
  onWatchConflict: (jobId: number) => void;
  onRetry: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = preview?.total ?? 0;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>Confirm this regression run</DialogTitle>
      <DialogContent dividers>
        {/* The body is a read, so it reuses the same AsyncSection every list in the app uses. */}
        <AsyncSection
          isLoading={isLoading}
          error={error}
          isEmpty={!isLoading && !error && total === 0}
          emptyTitle="No scenario matches this selection"
          emptyDescription={
            preview?.known_module_tokens?.length
              ? `Valid module tokens: ${preview.known_module_tokens.join(', ')}`
              : undefined
          }
          onRetry={onRetry}
        >
          <Box className="flex flex-col gap-3">
            <Typography variant="subtitle1">
              <strong>{total}</strong> scenario{total === 1 ? '' : 's'} match
              {preview?.label ? ` — ${preview.label}` : ''}
            </Typography>

            <TableContainer className="max-h-[280px] overflow-auto">
              <Table size="small">
                <TableBody>
                  {(preview?.items ?? []).slice(0, PREVIEW_SAMPLE_SIZE).map((item) => (
                    <TableRow key={`${item.test_case_id}:${item.scenario}`}>
                      <TableCell className="font-mono">{item.test_case_id}</TableCell>
                      <TableCell>{item.kind}</TableCell>
                      <TableCell>{item.domain}</TableCell>
                      <TableCell className="font-mono">{item.scenario}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {total > PREVIEW_SAMPLE_SIZE && (
              <Typography variant="body2" className="text-gray-500">
                + {total - PREVIEW_SAMPLE_SIZE} more
              </Typography>
            )}

            {clean === 'all' && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => onChangeClean('run')}>
                    Clean only these {total} instead
                  </Button>
                }
              >
                <strong>&quot;Clean: Everything&quot; will delete, before anything runs:</strong>
                <ul className="mt-1 mb-0 pl-5">
                  <li>every artifact directory under reports/, outputs/ and evidence/</li>
                  <li>db/regression.db — the runner&apos;s entire local history</li>
                </ul>
                This is <strong>not</strong> limited to the {total} scenario
                {total === 1 ? '' : 's'} above. MCP audit logs, batch summaries and session records
                are kept, reviews/ and proposals/ are untouched, and everything already imported
                into the reporting database stays.
              </Alert>
            )}

            {writeMode && (
              <Alert severity="warning">
                <strong>Destructive writes are enabled.</strong> The runner's write switch is on — this
                run creates and modifies real records in the shared QA tenant.
              </Alert>
            )}

            {/*
              Names AND values, unlike the server-side advisory. A custom parameter can change what
              a suite measures - which projects, which fixture - and the value is the part that
              decides that, so confirming the run without seeing it would be confirming nothing.
            */}
            {customEnv && Object.keys(customEnv).length > 0 && (
              <Alert severity="info">
                <strong>Custom parameters</strong> will be set in the runner's environment:
                <ul className="mt-1 mb-0 pl-5">
                  {Object.entries(customEnv).map(([name, value]) => (
                    <li key={name} className="font-mono text-xs break-all">
                      {name}={value}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}

            {(preview?.warnings ?? [])
              .filter((w) => !w.startsWith('Clean scope') && !w.startsWith('Destructive'))
              .map((w) => (
                <Alert key={w} severity="info">
                  {w}
                </Alert>
              ))}

            {/* A 409 is not a dead end: offer the run that is already going. */}
            {actionError && (
              <Alert
                severity={conflictJobId ? 'info' : 'error'}
                action={
                  conflictJobId ? (
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => onWatchConflict(conflictJobId)}
                    >
                      Watch it
                    </Button>
                  ) : undefined
                }
              >
                {actionError}
              </Alert>
            )}
          </Box>
        </AsyncSection>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={total === 0 || isLoading || isSubmitting}
        >
          {isSubmitting ? 'Starting…' : `Run ${total} scenario${total === 1 ? '' : 's'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
