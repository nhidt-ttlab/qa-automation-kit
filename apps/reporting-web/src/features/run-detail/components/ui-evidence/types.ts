import type { TestRunDetailResponseDto, UiEvidenceDto, UiEvidenceItemDto } from '@qakit/reporting-shared';

export type UiEvidence = UiEvidenceDto;
export type UiEvidenceItem = UiEvidenceItemDto;
export type RunSteps = NonNullable<TestRunDetailResponseDto['steps']>;
export type RunChecks = NonNullable<TestRunDetailResponseDto['checks']>;

/** Human-readable byte size for download links, where the cost of a click matters. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
