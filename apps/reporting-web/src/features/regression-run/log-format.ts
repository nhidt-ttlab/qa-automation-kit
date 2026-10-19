import type { RegressionJobLogStream } from '@qakit/reporting-shared';
import type { ConsoleTone } from './types';

const PREFIX = /^\[\d{4}-\d{2}-\d{2}T[^\]]*\]\s+\[(DEBUG|INFO|WARN|ERROR)\]\s+/;
const VERDICT = /^\[\d+\/\d+\]\s+(PASS|FAIL|BLOCKED)\b/;

/**
 * Classifies one log line for colouring.
 *
 * Three shapes arrive, and the timestamp prefix is optional in all of them:
 *   [<ISO>] [<LEVEL>] <msg>                            every runner logger call
 *   [<n>/<total>] <VERDICT> <TC-ID> <scenario> (<s>s)  the batch progress line, wrapped in the above
 *   Batch [...] - N run in Xs                          the batch tail, bare console.log, no prefix
 *
 * The verdict deliberately beats the level: the runner logs BLOCKED at warn and FAIL at error, so
 * colouring by level would make this console disagree with the batch summary and with the status
 * chips beside it. Colouring by verdict keeps all three saying the same thing.
 */
export function classifyLogLine(text: string, stream?: RegressionJobLogStream): ConsoleTone {
  const level = PREFIX.exec(text)?.[1];
  const body = text.replace(PREFIX, '');

  const verdict = VERDICT.exec(body.trim())?.[1];
  if (verdict === 'PASS') return 'pass';
  if (verdict === 'FAIL') return 'fail';
  if (verdict === 'BLOCKED') return 'blocked';

  if (level === 'ERROR') return 'error';
  if (level === 'WARN') return 'warn';

  // Sync output is voluminous and not about the product; tinting it keeps the runner's own lines
  // findable in a log where the sync can outnumber them three to one.
  if (stream === 'sync') return 'sync';
  if (level === 'INFO') return 'info';
  return 'plain';
}
