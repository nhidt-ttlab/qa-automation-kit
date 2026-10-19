import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Alert, Box, Tabs, Tab, Chip, Paper, Typography, Button } from '@mui/material';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined';
import BugReportIcon from '@mui/icons-material/BugReport';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { RUN_TYPE, UI_EVIDENCE_KIND } from '@qakit/reporting-shared';

const DOWNLOAD_KINDS: readonly string[] = [
  UI_EVIDENCE_KIND.TRACE_ZIP,
  UI_EVIDENCE_KIND.NETWORK_HAR,
  UI_EVIDENCE_KIND.CONSOLE_LOG,
  UI_EVIDENCE_KIND.DOM_SNAPSHOT,
  UI_EVIDENCE_KIND.GRID_SNAPSHOT,
];

import { useRunDetailStore } from '@/app/store/provider';
import { AsyncSection } from '@/shared/components/AsyncState';
import { PageHeader } from '@/shared/components/PageHeader';
import { LogBugToRedmineButton } from '@/features/create-redmine-issue';
import { RerunButton } from '@/features/regression-run';
import { ExportReviewsButton, SubmitReviewForm } from '@/features/review-run';

import { RunOverviewCard } from '../components/RunOverviewCard';
import { RunChecksTable, RunStepsList } from '../components/RunChecksSteps';
import { RunRelatedEntities, RunArtifactLinks } from '../components/RunEvidenceRelated';
import { RunTechnicalAppendixCard } from '../components/RunTechnicalAppendix';
import {
  RunDefectsList,
  RunReviewPanel,
  getVerdictChipSx,
  getQualityChipSx,
  NEEDS_IMPROVEMENT_CHIP_SX,
} from '../components/RunDefectsAndReview';
import { RunRedmineLinks } from '../components/RunRedmineLinks';
import {
  UiCheckpointsTable,
  UiDiagnosticsCard,
  UiRecordingsCard,
  UiStepGallery,
} from '../components/ui-evidence';

