import { useState } from 'react';
import { Card, CardHeader, CardContent, Chip, Typography, Box, Paper, Button } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';
import { StructuredReviewNote } from './StructuredReviewNote';

type Defects = NonNullable<TestRunDetailResponseDto['defects']>;

const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  Critical: 'error',
  High: 'warning',
  Medium: 'info',
  Low: 'default',
};

export function RunDefectsList({ defects }: { defects: Defects }) {
  if (!defects.length) return null;

  return (
    <Card>
      <CardHeader title={`Linked Defects (${defects.length})`} />
      <CardContent className="space-y-2">
        {defects.map((defect) => (
          <div key={defect.id} className="flex items-center gap-2">
            <Chip label={defect.severity} size="small" color={SEVERITY_COLOR[defect.severity] ?? 'default'} />
            <Typography variant="body2">{defect.title}</Typography>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReviewListSection({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5 }}>
        {label}
      </Typography>
      <ul style={{ paddingLeft: 20, margin: 0 }}>
        {items.map((item, index) => (
          <li key={`${item}-${index}`} style={{ marginBottom: 4 }}>
            <Typography variant="body2" color="text.secondary">
              {item}
            </Typography>
          </li>
        ))}
      </ul>
    </Box>
  );
}

export function getVerdictChipSx(verdict: string) {
  switch (verdict.toLowerCase()) {
    case 'approved':
      return { bgcolor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', fontWeight: 700 };
    case 'pending':
      return { bgcolor: '#fef9c3', color: '#854d0e', border: '1px solid #fef08a', fontWeight: 700 };
    case 'needs_clarification':
      return { bgcolor: '#fae8ff', color: '#86198f', border: '1px solid #f5d0fe', fontWeight: 700 };
    case 'rejected':
      return { bgcolor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', fontWeight: 700 };
    default:
      return { fontWeight: 700 };
  }
}

export function getQualityChipSx(quality?: string | null) {
  if (!quality) return { fontWeight: 700 };
  switch (quality.toLowerCase()) {
    case 'excellent':
      return { bgcolor: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4', fontWeight: 700 };
    case 'good':
      return { bgcolor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontWeight: 700 };
    case 'needs_improvement':
      return { bgcolor: '#ede9fe', color: '#5b21b6', border: '1px solid #ddd6fe', fontWeight: 700 };
    case 'poor':
      return { bgcolor: '#ffedd5', color: '#9a3412', border: '1px solid #fed7aa', fontWeight: 700 };
    default:
      return { fontWeight: 700 };
  }
}

export const QUALITY_CHIP_SX = getQualityChipSx('good');

export const NEEDS_IMPROVEMENT_CHIP_SX = {
  bgcolor: '#ede9fe',
  color: '#5b21b6',
  border: '1px solid #ddd6fe',
  fontWeight: 700,
};

export function RunReviewPanel({ review }: { review: TestRunDetailResponseDto['review'] }) {
  const [copiedAiPrompt, setCopiedAiPrompt] = useState(false);

  const handleCopyAiPrompt = () => {
    if (!review?.ai_generation_hint) return;
    navigator.clipboard.writeText(review.ai_generation_hint);
    setCopiedAiPrompt(true);
    setTimeout(() => setCopiedAiPrompt(false), 2000);
  };

  return (
    <Card>
      <CardHeader title="Current Review" />
      <CardContent>
        {review ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                label={review.verdict.toUpperCase()}
                size="small"
                sx={getVerdictChipSx(review.verdict)}
              />
              {review.testcase_quality && (
                <Chip
                  label={review.testcase_quality.toUpperCase()}
                  size="small"
                  sx={getQualityChipSx(review.testcase_quality)}
                />
              )}
              {review.should_improve_testcase && (
                <Chip
                  label="NEEDS IMPROVEMENT"
                  size="small"
                  sx={NEEDS_IMPROVEMENT_CHIP_SX}
                />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">
              Reviewed by <strong>{review.reviewer}</strong> on {new Date(review.reviewed_at).toLocaleString()}
            </Typography>
            {review.note && <StructuredReviewNote note={review.note} />}

            {review.improvement_summary && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Improvement Summary
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {review.improvement_summary}
                </Typography>
              </Box>
            )}

            <ReviewListSection label="Missing Coverage" items={review.missing_coverage ?? []} />
            <ReviewListSection label="Suggested Steps" items={review.suggested_steps ?? []} />
            <ReviewListSection label="Suggested Assertions" items={review.suggested_assertions ?? []} />
            <ReviewListSection label="Suggested Test Data" items={review.suggested_test_data ?? []} />

            {review.ai_generation_hint && (
              <Box sx={{ mt: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                    AI Generation Guidance
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={copiedAiPrompt ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                    onClick={handleCopyAiPrompt}
                    sx={{ textTransform: 'none', py: 0.2, px: 1, fontSize: '0.75rem', fontWeight: 600 }}
                  >
                    {copiedAiPrompt ? 'Copied Prompt!' : 'Copy AI Prompt'}
                  </Button>
                </Box>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    bgcolor: 'grey.50',
                    borderColor: 'grey.300',
                    borderRadius: 1.5,
                    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                    fontSize: '0.825rem',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'text.primary',
                    maxHeight: 500,
                    overflowY: 'auto',
                  }}
                >
                  {review.ai_generation_hint}
                </Paper>
              </Box>
            )}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            This run has not been reviewed yet.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
