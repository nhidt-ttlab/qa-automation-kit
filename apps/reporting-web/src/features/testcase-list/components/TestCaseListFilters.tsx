import { useState } from 'react';
import { Box, Button, MenuItem, TextField } from '@mui/material';
import type { RunType, TestRunResult } from '@qakit/reporting-shared';
import { TEST_RUN_RESULT } from '@qakit/reporting-shared';

import { DomainSelect } from '@/shared/components/GroupingFilters';

interface TestCaseListFiltersProps {
  /** Active tab; scopes the Feature options to domains that have cases of this layer. */
  runType: RunType;
  searchText: string;
  latestRunResult: TestRunResult | 'all';
  domain: string;
  csvChecklistId: string;
  csvTestcaseId: string;
  onApply: (filters: {
    searchText: string;
    latestRunResult: TestRunResult | 'all';
    domain: string;
    csvChecklistId: string;
    csvTestcaseId: string;
  }) => void;
}

const LATEST_RESULT_OPTIONS: TestRunResult[] = Object.values(TEST_RUN_RESULT);

export function TestCaseListFilters({
  runType,
  searchText,
  latestRunResult,
  domain,
  csvChecklistId,
  csvTestcaseId,
  onApply,
}: TestCaseListFiltersProps) {
  const [localSearch, setLocalSearch] = useState(searchText);
  const [localResult, setLocalResult] = useState<TestRunResult | 'all'>(latestRunResult);
  const [localDomain, setLocalDomain] = useState(domain);
  const [localChecklistId, setLocalChecklistId] = useState(csvChecklistId);
  const [localTestcaseId, setLocalTestcaseId] = useState(csvTestcaseId);

  const handleApply = () => {
    onApply({
      searchText: localSearch,
      latestRunResult: localResult,
      domain: localDomain,
      csvChecklistId: localChecklistId,
      csvTestcaseId: localTestcaseId,
    });
  };

  const handleReset = () => {
    setLocalSearch('');
    setLocalResult('all');
    setLocalDomain('');
    setLocalChecklistId('');
    setLocalTestcaseId('');
    onApply({
      searchText: '',
      latestRunResult: 'all',
      domain: '',
      csvChecklistId: '',
      csvTestcaseId: '',
    });
  };

  return (
    <Box className="flex flex-wrap items-end gap-3">
      <TextField
        label="Search"
        placeholder="Search by ID, title, or scenario key"
        size="small"
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
      />
      <TextField
        select
        label="Latest Result"
        size="small"
        className="min-w-[140px]"
        value={localResult}
        onChange={(e) => setLocalResult(e.target.value as TestRunResult | 'all')}
      >
        <MenuItem value="all">All</MenuItem>
        {LATEST_RESULT_OPTIONS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <DomainSelect value={localDomain} onChange={setLocalDomain} runType={runType} />
      {/* Free text, like the Feature ID field this pair replaced: both match as substrings, so a
          prefix covers a sheet family or a run of rows. */}
      <TextField
        label="Checklist ID"
        placeholder="Sheet id, e.g. QLDN-VT-04"
        size="small"
        className="min-w-[180px]"
        value={localChecklistId}
        onChange={(e) => setLocalChecklistId(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
      />
      <TextField
        label="Checklist testcase ID"
        placeholder="Row id, e.g. TC_16"
        size="small"
        className="min-w-[200px]"
        value={localTestcaseId}
        onChange={(e) => setLocalTestcaseId(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
      />
      <Button variant="contained" size="medium" onClick={handleApply}>
        Apply
      </Button>
      <Button variant="text" size="medium" onClick={handleReset}>
        Reset
      </Button>
    </Box>
  );
}