export const RunDetailPage = observer(() => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const runDetailStore = useRunDetailStore();

  const [isEditingReview, setIsEditingReview] = useState(false);

  const tabParam = searchParams.get('tab');
  const validTabs = ['execution', 'defects', 'artifacts', 'review'];
  const currentTab = validTabs.includes(tabParam ?? '') ? tabParam! : 'execution';

  const handleTabChange = (_: React.SyntheticEvent, newTab: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === 'execution') {
        next.delete('tab');
      } else {
        next.set('tab', newTab);
      }
      return next;
    });
  };

  useEffect(() => {
    if (id) {
      void runDetailStore.loadRun(id);
    }
    return () => runDetailStore.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, runDetailStore]);

  const run = runDetailStore.selectedRun;
  const isUiRun = run?.run_type === RUN_TYPE.UI;
  const defectCount = run?.defects?.length ?? 0;
  const redmineCount = run?.redmine_links?.length ?? 0;
  const totalIssueCount = defectCount + redmineCount;
  const uiRecordingsCount =
    isUiRun && run?.ui_evidence?.items
      ? run.ui_evidence.items.filter(
          (item) =>
            item.kind === UI_EVIDENCE_KIND.VIDEO ||
            DOWNLOAD_KINDS.includes(item.kind),
        ).length
      : 0;
  const artifactCount = (run?.artifact_links?.length ?? 0) + uiRecordingsCount;

  return (
    <Box className="space-y-4">
      <PageHeader
        title="Run Details"
        backFallback={run?.test_case_id ? `/test-cases/${run.test_case_id}` : '/'}
        actions={
          run && (
            <Box className="flex gap-2">
              <RerunButton testCaseIds={[run.test_case_id]} kind={run.run_type} />
              <LogBugToRedmineButton
                run={run}
                onCreated={() => void runDetailStore.loadRun(run.id)}
              />
            </Box>
          )
        }
      />

      <AsyncSection
        isLoading={runDetailStore.isLoading}
        error={runDetailStore.error}
        isEmpty={!runDetailStore.isLoading && !runDetailStore.error && !run}
        emptyTitle="Run not found"
        onRetry={() => id && void runDetailStore.loadRun(id)}
      >
        {run && (
          <Box className="space-y-3">
            {/* 4-Tab Navigation Bar */}
            <Paper
              variant="outlined"
              sx={{
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                borderRadius: 1.5,
              }}
            >
              <Tabs
                value={currentTab}
                onChange={handleTabChange}
                aria-label="Run Detail Tabs"
                indicatorColor="primary"
                textColor="primary"
                sx={{ px: 2 }}
              >
                <Tab
                  value="execution"
                  icon={<PlayCircleOutlineIcon fontSize="small" />}
                  iconPosition="start"
                  label="Execution & Evidence"
                  sx={{ fontWeight: 600, textTransform: 'none', minHeight: 48 }}
                />
                <Tab
                  value="defects"
                  icon={<BugReportIcon fontSize="small" />}
                  iconPosition="start"
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>Linked Defects</span>
                      {totalIssueCount > 0 ? (
                        <Chip
                          label={totalIssueCount}
                          size="small"
                          color="error"
                          sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700 }}
                        />
                      ) : (
                        <Chip
                          label="0"
                          size="small"
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                  }
                  sx={{ fontWeight: 600, textTransform: 'none', minHeight: 48 }}
                />
                <Tab
                  value="artifacts"
                  icon={<AttachFileIcon fontSize="small" />}
                  iconPosition="start"
                  label="Artifacts"
                  sx={{ fontWeight: 600, textTransform: 'none', minHeight: 48 }}
                />
                <Tab
                  value="review"
                  icon={<RateReviewOutlinedIcon fontSize="small" />}
                  iconPosition="start"
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>Review & Evaluation</span>
                      {run.review ? (
                        <Chip
                          label={run.review.verdict.toUpperCase()}
                          size="small"
                          sx={{
                            ...getVerdictChipSx(run.review.verdict),
                            height: 20,
                            fontSize: '0.7rem',
                          }}
                        />
                      ) : (
                        <Chip
                          label="NO REVIEW"
                          size="small"
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                  }
                  sx={{ fontWeight: 600, textTransform: 'none', minHeight: 48 }}
                />
              </Tabs>
            </Paper>

            {/* TAB 1: Execution & Evidence (100% Full-Width) */}
            {currentTab === 'execution' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <RunOverviewCard run={run} />
                {isUiRun ? (
                  <>
                    {run.ui_evidence ? (
                      <>
                        <UiCheckpointsTable
                          checks={run.checks ?? []}
                          evidence={run.ui_evidence}
                        />
                        <UiStepGallery
                          steps={run.steps ?? []}
                          evidence={run.ui_evidence}
                        />
                        <UiDiagnosticsCard evidence={run.ui_evidence} />
                      </>
                    ) : (
                      <>
                        <Alert severity="info">
                          No browser evidence stored for this run. Run{' '}
                          <code>pnpm db:sync</code> to import it from the regression runner.
                        </Alert>
                        <RunChecksTable checks={run.checks ?? []} />
                        <RunStepsList steps={run.steps ?? []} />
                      </>
                    )}
                    <RunTechnicalAppendixCard run={run} />
                  </>
                ) : (
                  <>
                    <RunChecksTable checks={run.checks ?? []} />
                    <RunStepsList steps={run.steps ?? []} />
                    <RunTechnicalAppendixCard run={run} />
                  </>
                )}
              </Box>
            )}

            {/* TAB 2: Linked Defects & Redmine Tickets */}
            {currentTab === 'defects' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {defectCount === 0 && redmineCount === 0 ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 6,
                      textAlign: 'center',
                      bgcolor: 'background.paper',
                      borderRadius: 2,
                    }}
                  >
                    <CheckCircleOutlineIcon color="success" sx={{ fontSize: 56, mb: 1.5 }} />
                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
                      No Linked Defects
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      This test run currently has no linked defects or reported Redmine issues.
                    </Typography>
                  </Paper>
                ) : (
                  <>
                    <RunDefectsList defects={run.defects ?? []} />
                    <RunRedmineLinks links={run.redmine_links ?? []} />
                    <RunRelatedEntities entities={run.related_entities ?? []} />
                  </>
                )}
              </Box>
            )}

            {/* TAB 3: Artifacts & Attachments */}
            {currentTab === 'artifacts' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {isUiRun && run.ui_evidence && uiRecordingsCount > 0 && (
                  <UiRecordingsCard evidence={run.ui_evidence} />
                )}
                {run.artifact_links && run.artifact_links.length > 0 && (
                  <RunArtifactLinks artifacts={run.artifact_links} />
                )}
                {artifactCount === 0 && (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 6,
                      textAlign: 'center',
                      bgcolor: 'background.paper',
                      borderRadius: 2,
                    }}
                  >
                    <AttachFileIcon sx={{ fontSize: 56, mb: 1.5, color: 'text.secondary' }} />
                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
                      No Artifacts Attached
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      No external artifact files or download links are associated with this run.
                    </Typography>
                  </Paper>
                )}
              </Box>
            )}

            {/* TAB 2: Review & QA Evaluation */}
            {currentTab === 'review' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {/* Review Toolbar with Actions */}
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.5,
                    bgcolor: 'background.paper',
                    borderRadius: 1.5,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {isEditingReview ? (run.review ? 'Edit Review' : 'Write Review') : 'Review & Evaluation'}
                    </Typography>
                    {!isEditingReview && run.review && (
                      <>
                        <Chip
                          label={run.review.verdict.toUpperCase()}
                          size="small"
                          sx={getVerdictChipSx(run.review.verdict)}
                        />
                        {run.review.testcase_quality && (
                          <Chip
                            label={run.review.testcase_quality.toUpperCase()}
                            size="small"
                            sx={getQualityChipSx(run.review.testcase_quality)}
                          />
                        )}
                        {run.review.should_improve_testcase && (
                          <Chip
                            label="NEEDS IMPROVEMENT"
                            size="small"
                            sx={NEEDS_IMPROVEMENT_CHIP_SX}
                          />
                        )}
                      </>
                    )}
                    {!isEditingReview && !run.review && (
                      <Chip label="NO REVIEW" size="small" variant="outlined" />
                    )}
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    {!isEditingReview ? (
                      <Button
                        variant="contained"
                        startIcon={<EditIcon />}
                        onClick={() => setIsEditingReview(true)}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                      >
                        {run.review ? 'Edit Review' : 'Write Review'}
                      </Button>
                    ) : (
                      <Button
                        variant="outlined"
                        color="inherit"
                        startIcon={<VisibilityIcon />}
                        onClick={() => setIsEditingReview(false)}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                      >
                        Back to View
                      </Button>
                    )}
                    <ExportReviewsButton />
                  </Box>
                </Paper>

                {/* Full-Width Workspace (View Mode vs Edit Mode) */}
                {!isEditingReview ? (
                  <RunReviewPanel review={run.review} />
                ) : (
                  <Box sx={{ width: '100%' }}>
                    <SubmitReviewForm
                      run={run}
                      onSuccess={() => setIsEditingReview(false)}
                      onCancel={() => setIsEditingReview(false)}
                    />
                  </Box>
                )}
              </Box>
            )}
          </Box>
        )}
      </AsyncSection>
    </Box>
  );
});
