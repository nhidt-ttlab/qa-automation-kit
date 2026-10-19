import { Chip } from '@mui/material';

/**
 * Status pill used for run results and defect severities.
 *
 * MUI's filled `color` chips are fully saturated, which makes a column of them fight the row
 * text for attention and flattens the difference between a failure and a partial. Soft tints
 * keep the hue as the signal while leaving the table readable, and each tone still clears
 * 4.5:1 contrast for its text.
 */
export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const TONE: Record<StatusTone, { bg: string; fg: string; border: string }> = {
  success: { bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
  warning: { bg: '#fef3c7', fg: '#b45309', border: '#fde68a' },
  error: { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca' },
  info: { bg: '#e0f2fe', fg: '#0369a1', border: '#bae6fd' },
  neutral: { bg: '#eef2f6', fg: '#475569', border: '#e2e8f0' },
};

export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  const { bg, fg, border } = TONE[tone] ?? TONE.neutral;

  return (
    <Chip
      label={label}
      size="small"
      sx={{
        bgcolor: bg,
        color: fg,
        border: `1px solid ${border}`,
        fontWeight: 700,
        letterSpacing: '0.02em',
      }}
    />
  );
}
