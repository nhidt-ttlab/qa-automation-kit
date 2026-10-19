import type { ComponentType } from 'react';
import { Card, CardContent, Grid, Box, Typography } from '@mui/material';
import type { SvgIconProps } from '@mui/material';
import {
  BarChartRounded as BarChartIcon,
  CheckCircleRounded as CheckCircleIcon,
  ErrorRounded as ErrorIcon,
  BugReportRounded as BugReportIcon,
} from '@mui/icons-material';
import type { DashboardSummaryResponseDto } from '@qakit/reporting-shared';

import { tokens } from '@/app/theme';

interface DashboardCardsProps {
  data: DashboardSummaryResponseDto | null;
}

/** Tint pairs for the metric icon tiles — soft ground, saturated glyph. */
const TONE = {
  brand: { bg: '#e0edff', fg: tokens.brand[600] },
  success: { bg: '#dcfce7', fg: '#15803d' },
  error: { bg: '#fee2e2', fg: '#b91c1c' },
  warning: { bg: '#fef3c7', fg: '#b45309' },
} as const;

type Tone = keyof typeof TONE;

function StatCard({
  label,
  value,
  caption,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  /** Spells out a denominator the headline number would otherwise leave ambiguous. */
  caption?: string;
  icon: ComponentType<SvgIconProps>;
  tone: Tone;
}) {
  const { bg, fg } = TONE[tone];

  return (
    <Card
      sx={{
        height: '100%',
        transition: 'box-shadow 150ms ease, transform 150ms ease',
        '&:hover': { boxShadow: tokens.shadow.raised },
      }}
    >
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: `${tokens.radius.md}px`,
            bgcolor: bg,
            color: fg,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon sx={{ fontSize: 22 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: tokens.neutral[500],
            }}
          >
            {label}
          </Typography>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.25 }}>
            {value}
          </Typography>
          {caption && (
            <Typography sx={{ fontSize: '0.75rem', color: tokens.neutral[500], lineHeight: 1.4 }}>
              {caption}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export function DashboardCards({ data }: DashboardCardsProps) {
  const latest = data?.latest;

  const cards = [
    { label: 'Total Runs', value: data?.total_runs || 0, icon: BarChartIcon, tone: 'brand' as Tone },
    {
      label: 'Pass Rate',
      value: `${data?.pass_rate || 0}%`,
      // The denominator is the latest run of each test case, not every execution ever recorded,
      // so it is stated outright — otherwise the number reads as a share of "Total Runs".
      caption: latest ? `${latest.passed} / ${latest.total} latest runs` : undefined,
      icon: CheckCircleIcon,
      tone: 'success' as Tone,
    },
    { label: 'Failed Runs', value: data?.failed_runs || 0, icon: ErrorIcon, tone: 'error' as Tone },
    { label: 'Open Bugs', value: data?.open_bugs || 0, icon: BugReportIcon, tone: 'warning' as Tone },
  ];

  return (
    <Grid container spacing={2.5}>
      {cards.map((card) => (
        <Grid item xs={12} sm={6} md={3} key={card.label}>
          <StatCard {...card} />
        </Grid>
      ))}
    </Grid>
  );
}
