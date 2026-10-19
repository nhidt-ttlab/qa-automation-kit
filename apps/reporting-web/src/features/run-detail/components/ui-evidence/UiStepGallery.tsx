import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import { UI_EVIDENCE_KIND } from '@qakit/reporting-shared';

import { apiUrl } from '@/shared/api/apiUrl';

import type { RunSteps, UiEvidence, UiEvidenceItem } from './types';

/**
 * The run's steps, each showing the screenshots captured during it.
 *
 * The pairing is `item.step_sequence === step.sequence`. The API normalizes the manifest's
 * 0-based `stepIndex` into a 1-based `step_sequence` during sync precisely so this comparison
 * is a plain equality and the off-by-one cannot be reintroduced here.
 */
export function UiStepGallery({
  steps,
  evidence,
}: {
  steps: RunSteps;
  evidence: UiEvidence;
}) {
  const [zoomed, setZoomed] = useState<UiEvidenceItem | null>(null);

  const screenshots = evidence.items.filter(
    (item) => item.kind === UI_EVIDENCE_KIND.SCREENSHOT,
  );
  if (!steps.length) return null;

  const screenshotsForStep = (sequence: number) =>
    screenshots.filter((item) => item.step_sequence === sequence);

  // Screenshots the runner captured without a step association still need somewhere to go,
  // or they would silently vanish from the report.
  const unanchored = screenshots.filter((item) => item.step_sequence === undefined);

  return (
    <>
      <Card>
        <CardHeader
          title={`Steps (${steps.length})`}
          subheader={`${screenshots.length} screenshot${screenshots.length === 1 ? '' : 's'}`}
        />
        <CardContent className="space-y-3">
          {steps.map((step) => {
            const shots = screenshotsForStep(step.sequence);
            return (
              <div
                key={step.id}
                className="border-b border-gray-100 py-2 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <Chip
                    label={step.status}
                    size="small"
                    color={
                      step.status === 'passed'
                        ? 'success'
                        : step.status === 'failed'
                          ? 'error'
                          : 'default'
                    }
                  />
                  <span className="font-mono text-xs text-gray-500">
                    {step.sequence}
                  </span>
                  <span className="text-sm">{step.name}</span>
                </div>

                {shots.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3 pl-2">
                    {shots.map((item) => (
                      <ScreenshotThumbnail
                        key={item.id}
                        item={item}
                        onZoom={setZoomed}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {unanchored.length > 0 && (
            <div className="pt-2">
              <div className="mb-2 text-xs font-semibold text-gray-600">
                Not linked to a step
              </div>
              <div className="flex flex-wrap gap-3 pl-2">
                {unanchored.map((item) => (
                  <ScreenshotThumbnail key={item.id} item={item} onZoom={setZoomed} />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={zoomed !== null} onClose={() => setZoomed(null)} maxWidth="xl">
        <DialogTitle className="text-sm">
          {zoomed?.label}
          {zoomed?.check_test_id && (
            <span className="ml-2 font-mono text-xs text-gray-500">
              {zoomed.check_test_id}
            </span>
          )}
        </DialogTitle>
        <DialogContent>
          {zoomed && (
            <img
              src={apiUrl(zoomed.url)}
              alt={zoomed.label}
              className="max-h-[80vh] w-auto max-w-full"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScreenshotThumbnail({
  item,
  onZoom,
}: {
  item: UiEvidenceItem;
  onZoom: (item: UiEvidenceItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onZoom(item)}
      className="group text-left"
      title={item.check_test_id ? `${item.label} — ${item.check_test_id}` : item.label}
    >
      <img
        src={apiUrl(item.url)}
        alt={item.label}
        loading="lazy"
        className="h-28 w-auto rounded border border-gray-200 object-cover transition group-hover:border-primary-500"
      />
      <span className="mt-1 block max-w-[16rem] truncate text-xs text-gray-600">
        {item.label}
      </span>
    </button>
  );
}
