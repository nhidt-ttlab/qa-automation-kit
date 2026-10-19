/**
 * The line splitter reassembles lines across chunk boundaries. Every case here is one a naive
 * `chunk.split('\n')` gets wrong, which is why it exists at all.
 */
import { MAX_REGRESSION_LOG_LINE_LENGTH } from '@qakit/reporting-shared';
import { LineSplitter, truncateLogLine } from './regression-log.util';

describe('LineSplitter', () => {
  it('holds a partial line until the rest of it arrives', () => {
    const s = new LineSplitter();
    expect(s.push('hello ')).toEqual([]);
    expect(s.push('world\n')).toEqual(['hello world']);
  });

  it('emits several lines from one chunk', () => {
    expect(new LineSplitter().push('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
  });

  it('handles a terminator split across two chunks', () => {
    const s = new LineSplitter();
    expect(s.push('line\r')).toEqual([]);
    expect(s.push('\nnext\n')).toEqual(['line', 'next']);
  });

  it('treats a lone CR as a terminator', () => {
    // A progress bar that rewrites one line in place would otherwise become a single line growing
    // without bound until the process exits.
    expect(new LineSplitter().push('50%\r75%\r100%\n')).toEqual(['50%', '75%', '100%']);
  });

  it('emits the unterminated tail on flush', () => {
    const s = new LineSplitter();
    expect(s.push('no newline at the end')).toEqual([]);
    expect(s.flush()).toEqual(['no newline at the end']);
    expect(s.flush()).toEqual([]);
  });

  it('truncates a runaway line instead of letting it bloat the log', () => {
    const long = 'x'.repeat(MAX_REGRESSION_LOG_LINE_LENGTH + 500);
    const [line] = new LineSplitter().push(`${long}\n`);
    expect(line).toHaveLength(MAX_REGRESSION_LOG_LINE_LENGTH);
    expect(line.endsWith('[truncated]')).toBe(true);
  });
});

describe('truncateLogLine', () => {
  it('leaves a normal line untouched', () => {
    expect(truncateLogLine('short')).toBe('short');
  });
});

describe('LineSplitter CRLF edge cases', () => {
  it('does not emit a phantom empty line when CRLF straddles a chunk boundary', () => {
    // The regression this guards: a chunk ending in CR used to emit its line immediately, and the
    // LF arriving next was then read as a second, empty line.
    const s = new LineSplitter();
    const out = [...s.push('alpha\r'), ...s.push('\nbeta\r'), ...s.push('\ngamma\r\n')];
    expect(out).toEqual(['alpha', 'beta', 'gamma']);
    expect(s.flush()).toEqual([]);
  });

  it('still treats a held CR as a terminator when nothing follows it', () => {
    const s = new LineSplitter();
    expect(s.push('done\r')).toEqual([]);
    expect(s.flush()).toEqual(['done']);
  });
});
