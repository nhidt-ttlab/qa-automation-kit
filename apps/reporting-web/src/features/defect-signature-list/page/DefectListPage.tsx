import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Typography } from '@mui/material';

import { useDefectStore } from '@/app/store/provider';
import { AsyncSection } from '@/shared/components/AsyncState';

import { DefectFilters } from '../components/DefectFilters';
import { DefectListTable } from '../components/DefectListTable';

export const DefectListPage = observer(() => {
  const defectStore = useDefectStore();

  useEffect(() => {
    void defectStore.loadDefects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defectStore]);

  return (
    <Box className="space-y-4">
      <Typography variant="h4" className="font-bold text-dark-900">
        Defects
      </Typography>

      <DefectFilters initial={defectStore.filters} onApply={(filters) => defectStore.applyFilters(filters)} />

      <AsyncSection
        isLoading={defectStore.isLoadingList}
        error={defectStore.error}
        isEmpty={!defectStore.isLoadingList && !defectStore.error && defectStore.defects.length === 0}
        emptyTitle="No defects found"
        emptyDescription="No recurring defects have been recorded for the current filters."
        onRetry={() => void defectStore.loadDefects()}
      >
        <DefectListTable
          defects={defectStore.defects}
          total={defectStore.totalDefects}
          page={defectStore.currentPage}
          pageSize={defectStore.pageSize}
          onPageChange={(page) => defectStore.setPage(page)}
        />
      </AsyncSection>
    </Box>
  );
});
