import { describe, expect, it } from 'vitest';
import { classifyLogLine } from './log-format';

const PREFIX = '[2026-09-07T04:53:24.453Z]';

describe('classifyLogLine', () => {
  it('colours a progress line by its verdict', () => {
    expect(
      classifyLogLine(`${PREFIX} [INFO] [12/566] PASS    TC-DH-L01 po-list (3.2s)`),
    ).toBe('pass');
  });

  it('lets the verdict beat the level', () => {
    // The runner logs FAIL at ERROR and BLOCKED at WARN. Colouring by level would make this
    // console disagree with the batch summary and the status chips beside it.
    expect(
      classifyLogLine(`${PREFIX} [ERROR] [3/566] FAIL    TC-KHO-A03 kho-transfer (5.4s)`),
    ).toBe('fail');
    expect(
      classifyLogLine(`${PREFIX} [WARN] [2/566] BLOCKED TC-KHO-A02 kho-issue (6.1s)`),
    ).toBe('blocked');
  });

  it('falls back to the level when there is no verdict', () => {
    expect(classifyLogLine(`${PREFIX} [ERROR] Unhandled error: boom`)).toBe('error');
    expect(classifyLogLine(`${PREFIX} [WARN] Cancel requested`)).toBe('warn');
    expect(classifyLogLine(`${PREFIX} [INFO] Batch [all]: 566 scenario(s)`)).toBe('info');
  });

  it('handles the unprefixed batch tail', () => {
    // The closing summary is a bare console.log with no timestamp at all.
    expect(classifyLogLine('  PASS 500   BLOCKED 40   FAIL 26')).toBe('plain');
  });

  it('tints sync output so the runner lines stay findable', () => {
    expect(classifyLogLine('test_runs: 12 imported', 'sync')).toBe('sync');
  });

  it('does not throw on empty input', () => {
    expect(classifyLogLine('')).toBe('plain');
  });
});
