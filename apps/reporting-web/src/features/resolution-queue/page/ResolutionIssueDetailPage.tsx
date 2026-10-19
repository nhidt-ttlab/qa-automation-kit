import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Snackbar,
  Typography,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import { AsyncSection } from '@/shared/components/AsyncState';
import { PageHeader } from '@/shared/components/PageHeader';
import { featureLabel } from '@/shared/components/GroupingFilters';
import { useResolutionQueueStore } from '../../../app/store/provider';
import { ActorField } from '../components/ActorField';
import { ResolutionKindChip, ResolutionStatusChip } from '../components/ResolutionStatusChip';
import { ResolutionObservations } from '../components/ResolutionObservations';
import { CommentTimeline, EventTimeline } from '../components/ResolutionTimeline';
import {
  ClassificationPanel,
  DecisionPanel,
  LifecyclePanel,
  LinksPanel,
  ResolutionPanel,
  VerificationPanel,
} from '../components/ResolutionWorkflowPanels';

export const ResolutionIssueDetailPage = observer(() => {
  const { id } = useParams<{ id: string }>();
  const store = useResolutionQueueStore();

  useEffect(() => {
    if (id) void store.loadIssue(id);
    return () => {
      store.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, id]);

  const issue = store.issue;
  const disabled = store.isSubmitting || !store.actor.trim();

  return (
    <Box className="space-y-4">
      <PageHeader title="Resolution issue" backFallback="/resolution-queue" />

      <AsyncSection
        isLoading={store.isLoadingIssue && !issue}
        error={store.issueError}
        isEmpty={!store.isLoadingIssue && !store.issueError && !issue}
        emptyTitle="Issue not found"
        emptyDescription="It may have been re-keyed by a later import."
        onRetry={() => id && void store.loadIssue(id)}
      >
        {issue && (
          <Box className="space-y-4">
            <Card>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Typography variant="h6" className="font-mono">
                    {issue.display_key}
                  </Typography>
                  <ResolutionStatusChip status={issue.workflow_status} />
                  <ResolutionKindChip kind={issue.kind} />
                  {issue.priority && <Chip size="small" variant="outlined" label={issue.priority} />}
                  {issue.recurrence_count > 0 && (
                    <Chip
                      size="small"
                      color="error"
                      icon={<ReplayIcon />}
                      label={`Recurred ${issue.recurrence_count}×`}
                    />
                  )}
                </div>
                <Typography variant="body1" className="text-dark-900">
                  {issue.title}
                </Typography>
                <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                  <span>Feature: {featureLabel(issue.domain ?? undefined)}</span>
                  <span>Module: {issue.module ?? '—'}</span>
                  <span>Owner: {issue.owner ?? 'unassigned'}</span>
                  <span>First seen: {new Date(issue.first_seen_at).toLocaleString()}</span>
                  <span>Last seen: {new Date(issue.last_seen_at).toLocaleString()}</span>
                  <span className="font-mono">{issue.import_key}</span>
                </div>
                {issue.workflow_status === 'RECURRED' && (
                  <Alert severity="error">
                    New unresolved evidence arrived after this was verified. The previous decision,
                    resolution and verification are all still on the record below.
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Grid container spacing={2}>
              <Grid item xs={12} md={7}>
                <Box className="space-y-4">
                  <Card>
                    <CardContent className="space-y-2">
                      <Typography variant="caption" className="text-gray-500">
                        Summary from the evidence (written by the import, refreshed as new
                        occurrences arrive)
                      </Typography>
                      <Typography variant="body2" className="whitespace-pre-wrap break-words">
                        {issue.source_summary ?? '—'}
                      </Typography>
                      {issue.user_summary && (
                        <>
                          <Typography variant="caption" className="mt-2 block text-gray-500">
                            Your summary
                          </Typography>
                          <Typography variant="body2" className="whitespace-pre-wrap break-words">
                            {issue.user_summary}
                          </Typography>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <ResolutionObservations issue={issue} />

                  <CommentTimeline
                    comments={store.comments}
                    disabled={disabled}
                    onAdd={(body) => void store.addComment(issue.id, body)}
                  />

                  <EventTimeline events={store.events} />
                </Box>
              </Grid>

              <Grid item xs={12} md={5}>
                <Box className="space-y-4">
                  <Card>
                    <CardContent>
                      <ActorField actor={store.actor} onChange={(v) => store.setActor(v)} />
                    </CardContent>
                  </Card>
                  <ClassificationPanel issue={issue} disabled={disabled} store={store} />
                  <DecisionPanel issue={issue} disabled={disabled} store={store} />
                  <ResolutionPanel issue={issue} disabled={disabled} store={store} />
                  <VerificationPanel issue={issue} disabled={disabled} store={store} />
                  <LinksPanel issue={issue} disabled={disabled} store={store} />
                  <LifecyclePanel issue={issue} disabled={disabled} store={store} />
                </Box>
              </Grid>
            </Grid>
          </Box>
        )}
      </AsyncSection>

      <Snackbar
        open={Boolean(store.actionError)}
        autoHideDuration={8000}
        onClose={() => store.clearActionError()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => store.clearActionError()}>
          {store.actionError}
        </Alert>
      </Snackbar>
    </Box>
  );
});
