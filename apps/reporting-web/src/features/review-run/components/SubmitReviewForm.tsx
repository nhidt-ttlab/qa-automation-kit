import { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  CardContent,
  CardHeader,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Box,
} from '@mui/material';
import type { CreateReviewRequestDto, ReviewVerdict, ReviewTestcaseQuality, TestRunDetailResponseDto } from '@qakit/reporting-shared';
import { REVIEW_VERDICT, REVIEW_TESTCASE_QUALITY } from '@qakit/reporting-shared';

import { useReviewStore, useRunDetailStore } from '@/app/store/provider';

const VERDICT_OPTIONS = Object.values(REVIEW_VERDICT);
const QUALITY_OPTIONS = Object.values(REVIEW_TESTCASE_QUALITY);

function TagsField({
  label,
  helperText,
  value,
  onChange,
  disabled,
}: {
  label: string;
  helperText: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={[]}
      value={value}
      onChange={(_e, next) => onChange(next as string[])}
      disabled={disabled}
      renderInput={(params) => <TextField {...params} label={label} helperText={helperText} />}
    />
  );
}

export interface SubmitReviewFormProps {
  run: TestRunDetailResponseDto;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const SubmitReviewForm = observer(({ run, onSuccess, onCancel }: SubmitReviewFormProps) => {
  const reviewStore = useReviewStore();
  const runDetailStore = useRunDetailStore();

  const isEditing = Boolean(run.review);

  const [verdict, setVerdict] = useState<ReviewVerdict | ''>('');
  const [note, setNote] = useState('');
  const [testcaseQuality, setTestcaseQuality] = useState<ReviewTestcaseQuality | ''>('');
  const [shouldImprove, setShouldImprove] = useState(false);
  const [improvementSummary, setImprovementSummary] = useState('');
  const [missingCoverage, setMissingCoverage] = useState<string[]>([]);
  const [suggestedSteps, setSuggestedSteps] = useState<string[]>([]);
  const [suggestedAssertions, setSuggestedAssertions] = useState<string[]>([]);
  const [suggestedTestData, setSuggestedTestData] = useState<string[]>([]);
  const [aiGenerationHint, setAiGenerationHint] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (run.review) {
      setVerdict(run.review.verdict ?? '');
      setNote(run.review.note ?? '');
      setTestcaseQuality(run.review.testcase_quality ?? '');
      setShouldImprove(run.review.should_improve_testcase ?? false);
      setImprovementSummary(run.review.improvement_summary ?? '');
      setMissingCoverage(run.review.missing_coverage ?? []);
      setSuggestedSteps(run.review.suggested_steps ?? []);
      setSuggestedAssertions(run.review.suggested_assertions ?? []);
      setSuggestedTestData(run.review.suggested_test_data ?? []);
      setAiGenerationHint(run.review.ai_generation_hint ?? '');
    } else {
      setVerdict('');
      setNote('');
      setTestcaseQuality('');
      setShouldImprove(false);
      setImprovementSummary('');
      setMissingCoverage([]);
      setSuggestedSteps([]);
      setSuggestedAssertions([]);
      setSuggestedTestData([]);
      setAiGenerationHint('');
    }
    setSubmitted(false);
  }, [run.id, run.review]);

  const isSubmitting = reviewStore.isSubmittingReview;

  const handleSubmit = async () => {
    if (!verdict) return;

    const dto: CreateReviewRequestDto = {
      test_run_id: run.id,
      verdict,
      note: note.trim() || undefined,
      testcase_quality: testcaseQuality || undefined,
      should_improve_testcase: shouldImprove,
      improvement_summary: improvementSummary.trim() || undefined,
      missing_coverage: missingCoverage.length ? missingCoverage : undefined,
      suggested_steps: suggestedSteps.length ? suggestedSteps : undefined,
      suggested_assertions: suggestedAssertions.length ? suggestedAssertions : undefined,
      suggested_test_data: suggestedTestData.length ? suggestedTestData : undefined,
      ai_generation_hint: aiGenerationHint.trim() || undefined,
    };

    try {
      const review = await reviewStore.submitReview(dto);
      runDetailStore.setReview(review);
      setSubmitted(true);
      onSuccess?.();
    } catch {
      // Error is surfaced via reviewStore.reviewError below.
    }
  };

  return (
    <Card>
      <CardHeader
        title={isEditing ? 'Edit Review' : 'Submit Review'}
        subheader={isEditing ? 'Pre-filled with existing review data' : undefined}
      />
      <CardContent className="space-y-4">
        {submitted && <Alert severity="success">Review submitted successfully.</Alert>}
        {reviewStore.reviewError && <Alert severity="error">{reviewStore.reviewError}</Alert>}

        <TextField
          select
          required
          fullWidth
          label="Verdict"
          value={verdict}
          onChange={(e) => setVerdict(e.target.value as ReviewVerdict)}
          disabled={isSubmitting}
        >
          {VERDICT_OPTIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          fullWidth
          multiline
          minRows={8}
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isSubmitting}
        />

        <TextField
          select
          fullWidth
          label="Testcase quality"
          value={testcaseQuality}
          onChange={(e) => setTestcaseQuality(e.target.value as ReviewTestcaseQuality)}
          disabled={isSubmitting}
        >
          <MenuItem value="">Not rated</MenuItem>
          {QUALITY_OPTIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>

        <FormControlLabel
          control={
            <Switch
              checked={shouldImprove}
              onChange={(e) => setShouldImprove(e.target.checked)}
              disabled={isSubmitting}
            />
          }
          label="Needs testcase improvement"
        />

        <TextField
          fullWidth
          multiline
          minRows={2}
          label="Improvement summary"
          value={improvementSummary}
          onChange={(e) => setImprovementSummary(e.target.value)}
          disabled={isSubmitting}
        />

        <TagsField
          label="Missing coverage"
          helperText="Type and press Enter to add a gap in coverage"
          value={missingCoverage}
          onChange={setMissingCoverage}
          disabled={isSubmitting}
        />

        <TagsField
          label="Suggested steps"
          helperText="Type and press Enter to add a step the script should perform"
          value={suggestedSteps}
          onChange={setSuggestedSteps}
          disabled={isSubmitting}
        />

        <TagsField
          label="Suggested assertions"
          helperText="Type and press Enter to add an assertion the script should check"
          value={suggestedAssertions}
          onChange={setSuggestedAssertions}
          disabled={isSubmitting}
        />

        <TagsField
          label="Suggested test data"
          helperText="Type and press Enter to add test data the script should use"
          value={suggestedTestData}
          onChange={setSuggestedTestData}
          disabled={isSubmitting}
        />

        <TextField
          fullWidth
          multiline
          minRows={6}
          label="AI generation guidance"
          helperText="Guides how a future AI-assisted regeneration of this script should behave"
          value={aiGenerationHint}
          onChange={(e) => setAiGenerationHint(e.target.value)}
          disabled={isSubmitting}
        />

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, pt: 1 }}>
          {onCancel && (
            <Button variant="outlined" color="inherit" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
          <Button variant="contained" onClick={handleSubmit} disabled={!verdict || isSubmitting}>
            {isSubmitting ? 'Saving…' : isEditing ? 'Save Changes' : 'Submit Review'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
});
