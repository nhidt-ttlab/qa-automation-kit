import { useState } from 'react';
import { Box, Button, MenuItem, TextField } from '@mui/material';
import {
  RESOLUTION_KIND,
  RESOLUTION_OBSERVED_RESULT,
  RESOLUTION_PRIORITY,
  RESOLUTION_WORKFLOW_STATUS,
} from '@qakit/reporting-shared';
import type {
  ListResolutionIssuesQueryDto,
  ResolutionKind,
  ResolutionObservedResult,
  ResolutionPriority,
  ResolutionWorkflowStatus,
} from '@qakit/reporting-shared';
import { GroupingFilterSelects } from '@/shared/components/GroupingFilters';
import { KIND_LABEL, WORKFLOW_STATUS_LABEL } from '../types';

interface ResolutionFiltersProps {
  initial: Partial<ListResolutionIssuesQueryDto>;
  onApply: (filters: Partial<ListResolutionIssuesQueryDto>) => void;
}

const LINK_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'yes', label: 'Linked' },
  { value: 'no', label: 'Not linked' },
];

/** '' means "All" and the key is omitted from the query entirely — never sent as an empty string. */
export function ResolutionFilters({ initial, onApply }: ResolutionFiltersProps) {
  const [q, setQ] = useState(initial.q ?? '');
  const [status, setStatus] = useState<ResolutionWorkflowStatus | ''>(
    initial.workflow_status ?? '',
  );
  const [kind, setKind] = useState<ResolutionKind | ''>(initial.kind ?? '');
  const [priority, setPriority] = useState<ResolutionPriority | ''>(initial.priority ?? '');
  const [owner, setOwner] = useState(initial.owner ?? '');
  const [module, setModule] = useState(initial.module ?? '');
  const [domain, setDomain] = useState(initial.domain ?? '');
  const [scenarioKey, setScenarioKey] = useState(initial.scenario_key ?? '');
  const [observedResult, setObservedResult] = useState<ResolutionObservedResult | ''>(
    initial.observed_result ?? '',
  );
  const [lastSeenFrom, setLastSeenFrom] = useState(initial.last_seen_from ?? '');
  const [hasDefect, setHasDefect] = useState(
    initial.has_defect === undefined ? '' : initial.has_defect ? 'yes' : 'no',
  );
  const [hasRedmine, setHasRedmine] = useState(
    initial.has_redmine === undefined ? '' : initial.has_redmine ? 'yes' : 'no',
  );

  const handleApply = () => {
    onApply({
      ...initial,
      q: q.trim() || undefined,
      workflow_status: status || undefined,
      kind: kind || undefined,
      priority: priority || undefined,
      owner: owner.trim() || undefined,
      module: module || undefined,
      domain: domain || undefined,
      scenario_key: scenarioKey.trim() || undefined,
      observed_result: observedResult || undefined,
      last_seen_from: lastSeenFrom || undefined,
      has_defect: hasDefect === '' ? undefined : hasDefect === 'yes',
      has_redmine: hasRedmine === '' ? undefined : hasRedmine === 'yes',
    });
  };

  const handleReset = () => {
    setQ('');
    setStatus('');
    setKind('');
    setPriority('');
    setOwner('');
    setModule('');
    setDomain('');
    setScenarioKey('');
    setObservedResult('');
    setLastSeenFrom('');
    setHasDefect('');
    setHasRedmine('');
    onApply({ page: 1, limit: initial.limit });
  };

  return (
    <Box className="flex flex-wrap items-end gap-3">
      <TextField
        label="Search"
        placeholder="BL-03, formula, owner note…"
        size="small"
        className="min-w-[220px]"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
      />
      <TextField
        select
        label="Status"
        size="small"
        className="min-w-[190px]"
        value={status}
        onChange={(e) => setStatus(e.target.value as ResolutionWorkflowStatus | '')}
      >
        <MenuItem value="">All</MenuItem>
        {Object.values(RESOLUTION_WORKFLOW_STATUS).map((option) => (
          <MenuItem key={option} value={option}>
            {WORKFLOW_STATUS_LABEL[option]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Kind"
        size="small"
        className="min-w-[190px]"
        value={kind}
        onChange={(e) => setKind(e.target.value as ResolutionKind | '')}
      >
        <MenuItem value="">All</MenuItem>
        {Object.values(RESOLUTION_KIND).map((option) => (
          <MenuItem key={option} value={option}>
            {KIND_LABEL[option]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Priority"
        size="small"
        className="min-w-[130px]"
        value={priority}
        onChange={(e) => setPriority(e.target.value as ResolutionPriority | '')}
      >
        <MenuItem value="">All</MenuItem>
        {Object.values(RESOLUTION_PRIORITY).map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Owner"
        size="small"
        className="min-w-[150px]"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
      />
      <GroupingFilterSelects
        module={module}
        domain={domain}
        onModuleChange={setModule}
        onDomainChange={setDomain}
      />
      <TextField
        label="Scenario key"
        size="small"
        className="min-w-[180px]"
        value={scenarioKey}
        onChange={(e) => setScenarioKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
      />
      <TextField
        select
        label="Observed as"
        size="small"
        className="min-w-[160px]"
        value={observedResult}
        onChange={(e) => setObservedResult(e.target.value as ResolutionObservedResult | '')}
      >
        <MenuItem value="">All</MenuItem>
        {Object.values(RESOLUTION_OBSERVED_RESULT).map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Last seen after"
        type="date"
        size="small"
        className="min-w-[170px]"
        InputLabelProps={{ shrink: true }}
        value={lastSeenFrom}
        onChange={(e) => setLastSeenFrom(e.target.value)}
      />
      <TextField
        select
        label="Defect"
        size="small"
        className="min-w-[130px]"
        value={hasDefect}
        onChange={(e) => setHasDefect(e.target.value)}
      >
        {LINK_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Redmine"
        size="small"
        className="min-w-[130px]"
        value={hasRedmine}
        onChange={(e) => setHasRedmine(e.target.value)}
      >
        {LINK_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      <Button variant="contained" size="medium" onClick={handleApply}>
        Apply
      </Button>
      <Button variant="text" size="medium" onClick={handleReset}>
        Reset
      </Button>
    </Box>
  );
}
