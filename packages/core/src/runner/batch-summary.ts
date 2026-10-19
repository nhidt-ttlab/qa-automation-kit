import type { TerminalVerdict } from './lifecycle.js';

export interface BatchSummaryRow {
  verdict: TerminalVerdict;
  testCaseId: string;
  scenario: string;
  domain: string;
  kind: string;
  durationMs: number;
  error?: string;
}

export function countVerdicts(rows: readonly Pick<BatchSummaryRow, 'verdict'>[]): Record<TerminalVerdict, number> {
  const counts: Record<TerminalVerdict, number> = { PASS: 0, BLOCKED: 0, FAIL: 0 };
  for (const row of rows) counts[row.verdict]++;
  return counts;
}

/** `2026-01-01T00-00-00-000Z-<label>.md` — sorts chronologically in a directory listing. */
export function batchSummaryFileName(startedAt: string, label: string): string {
  return `${startedAt.replace(/[:.]/g, '-')}-${label}.md`;
}

export interface BatchSummaryInput {
  label: string;
  environment: string;
  rows: readonly BatchSummaryRow[];
  startedAt: string;
  durationMs: number;
  /** Extra Markdown lines appended after the table (e.g. a session teardown section). */
  sections?: readonly string[];
}

/** The Markdown batch summary a human opens after a batch. */
export function renderBatchSummary(input: BatchSummaryInput): string {
  const counts = countVerdicts(input.rows);
  const lines = [
    `# Batch run — \`${input.label}\``,
    '',
    `- Environment: \`${input.environment}\``,
    `- Started: ${input.startedAt}`,
    `- Duration: ${(input.durationMs / 1000).toFixed(1)}s`,
    `- Scenarios: ${input.rows.length} — **${counts.PASS} PASS**, ${counts.BLOCKED} BLOCKED, **${counts.FAIL} FAIL**`,
    '',
    '| Verdict | Testcase | Scenario | Module | Kind | Duration | Note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...input.rows.map(
      (r) =>
        `| ${r.verdict} | ${r.testCaseId} | \`${r.scenario}\` | ${r.domain} | ${r.kind} | ${(r.durationMs / 1000).toFixed(1)}s | ${(r.error ?? '').replace(/\|/g, '\\|').slice(0, 200)} |`,
    ),
    '',
    ...(input.sections ?? []),
  ];
  return lines.join('\n');
}
