import { useEffect } from 'react';

import { observer } from 'mobx-react-lite';
import { Box, Typography } from '@mui/material';

import { useDashboardStore } from '@/app/store/provider';
import { AsyncSection } from '@/shared/components/AsyncState';

import { DashboardCards } from '../components/DashboardCards';
import { DomainBreakdownTable } from '../components/DomainBreakdownTable';
import { TopDefectsTable } from '../components/TopDefectsTable';
import { RecentFailuresTable } from '../components/RecentFailuresTable';
import { ResolutionQueueBreakdown } from '../components/ResolutionQueueBreakdown';

export const DashboardPage = observer(() => {
  const dashboardStore = useDashboardStore();

  useEffect(() => {
    void dashboardStore.loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardStore]);

  const data = dashboardStore.dashboardData;

  return (
    <Box className="space-y-6">
      <Typography variant="h4" className="font-bold text-dark-900">
        Dashboard
      </Typography>

      <AsyncSection
        isLoading={dashboardStore.isLoading}
        error={dashboardStore.error}
        isEmpty={!dashboardStore.isLoading && !dashboardStore.error && !data}
        emptyTitle="No dashboard data available"
        onRetry={() => void dashboardStore.loadSummary()}
      >
        {data && (
          <Box className="space-y-6">
            <DashboardCards data={data} />
            <ResolutionQueueBreakdown data={data} />
            <DomainBreakdownTable rows={data.by_domain ?? []} />
            <TopDefectsTable defects={data.top_defects} />
            <RecentFailuresTable failures={data.recent_failures} />
          </Box>
        )}
      </AsyncSection>
    </Box>
  );
});
