import { Card, CardContent, Chip, Grid, Typography } from '@mui/material';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';

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

export function RunOverviewCard({ run }: { run: TestRunDetailResponseDto }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Typography variant="h6" className="font-mono">
            {run.id}
          </Typography>
          <RunResultChip result={run.result} />
          {run.dry_run && <Chip label="Dry run" size="small" variant="outlined" />}
          {run.severity && <Chip label={run.severity} size="small" color="warning" variant="outlined" />}
        </div>

        <Grid container spacing={2}>
          <Field label="Test Case" value={run.test_case_id} />
          <Field label="Feature ID" value={run.feature_id} />
          <Field label="Scenario" value={run.scenario_key} />
          <Field label="Environment" value={run.environment} />
          <Field label="Started At" value={new Date(run.started_at).toLocaleString()} />
          <Field label="Finished At" value={run.finished_at ? new Date(run.finished_at).toLocaleString() : undefined} />
          <Field label="Duration" value={run.duration_ms != null ? `${run.duration_ms} ms` : undefined} />
          <Field label="Executed By" value={run.executed_by} />
          <Field label="Git Commit" value={run.git_commit} />
          <Field label="Git Branch" value={run.git_branch} />
          <Field label="Reproducibility" value={run.reproducibility} />
        </Grid>

        {run.business_scenario && (
          <div>
            <Typography variant="caption" className="text-gray-500 block">
              Business Scenario
            </Typography>
            <Typography variant="body2">{run.business_scenario}</Typography>
          </div>
        )}

        {run.conclusion && (
          <div>
            <Typography variant="caption" className="text-gray-500 block">
              Conclusion
            </Typography>
            <Typography variant="body2">{run.conclusion}</Typography>
          </div>
        )}

        {run.defect_statement && (
          <div>
            <Typography variant="caption" className="text-red-500 block">
              Defect Statement
            </Typography>
            <Typography variant="body2">{run.defect_statement}</Typography>
          </div>
        )}

        {run.blocked_reason && (
          <div>
            <Typography variant="caption" className="text-orange-500 block">
              Blocked Reason
            </Typography>
            <Typography variant="body2">{run.blocked_reason}</Typography>
          </div>
        )}

        {run.error_summary && (
          <div>
            <Typography variant="caption" className="text-red-500 block">
              Error Summary
            </Typography>
            <Typography variant="body2">{run.error_summary}</Typography>
          </div>
        )}

        {run.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {run.tags.map((tag) => (
              <Chip key={tag} label={tag} size="small" variant="outlined" />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
