import { observer } from 'mobx-react-lite';
import { Box, Button, Snackbar, Alert, TextField, Tooltip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';

import { downloadBlob } from '@/shared/api/downloadBlob';
import { useReviewStore } from '@/app/store/provider';

/**
 * Downloads the review feedback for **every** reviewed run, not just the one on screen.
 *
 * It sits on the run detail page because that is where reviews are written, but the file is the
 * whole backlog: the point is to hand an agent one list of scenario scripts to update, and a
 * per-run file would be a list of one.
 *
 * The "Reviewed from" date trims that backlog to reviews not yet acted on. It filters by when the
 * review was written, not when the run happened.
 */
export const ExportReviewsButton = observer(() => {
  const reviewStore = useReviewStore();

  // The store fetches; saving to disk is the one part that needs the DOM, so it stays here.
  const handleExport = async () => {
    const result = await reviewStore.exportReviews();
    if (result) downloadBlob(result.blob, result.filename);
  };

  return (
    <Box className="flex items-center gap-2">
      <TextField
        label="Reviewed from"
        type="date"
        size="small"
        className="min-w-[170px]"
        InputLabelProps={{ shrink: true }}
        value={reviewStore.exportReviewedFrom}
        onChange={(e) => reviewStore.setExportReviewedFrom(e.target.value)}
      />
      <Tooltip title="Downloads every run whose latest review was written on or after the chosen day (all reviews when no day is set), one row per suggested step, assertion, test data item or coverage gap — for updating the scenario scripts">
        {/* MUI needs a real element to hang the tooltip on while the button is disabled. */}
        <span>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            disabled={reviewStore.isExportingReviews}
            onClick={() => void handleExport()}
          >
            {reviewStore.isExportingReviews ? 'Exporting…' : 'Export reviews CSV'}
          </Button>
        </span>
      </Tooltip>

      <Snackbar
        open={Boolean(reviewStore.exportError)}
        autoHideDuration={6000}
        onClose={() => reviewStore.clearExportError()}
      >
        <Alert severity="error" onClose={() => reviewStore.clearExportError()}>
          {reviewStore.exportError}
        </Alert>
      </Snackbar>
    </Box>
  );
});
