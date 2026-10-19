import { Alert, Card, CardContent, CardHeader } from '@mui/material';

import type { UiEvidence } from './types';

interface DiagnosticProps {
  label: string;
  value: number;
  /** Non-zero is a problem worth colouring for these; page errors and failed requests. */
  warnWhenNonZero?: boolean;
}

function Diagnostic({ label, value, warnWhenNonZero }: DiagnosticProps) {
  const isProblem = warnWhenNonZero && value > 0;
  return (
    <div className="flex flex-col">
      <span className={`text-2xl font-bold ${isProblem ? 'text-red-600' : 'text-dark-900'}`}>
        {value}
      </span>
      <span className="text-xs text-gray-600">{label}</span>
    </div>
  );
}

/**
 * Browser-level health for the run, as recorded by the runner's DiagnosticsCollector.
 *
 * `console_capture_note` is rendered whenever the runner set it, and deliberately right next
 * to the console count: the note exists because the deployed web app is built with terser
 * `drop_console: true`, so a 0 there means "we could not see", not "nothing went wrong".
 */
export function UiDiagnosticsCard({ evidence }: { evidence: UiEvidence }) {
  const { diagnostics } = evidence;

  return (
    <Card>
      <CardHeader title="Browser diagnostics" />
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Diagnostic label="Page errors" value={diagnostics.page_errors} warnWhenNonZero />
          <Diagnostic label="Console errors" value={diagnostics.console_errors} />
          <Diagnostic label="Failed requests" value={diagnostics.failed_requests} warnWhenNonZero />
          <Diagnostic label="Blocked requests" value={diagnostics.blocked_requests} />
        </div>

        {evidence.console_capture_note && (
          <Alert severity="info" className="text-xs">
            {evidence.console_capture_note}
          </Alert>
        )}

        <div className="text-xs text-gray-500">
          {evidence.browser.name} · {evidence.web_base_url}
        </div>
      </CardContent>
    </Card>
  );
}
