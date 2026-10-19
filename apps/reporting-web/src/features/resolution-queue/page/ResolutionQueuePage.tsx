import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Alert, Box, Button, Snackbar, Tooltip, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { AsyncSection } from '@/shared/components/AsyncState';
import { downloadBlob } from '@/shared/api/downloadBlob';
import { useResolutionQueueStore } from '../../../app/store/provider';
import { ResolutionFilters } from '../components/ResolutionFilters';
import { ResolutionIssueTable } from '../components/ResolutionIssueTable';
import { ResolutionQueueSummaryCards } from '../components/ResolutionQueueSummaryCards';

export const ResolutionQueuePage = observer(() => {
  const store = useResolutionQueueStore();

  useEffect(() => {
    void store.loadIssues();
    void store.loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // The store fetches; saving to disk is the one part that needs the DOM, so it stays here.
  const handleExport = async () => {
    const result = await store.exportCsv();
    if (result) downloadBlob(result.blob, result.filename);
  };

  return (
    <Box className="space-y-4">
      <Box className="flex flex-wrap items-start justify-between gap-3">
        <Box>
          <Typography variant="h4" className="font-bold text-dark-900">
            Resolution Queue
          </Typography>
          <Typography variant="body2" className="text-gray-500">
            Blockers behind unresolved evidence — BLOCKED and ERROR runs, and the assertions a run
            could not score. These are not confirmed product defects: most are questions the source
            does not answer yet.
          </Typography>
        </Box>
        <Tooltip title="Downloads exactly what these filters select, one row per affected test case — for updating the spec documents and testcases">
          <span>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              disabled={store.isExporting}
              onClick={() => void handleExport()}
            >
              {store.isExporting ? 'Exporting…' : 'Export CSV'}
            </Button>
          </span>
        </Tooltip>
      </Box>

      <ResolutionQueueSummaryCards summary={store.summary} />

      <ResolutionFilters initial={store.filters} onApply={(f) => store.applyFilters(f)} />

      <AsyncSection
        isLoading={store.isLoadingList}
        error={store.listError}
        isEmpty={!store.isLoadingList && !store.listError && store.issues.length === 0}
        emptyTitle="No issues match these filters"
        emptyDescription="Unresolved evidence appears here after `pnpm db:sync` imports a regression batch."
        onRetry={() => void store.loadIssues()}
      >
        <ResolutionIssueTable
          issues={store.issues}
          total={store.totalIssues}
          page={store.currentPage}
          pageSize={store.pageSize}
          sortBy={store.filters.sort_by ?? 'last_seen_at'}
          sortOrder={store.filters.sort_order ?? 'DESC'}
          onPageChange={(page) => store.setPage(page)}
          onSortChange={(sortBy, sortOrder) => store.setSort(sortBy, sortOrder)}
        />
      </AsyncSection>

      <Snackbar
        open={Boolean(store.actionError)}
        autoHideDuration={8000}
        onClose={() => store.clearActionError()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => store.clearActionError()}>
          {store.actionError}
        </Alert>
      </Snackbar>
    </Box>
  );
});
