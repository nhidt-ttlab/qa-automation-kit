import { Card, CardContent, CardHeader, Chip, Link as MuiLink } from '@mui/material';
import { UI_EVIDENCE_KIND } from '@qakit/reporting-shared';

import { apiUrl } from '@/shared/api/apiUrl';

import { formatBytes, type UiEvidence, type UiEvidenceItem } from './types';

const DOWNLOAD_KINDS: string[] = [
  UI_EVIDENCE_KIND.TRACE_ZIP,
  UI_EVIDENCE_KIND.NETWORK_HAR,
  UI_EVIDENCE_KIND.CONSOLE_LOG,
  UI_EVIDENCE_KIND.DOM_SNAPSHOT,
  UI_EVIDENCE_KIND.GRID_SNAPSHOT,
];

/**
 * The debugging artifacts: the session recording and the files worth opening in another tool.
 *
 * The runner keeps video and trace on a retain-on-failure policy, so a passing run usually has
 * neither — this renders nothing rather than an empty shell in that case.
 */
export function UiRecordingsCard({ evidence }: { evidence: UiEvidence }) {
  const video = evidence.items.find(
    (item) => item.kind === UI_EVIDENCE_KIND.VIDEO,
  );
  const downloads = evidence.items.filter((item) =>
    DOWNLOAD_KINDS.includes(item.kind),
  );

  if (!video && downloads.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Recording & artifacts" />
      <CardContent className="space-y-3">
        {video && (
          <video
            controls
            preload="metadata"
            src={apiUrl(video.url)}
            className="max-h-[480px] w-full rounded border border-gray-200 bg-black"
          />
        )}

        {downloads.map((item) => (
          <DownloadRow key={item.id} item={item} />
        ))}
      </CardContent>
    </Card>
  );
}

function DownloadRow({ item }: { item: UiEvidenceItem }) {
  const isTrace = item.kind === UI_EVIDENCE_KIND.TRACE_ZIP;

  return (
    <div className="text-sm">
      <Chip label={item.kind} size="small" variant="outlined" className="mr-2" />
      <MuiLink
        href={apiUrl(item.url)}
        target="_blank"
        rel="noreferrer"
        underline="hover"
      >
        {item.label}
      </MuiLink>
      <span className="ml-2 text-xs text-gray-500">
        {formatBytes(item.size_bytes)}
      </span>
      {isTrace && (
        <div className="mt-1 text-xs text-gray-500">
          Open it at{' '}
          <MuiLink
            href="https://trace.playwright.dev"
            target="_blank"
            rel="noreferrer"
            underline="hover"
          >
            trace.playwright.dev
          </MuiLink>{' '}
          to step through the run frame by frame.
        </div>
      )}
    </div>
  );
}
