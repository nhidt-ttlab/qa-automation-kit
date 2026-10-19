import { Card, CardContent, Chip, Grid, Typography } from '@mui/material';
import type { TestCaseDetailResponseDto } from '@qakit/reporting-shared';

import { RunResultChip } from '@/features/run-list/components/RunResultChip';

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <Grid item xs={12} sm={6} md={4}>
      <Typography variant="caption" className="text-gray-500 block">
        {label}
      </Typography>
      <Typography variant="body2" className="font-medium break-words">
        {value}
      </Typography>
    </Grid>
  );
}

export function TestCaseOverviewCard({ testCase }: { testCase: TestCaseDetailResponseDto }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Typography variant="h6" className="font-mono">
            {testCase.id}
          </Typography>
          <Chip label={testCase.status} size="small" variant="outlined" />
          {testCase.latest_run_result && <RunResultChip result={testCase.latest_run_result} />}
        </div>

        <Typography variant="subtitle1" className="font-semibold">
          {testCase.title}
        </Typography>

        <Grid container spacing={2}>
          <Field label="Scenario" value={testCase.scenario_key} />
          <Field label="Impacted Area" value={testCase.impacted_area} />
          <Field label="Owner" value={testCase.owner} />
          <Field label="Latest Environment" value={testCase.latest_run_environment} />
          <Field
            label="Latest Run"
            value={testCase.latest_run_started_at ? new Date(testCase.latest_run_started_at).toLocaleString() : undefined}
          />
          <Field label="Total Runs" value={testCase.total_run_count} />
        </Grid>

        {testCase.objective && (
          <div>
            <Typography variant="caption" className="text-gray-500 block">
              Objective
            </Typography>
            <Typography variant="body2">{testCase.objective}</Typography>
          </div>
        )}

        {testCase.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {testCase.tags.map((tag) => (
              <Chip key={tag} label={tag} size="small" variant="outlined" />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
