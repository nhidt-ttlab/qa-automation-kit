/**
 * Turns the child process's stdout/stderr chunks into whole lines.
 *
 * A chunk boundary lands wherever the OS pipe buffer happens to fill, so a naive `split('\n')`
 * per chunk loses or duplicates whatever straddles it. This keeps the remainder and emits only
 * completed lines.
 *
 * A lone `\r` terminates a line here as well as `\r\n` and `\n`. That is not theoretical: the
 * sync's old progress writer used `\r` to rewrite one line in place, and any scenario printing a
 * progress bar does the same. Treating it as a terminator turns those into separate log lines
 * instead of one unbounded line that grows until the process ends.
 */
import { MAX_REGRESSION_LOG_LINE_LENGTH } from '@qakit/reporting-shared';

const TRUNCATION_MARKER = ' ... [truncated]';

export function truncateLogLine(line: string): string {
  if (line.length <= MAX_REGRESSION_LOG_LINE_LENGTH) return line;
  return (
    line.slice(0, MAX_REGRESSION_LOG_LINE_LENGTH - TRUNCATION_MARKER.length) + TRUNCATION_MARKER
  );
}

export class LineSplitter {
  private remainder = '';

  /** Completed lines in this chunk. Trailing partial text is held for the next call. */
  push(chunk: string): string[] {
    let text = this.remainder + chunk;

    // A CR at the very end of a chunk is ambiguous: it is either a lone-CR terminator, or the
    // first half of a CRLF whose LF is in the next chunk. Deciding now gets the common Windows
    // case wrong — it would emit the line and then treat the following LF as a second, empty one.
    // So hold the CR back and let the next chunk settle it.
    const heldCr = text.endsWith('\r');
    if (heldCr) text = text.slice(0, -1);

    const parts = text.split(/\r\n|\n|\r/);
    // The final element is whatever followed the last terminator: either '' when the chunk ended
    // cleanly, or a partial line to carry forward.
    this.remainder = (parts.pop() ?? '') + (heldCr ? '\r' : '');
    return parts.map(truncateLogLine);
  }

  /** The unterminated tail, if the process exited without a final newline. */
  flush(): string[] {
    // A held-back CR was a lone terminator after all: nothing follows it.
    const tail = this.remainder.endsWith('\r')
      ? this.remainder.slice(0, -1)
      : this.remainder;
    this.remainder = '';
    return tail ? [truncateLogLine(tail)] : [];
  }
}
