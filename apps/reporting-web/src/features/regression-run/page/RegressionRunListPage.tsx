import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Alert, Box, Snackbar, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { RegressionJobSummaryResponseDto } from '@qakit/reporting-shared';
import { AsyncSection } from '../../../shared/components/AsyncState';
import { useRegressionRunStore } from '../../../app/store/provider';
import { RunJobHistoryTable } from '../components/RunJobHistoryTable';
import { RunPreviewDialog } from '../components/RunPreviewDialog';
import { RunTriggerForm } from '../components/RunTriggerForm';
import { WorkspaceSyncCard } from '../components/WorkspaceSyncCard';
import { customEnvFromDraft, draftFromSearchParams, isLiveStatus } from '../types';

/** How often the list refreshes while a job is live. See the note on the effect below. */
const LIVE_POLL_MS = 5000;

export const RegressionRunListPage = observer(() => {
  const store = useRegressionRunStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    void store.loadOptions();
    void store.loadJobs();
    void store.loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // The Rerun contract: a link carries the selection in query params, which survive a reload and
  // can be pasted into a ticket. Consumed once and cleared, so re-running this effect cannot
  // clobber edits the user has made since.
  useEffect(() => {
    if (searchParams.toString() === '') return;
    store.patchDraft(draftFromSearchParams(searchParams));
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, searchParams]);

  // The app's first poller, introduced deliberately and kept narrow: it runs only while a live job
  // is actually in the list, and stops as soon as none is. The common case never sees it, because
  // starting a run navigates straight to the detail page where the SSE stream drives everything.
  const hasLiveJob = store.jobs.some((j) => isLiveStatus(j.status));
  useEffect(() => {
    if (!hasLiveJob) return undefined;
    const timer = setInterval(() => void store.refreshJobs(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [store, hasLiveJob]);

  const handleConfirm = async (): Promise<void> => {
    const id = await store.createJob();
    if (id !== null) navigate(`/regression-runs/${id}`);
  };

  const handleRerun = (job: RegressionJobSummaryResponseDto): void => {
    store.patchDraft({
      kind: job.kind ?? '',
      modules: job.modules,
      testCaseIds: job.test_case_ids,
      grep: job.grep ?? '',
      environment: job.environment,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Box className="flex flex-col gap-6">
      <Box>
        <Typography variant="h4" className="font-bold text-dark-900">
          Regression Runs
        </Typography>
        <Typography variant="body2" className="text-gray-500">
          Start a batch against the QA tenant. Nothing runs until you confirm the preview, which
          shows exactly which scenarios match and what gets deleted.
        </Typography>
      </Box>

      <WorkspaceSyncCard store={store} />

      <RunTriggerForm store={store} onPreview={() => void store.openPreview()} />

      <Box className="flex flex-col gap-2">
        <Typography variant="h6">Recent runs</Typography>
        <AsyncSection
          isLoading={store.isLoadingJobs}
          error={store.jobsError}
          isEmpty={store.jobs.length === 0}
          emptyTitle="No regression runs yet"
          emptyDescription="Runs started from this screen appear here."
          onRetry={() => void store.loadJobs()}
        >
          <RunJobHistoryTable
            jobs={store.jobs}
            total={store.totalJobs}
            page={store.currentPage}
            pageSize={store.pageSize}
            onPageChange={(page) => store.setPage(page)}
            onCancel={(id) => void store.cancelJob(id)}
            onRerun={handleRerun}
          />
        </AsyncSection>
      </Box>

      <RunPreviewDialog
        open={store.isPreviewOpen}
        preview={store.preview}
        isLoading={store.isLoadingPreview}
        error={store.previewError}
        clean={store.draft.clean}
        writeMode={store.draft.writeMode}
        customEnv={customEnvFromDraft(store.draft)}
        isSubmitting={store.isSubmitting}
        conflictJobId={store.conflictJobId}
        actionError={store.actionError}
        onChangeClean={(clean) => store.patchDraft({ clean })}
        onWatchConflict={(jobId) => {
          store.closePreview();
          navigate(`/regression-runs/${jobId}`);
        }}
        onRetry={() => void store.openPreview()}
        onCancel={() => store.closePreview()}
        onConfirm={() => void handleConfirm()}
      />

      {/* Write errors go to a Snackbar; read errors render inline through AsyncSection. */}
      <Snackbar
        open={Boolean(store.actionError) && !store.isPreviewOpen}
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
