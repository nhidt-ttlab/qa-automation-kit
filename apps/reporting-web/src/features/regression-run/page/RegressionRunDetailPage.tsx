import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Alert, Box, Button, Snackbar } from '@mui/material';
import { DownloadRounded, StopRounded } from '@mui/icons-material';
import { useParams } from 'react-router-dom';
import { AsyncSection } from '../../../shared/components/AsyncState';
import { PageHeader } from '../../../shared/components/PageHeader';
import { downloadBlob } from '../../../shared/api/downloadBlob';
import { useRegressionRunStore } from '../../../app/store/provider';
import { LiveConsole } from '../components/LiveConsole';
import { RunJobSummaryCard } from '../components/RunJobSummaryCard';
import { isLiveStatus } from '../types';

export const RegressionRunDetailPage = observer(() => {
  const store = useRegressionRunStore();
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);

  useEffect(() => {
    if (!Number.isFinite(jobId)) return undefined;
    void store.loadJob(jobId);
    store.openStream(jobId);
    return () => {
      store.closeStream();
      // clearJob, not reset: reset would discard the form draft, which is the whole reason the
      // draft lives in the store.
      store.clearJob();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, jobId]);

  const job = store.job;
  const live = job ? isLiveStatus(job.status) : false;

  // A DOM side effect belongs in the page, not the store, so the store stays testable without a
  // browser. Same shape as ResolutionQueuePage's CSV export.
  const handleDownload = async (): Promise<void> => {
    const tail = await store.getFullLogText(jobId);
    if (tail !== null) {
      downloadBlob(new Blob([tail], { type: 'text/plain' }), `regression-job-${jobId}.log`);
    }
  };

  return (
    <Box className="flex flex-col gap-4">
      <PageHeader
        title={`Regression run #${id}`}
        backFallback="/regression-runs"
        actions={
          <Box className="flex gap-2">
            {live && (
              <Button
                variant="outlined"
                color="warning"
                startIcon={<StopRounded />}
                disabled={store.isSubmitting}
                onClick={() => void store.cancelJob(jobId)}
              >
                Cancel run
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<DownloadRounded />}
              onClick={() => void handleDownload()}
            >
              Download full log
            </Button>
          </Box>
        }
      />

      <AsyncSection
        isLoading={store.isLoadingJob && !job}
        error={store.jobError}
        isEmpty={!store.isLoadingJob && !job}
        emptyTitle="This run was not found"
        onRetry={() => void store.loadJob(jobId)}
      >
        {job && <RunJobSummaryCard job={job} />}
      </AsyncSection>

      {/* The store is passed down, never `store.logLines` — see the note in LiveConsole. */}
      <LiveConsole store={store} />

      <Snackbar
        open={Boolean(store.actionError)}
        autoHideDuration={8000}
        onClose={() => store.clearActionError()}
      >
        <Alert severity="error" onClose={() => store.clearActionError()}>
          {store.actionError}
        </Alert>
      </Snackbar>
    </Box>
  );
});
