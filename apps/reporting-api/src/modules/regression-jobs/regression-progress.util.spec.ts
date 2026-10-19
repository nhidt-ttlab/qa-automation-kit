/**
 * Progress parsing against the runner's real output shapes. The fixtures below are copied from
 * actual `npm run suite` output, prefix and all, because the prefix is the part a hand-written
 * fixture tends to forget: every logger line carries it, and the batch tail carries none.
 */
import {
  applyProgressLine,
  createProgressAccumulator,
  parseBatchCounts,
  parseBatchHeader,
  parseScenarioProgress,
  parseSummaryPath,
} from './regression-progress.util';

const PREFIX = '[2026-09-07T04:53:24.453Z] [INFO] ';

describe('parseScenarioProgress', () => {
  it('parses a progress line with the logger prefix', () => {
    expect(
      parseScenarioProgress(`${PREFIX}[12/566] PASS    TC-DH-L01        po-list-keyword-search (3.4s)`),
    ).toEqual({
      index: 12,
      total: 566,
      verdict: 'PASS',
      testCaseId: 'TC-DH-L01',
      scenario: 'po-list-keyword-search',
      durationMs: 3400,
    });
  });

  it('parses the same line without a prefix', () => {
    expect(
      parseScenarioProgress('[1/2] BLOCKED TC-KHO-A02 kho-issue-partial (6.1s)')?.verdict,
    ).toBe('BLOCKED');
  });

  it('does not let the error text appended to a FAIL line leak into the scenario key', () => {
    const parsed = parseScenarioProgress(
      '[3/566] FAIL    TC-KHO-A03       kho-transfer (5.4s) — 401 Unauthorized on POST /api/x',
    );
    expect(parsed?.scenario).toBe('kho-transfer');
    expect(parsed?.verdict).toBe('FAIL');
  });

  it('returns null for arbitrary text rather than throwing', () => {
    expect(parseScenarioProgress('> demo-runner@0.1.0 suite')).toBeNull();
    expect(parseScenarioProgress('')).toBeNull();
  });
});

describe('parseBatchHeader', () => {
  it('reads the scenario total before any scenario has run', () => {
    expect(parseBatchHeader(`${PREFIX}Batch [all]: 566 scenario(s) against "qa"`)).toEqual({
      label: 'all',
      total: 566,
      environment: 'qa',
    });
  });
});

describe('parseBatchCounts', () => {
  it('parses the unprefixed tail line', () => {
    expect(parseBatchCounts('  PASS 500   BLOCKED 40   FAIL 26')).toEqual({
      pass: 500,
      blocked: 40,
      fail: 26,
    });
  });
});

describe('parseSummaryPath', () => {
  it('parses the absolute path the runner prints', () => {
    expect(
      parseSummaryPath('Summary: C:\\repo\\reports\\_batches\\2026-09-07-all.md'),
    ).toBe('C:\\repo\\reports\\_batches\\2026-09-07-all.md');
  });

  it('ignores a scenario that merely logs the word Summary', () => {
    expect(parseSummaryPath('Summary: all good')).toBeNull();
  });
});

describe('applyProgressLine', () => {
  it('tallies verdicts and tracks position through a batch', () => {
    const acc = createProgressAccumulator();
    applyProgressLine(acc, `${PREFIX}Batch [kho]: 3 scenario(s) against "qa"`);
    applyProgressLine(acc, `${PREFIX}[1/3] PASS    TC-A a (1.0s)`);
    applyProgressLine(acc, `${PREFIX}[2/3] FAIL    TC-B b (2.0s)`);
    applyProgressLine(acc, `${PREFIX}[3/3] BLOCKED TC-C c (3.0s)`);

    expect(acc).toMatchObject({ total: 3, completed: 3, pass: 1, fail: 1, blocked: 1 });
    expect(acc.finalCounts).toBe(false);
  });

  it('lets the batch tail supersede the running tally', () => {
    // The tail is what the runner wrote to the summary file, so it wins even if a progress line
    // was malformed or the log was truncated mid-batch.
    const acc = createProgressAccumulator();
    applyProgressLine(acc, `${PREFIX}[1/3] PASS TC-A a (1.0s)`);
    applyProgressLine(acc, '  PASS 500   BLOCKED 40   FAIL 26');

    expect(acc).toMatchObject({ pass: 500, blocked: 40, fail: 26, finalCounts: true });
  });

  it('captures the summary path and reports whether a line mattered', () => {
    const acc = createProgressAccumulator();
    expect(applyProgressLine(acc, 'Summary: /r/reports/_batches/x.md')).toBe(true);
    expect(acc.summaryPath).toBe('/r/reports/_batches/x.md');
    expect(applyProgressLine(acc, 'some unrelated scenario output')).toBe(false);
  });
});
