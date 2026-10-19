import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { MenuItem, TextField } from '@mui/material';
import { FEATURE_DOMAIN_LABEL, SUITE_MODULE } from '@qakit/reporting-shared';
import type { FeatureDomain, RunType } from '@qakit/reporting-shared';

import { useFeatureDomainOptionsStore } from '@/app/store/provider';

/**
 * The two grouping vocabularies every list filters by, kept in one place because three separate
 * filter bars offer the same pair.
 *
 * `module` is the suite folder the runner's own `--module` flag takes; `domain` is the finer
 * documentation module ("feature") a QA lead thinks in. They are offered as independent selects
 * rather than a dependent pair: `warehouse` maps to two domains, and pre-filtering the second
 * select would hide the very split that makes it useful.
 *
 * Domain options come from the database (the domains test cases actually carry), not from the
 * shared constants, which drift from what the runner stamps.
 */
export const MODULE_OPTIONS: string[] = Object.values(SUITE_MODULE);

/**
 * Vietnamese screen name for a domain, falling back to the raw value. The fallback is load-bearing:
 * the API returns whatever the runner stamped, and a documentation module added there is valid
 * before this package knows its label.
 */
export function featureLabel(domain: string | undefined): string {
  if (!domain) return '—';
  return FEATURE_DOMAIN_LABEL[domain as FeatureDomain] ?? domain;
}

interface DomainSelectProps {
  value: string;
  onChange: (value: string) => void;
  /** Limit options to domains with cases of this layer. Omit for every domain. */
  runType?: RunType;
}

/**
 * The feature (documentation module) select on its own, for a bar that offers it without the
 * module select — the test case list dropped module once checklist filters replaced it.
 */
export const DomainSelect = observer(function DomainSelect({ value, onChange, runType }: DomainSelectProps) {
  const optionsStore = useFeatureDomainOptionsStore();

  useEffect(() => {
    void optionsStore.ensureLoaded(runType);
  }, [optionsStore, runType]);

  const { domains, isLoading, error } = optionsStore.optionsFor(runType);
  // A selection the list does not contain (picked on the other tab, or still loading) stays
  // offered, so it remains visible and MUI does not warn about an out-of-range value.
  const options = value && !domains.includes(value) ? [...domains, value] : domains;

  return (
    <TextField
      select
      label="Feature"
      size="small"
      className="min-w-[220px]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <MenuItem value="">All</MenuItem>
      {isLoading && <MenuItem disabled>Loading…</MenuItem>}
      {error && <MenuItem disabled>Failed to load features</MenuItem>}
      {options.map((option) => (
        <MenuItem key={option} value={option}>
          {featureLabel(option)}
        </MenuItem>
      ))}
    </TextField>
  );
});

interface GroupingFilterSelectsProps {
  module: string;
  domain: string;
  onModuleChange: (value: string) => void;
  onDomainChange: (value: string) => void;
}

export function GroupingFilterSelects({
  module,
  domain,
  onModuleChange,
  onDomainChange,
}: GroupingFilterSelectsProps) {
  return (
    <>
      <TextField
        select
        label="Module"
        size="small"
        className="min-w-[180px]"
        value={module}
        onChange={(e) => onModuleChange(e.target.value)}
      >
        <MenuItem value="">All</MenuItem>
        {MODULE_OPTIONS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <DomainSelect value={domain} onChange={onDomainChange} />
    </>
  );
}
