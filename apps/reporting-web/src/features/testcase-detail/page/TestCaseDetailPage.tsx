import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Box } from '@mui/material';

import { useTestCaseDetailStore } from '@/app/store/provider';
import { AsyncSection } from '@/shared/components/AsyncState';
import { PageHeader } from '@/shared/components/PageHeader';
import { RerunButton } from '@/features/regression-run';

import { TestCaseOverviewCard } from '../components/TestCaseOverviewCard';
import { TestCaseRunHistoryTable } from '../components/TestCaseRunHistoryTable';

export const TestCaseDetailPage = observer(() => {
  const { id } = useParams<{ id: string }>();
  const testCaseDetailStore = useTestCaseDetailStore();

  useEffect(() => {
    if (id) {
      void testCaseDetailStore.loadTestCase(id);
      void testCaseDetailStore.loadRunHistory(id, 1);
    }
    return () => testCaseDetailStore.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, testCaseDetailStore]);

  const testCase = testCaseDetailStore.selectedTestCase;

  return (
    <Box className="space-y-4">
      <PageHeader
        title="Test Case Details"
        backFallback="/"
        actions={
          testCase && (
            <RerunButton
              testCaseIds={[testCase.id]}
              kind={testCase.run_type}
              label="Rerun this test case"
            />
          )
        }
      />

      <AsyncSection
        isLoading={testCaseDetailStore.isLoading}
        error={testCaseDetailStore.error}
        isEmpty={!testCaseDetailStore.isLoading && !testCaseDetailStore.error && !testCase}
        emptyTitle="Test case not found"
        onRetry={() => id && void testCaseDetailStore.loadTestCase(id)}
      >
        {testCase && <TestCaseOverviewCard testCase={testCase} />}
      </AsyncSection>

      <AsyncSection
        isLoading={testCaseDetailStore.isLoadingRuns}
        error={testCaseDetailStore.runsError}
        isEmpty={!testCaseDetailStore.isLoadingRuns && !testCaseDetailStore.runsError && testCaseDetailStore.runs.length === 0}
        emptyTitle="No run history"
        emptyDescription="This test case has not been executed yet."
        onRetry={() => id && void testCaseDetailStore.loadRunHistory(id, testCaseDetailStore.currentPage)}
      >
        <TestCaseRunHistoryTable
          runs={testCaseDetailStore.runs}
          total={testCaseDetailStore.totalRuns}
          page={testCaseDetailStore.currentPage}
          pageSize={testCaseDetailStore.pageSize}
          onPageChange={(page) => testCaseDetailStore.setPage(page)}
        />
      </AsyncSection>
    </Box>
  );
});
