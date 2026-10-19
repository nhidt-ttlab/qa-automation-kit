import { Card, CardContent, CardHeader, Typography } from '@mui/material';
import type { TestRunDetailResponseDto } from '@qakit/reporting-shared';

function BulletSection({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <div>
      <Typography variant="caption" className="text-gray-500 block">
        {label}
      </Typography>
      <ul className="list-disc pl-5 space-y-1">
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>
            <Typography variant="body2" className="break-words">
              {item}
            </Typography>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Section 8 of the generated QA report: the run's business context -- project, supplier,
 * contract, what the scenario typed versus what it deliberately left blank, what it created --
 * plus the report's quick conclusion. This is what a reviewer needs at a glance; the raw
 * request/response bodies live in the downloadable trace artifact linked from Artifacts.
 *
 * Both arrays are prose authored by the runner and stored verbatim, so they render as plain
 * text -- an entry may contain markdown backticks and this app has no markdown renderer.
 */
export function RunTechnicalAppendixCard({ run }: { run: TestRunDetailResponseDto }) {
  const keyFacts = run.overview_key_data ?? [];
  const highlights = run.overview_highlights ?? [];

  // A run synced before these fields were populated has nothing to say here; an empty card
  // would read as "the run recorded no context", which is a different and wrong claim.
  if (!keyFacts.length && !highlights.length) return null;

  return (
    <Card>
      <CardHeader title="Technical Appendix" />
      <CardContent className="space-y-3">
        <BulletSection label="Key facts" items={keyFacts} />
        <BulletSection label="Highlights" items={highlights} />
      </CardContent>
    </Card>
  );
}
