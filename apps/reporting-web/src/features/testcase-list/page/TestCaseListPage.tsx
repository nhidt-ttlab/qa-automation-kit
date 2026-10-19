import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useSearchParams } from 'react-router-dom';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import { RUN_TYPE } from '@qakit/reporting-shared';
import type { RunType } from '@qakit/reporting-shared';

import { useTestCaseListStore } from '@/app/store/provider';
import { ExportReviewsButton } from '@/features/review-run';
import { AsyncSection } from '@/shared/components/AsyncState';

import { TestCaseListFilters } from '../components/TestCaseListFilters';
import { TestCaseListTable } from '../components/TestCaseListTable';

const TAB_QUERY_PARAM = 'type';

function readRunTypeParam(value: string | null): RunType {
  return value === RUN_TYPE.UI ? RUN_TYPE.UI : RUN_TYPE.API;
}

export const TestCaseListPage = observer(() => {
  const testCaseListStore = useTestCaseListStore();
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL is the source of truth for the active tab, so a tab is linkable and survives a
  // reload. This runs on mount and on every back/forward, keeping the two in step.
  const runTypeFromUrl = readRunTypeParam(searchParams.get(TAB_QUERY_PARAM));

  useEffect(() => {
    testCaseListStore.setRunType(runTypeFromUrl);
    // setRunType is a no-op when the value is unchanged, so the initial load still happens here.
    if (testCaseListStore.testCases.length === 0) {
      void testCaseListStore.loadTestCases();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testCaseListStore, runTypeFromUrl]);

  const handleTabChange = (_event: React.SyntheticEvent, value: RunType) => {
    // Only the URL is written here; the effect above turns that into a store update, so there
    // is exactly one path into setRunType and no double reload.
    setSearchParams(
      value === RUN_TYPE.API ? {} : { [TAB_QUERY_PARAM]: value },
      { replace: true },
    );
  };

  const isUiTab = testCaseListStore.runType === RUN_TYPE.UI;

  return (
    <Box className="space-y-4">
      <Box className="flex items-center justify-between gap-2">
        <Typography variant="h4" className="font-bold text-dark-900">
          Test Cases
        </Typography>
        {/* Ignores the tab and filters below on purpose: the file is every reviewed run, API and UI,
            narrowed only by its own "Reviewed from" date. */}
        <ExportReviewsButton />
      </Box>

      <Tabs
        value={testCaseListStore.runType}
        onChange={handleTabChange}
        className="border-b border-gray-200"
      >
        <Tab label="API" value={RUN_TYPE.API} />
        <Tab label="UI" value={RUN_TYPE.UI} />
      </Tabs>

      <TestCaseListFilters
        runType={testCaseListStore.runType}
        searchText={testCaseListStore.searchText}
        latestRunResult={testCaseListStore.latestRunResult}
        domain={testCaseListStore.domain}
        csvChecklistId={testCaseListStore.csvChecklistId}
        csvTestcaseId={testCaseListStore.csvTestcaseId}
        onApply={(filters) => testCaseListStore.applyFilters(filters)}
      />

      <AsyncSection
        isLoading={testCaseListStore.isLoadingList}
        error={testCaseListStore.listError}
        isEmpty={!testCaseListStore.isLoadingList && !testCaseListStore.listError && testCaseListStore.testCases.length === 0}
        emptyTitle={isUiTab ? 'No UI test cases found' : 'No API test cases found'}
        emptyDescription={
          isUiTab
            ? 'UI scenarios appear here once the regression runner has executed them and `pnpm db:sync` has imported their evidence.'
            : 'Run the regression suite to generate test cases, or check back later.'
        }
        onRetry={() => void testCaseListStore.loadTestCases()}
      >
        <TestCaseListTable
          testCases={testCaseListStore.testCases}
          total={testCaseListStore.totalTestCases}
          page={testCaseListStore.currentPage}
          pageSize={testCaseListStore.pageSize}
          runType={testCaseListStore.runType}
          onPageChange={(page) => testCaseListStore.setPage(page)}
        />
      </AsyncSection>
    </Box>
  );
});
