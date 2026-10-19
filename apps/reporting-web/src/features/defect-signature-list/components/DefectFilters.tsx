import { useState } from 'react';
import { Box, Button, MenuItem, TextField } from '@mui/material';
import type { DefectSeverity, DefectSignatureStatus, ListDefectSignaturesQueryDto } from '@qakit/reporting-shared';
import { DEFECT_SEVERITY } from '@qakit/reporting-shared';

import { GroupingFilterSelects } from '@/shared/components/GroupingFilters';

interface DefectFiltersProps {
  initial: Partial<ListDefectSignaturesQueryDto>;
  onApply: (filters: Partial<ListDefectSignaturesQueryDto>) => void;
}

const SEVERITY_OPTIONS: DefectSeverity[] = [
  DEFECT_SEVERITY.CRITICAL,
  DEFECT_SEVERITY.HIGH,
  DEFECT_SEVERITY.MEDIUM,
  DEFECT_SEVERITY.LOW,
];

const STATUS_OPTIONS: DefectSignatureStatus[] = ['draft', 'submitted', 'duplicate', 'resolved', 'wontfix'];

export function DefectFilters({ initial, onApply }: DefectFiltersProps) {
  const [scenarioKey, setScenarioKey] = useState(initial.scenario_key ?? '');
  const [severity, setSeverity] = useState<DefectSeverity | ''>(initial.severity ?? '');
  const [status, setStatus] = useState<DefectSignatureStatus | ''>(initial.status ?? '');
  const [module, setModule] = useState(initial.module ?? '');
  const [domain, setDomain] = useState(initial.domain ?? '');

  const handleApply = () => {
    onApply({
      ...initial,
      scenario_key: scenarioKey || undefined,
      severity: severity || undefined,
      status: status || undefined,
      module: module || undefined,
      domain: domain || undefined,
    });
  };

  const handleReset = () => {
    setScenarioKey('');
    setSeverity('');
    setStatus('');
    setModule('');
    setDomain('');
    onApply({ page: 1, limit: initial.limit });
  };

  return (
    <Box className="flex flex-wrap items-end gap-3">
      <TextField
        label="Scenario key"
        size="small"
        value={scenarioKey}
        onChange={(e) => setScenarioKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
      />
      <TextField
        select
        label="Severity"
        size="small"
        className="min-w-[140px]"
        value={severity}
        onChange={(e) => setSeverity(e.target.value as DefectSeverity | '')}
      >
        <MenuItem value="">All</MenuItem>
        {SEVERITY_OPTIONS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Status"
        size="small"
        className="min-w-[140px]"
        value={status}
        onChange={(e) => setStatus(e.target.value as DefectSignatureStatus | '')}
      >
        <MenuItem value="">All</MenuItem>
        {STATUS_OPTIONS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <GroupingFilterSelects
        module={module}
        domain={domain}
        onModuleChange={setModule}
        onDomainChange={setDomain}
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
