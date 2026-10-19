/**
 * The classification rules behind "sync test scripts". The ones worth pinning: files outside the
 * runner are invisible, scenario scripts survive the cap, and only the runner's own manifest
 * triggers an install.
 */
import { MAX_REGRESSION_SYNC_CHANGED_FILES } from '@qakit/reporting-shared';
import {
  describeSyncOutcome,
  gitFailureMessage,
  parseGitHead,
  runnerRelativeDir,
  summarizeChangedFiles,
  tailText,
  toRunnerRelativePaths,
} from './workspace-git.util';

describe('parseGitHead', () => {
  it('splits the four unit-separated fields', () => {
    const head = parseGitHead('abc123full\x1fabc123\x1ffeat: add kldm\x1f2026-10-08T05:14:07+00:00\n');
    expect(head).toEqual({
      sha: 'abc123full',
      shortSha: 'abc123',
      subject: 'feat: add kldm',
      committedAt: '2026-10-08T05:14:07+00:00',
    });
  });

  it('returns null for an empty repository', () => {
    expect(parseGitHead('')).toBeNull();
  });
});

describe('toRunnerRelativePaths', () => {
  it('keeps only files under the runner and strips its prefix', () => {
    const files = toRunnerRelativePaths(
      [
        'tests/acme-regression/src/suites/kho/api/a.scenario.ts',
        'tests/acme-regression/package.json',
        'web-app/src/index.ts',
        'tests/acme-regression-other/x.ts',
        '',
      ].join('\n'),
      'tests/acme-regression',
    );
    expect(files).toEqual(['src/suites/kho/api/a.scenario.ts', 'package.json']);
  });

  it('passes everything through when the runner is the repository root', () => {
    expect(toRunnerRelativePaths('a.ts\r\nb.ts\n', '')).toEqual(['a.ts', 'b.ts']);
  });
});

describe('summarizeChangedFiles', () => {
  it('counts scenario scripts and detects the runner manifest', () => {
    const summary = summarizeChangedFiles([
      'src/suites/kho/api/a.scenario.ts',
      'src/suites/kho/ui/b.scenario.ts',
      'docs/readme.md',
      'package-lock.json',
    ]);
    expect(summary.total).toBe(4);
    expect(summary.scenarioFiles).toBe(2);
    expect(summary.dependenciesChanged).toBe(true);
    // Scenario files lead the list so the cap never hides them.
    expect(summary.files.slice(0, 2)).toEqual([
      'src/suites/kho/api/a.scenario.ts',
      'src/suites/kho/ui/b.scenario.ts',
    ]);
  });

  it('ignores a package.json that is not the runner root manifest', () => {
    const summary = summarizeChangedFiles(['tools/fixtures/package.json']);
    expect(summary.dependenciesChanged).toBe(false);
  });

  it('caps the list but reports the real total', () => {
    const many = Array.from({ length: MAX_REGRESSION_SYNC_CHANGED_FILES + 5 }, (_, i) => `f${i}.ts`);
    const summary = summarizeChangedFiles(many);
    expect(summary.files).toHaveLength(MAX_REGRESSION_SYNC_CHANGED_FILES);
    expect(summary.total).toBe(MAX_REGRESSION_SYNC_CHANGED_FILES + 5);
  });
});

describe('runnerRelativeDir', () => {
  it('is empty when the runner is the repository', () => {
    expect(runnerRelativeDir('/repo', '/repo')).toBe('');
  });

  it('uses forward slashes', () => {
    expect(runnerRelativeDir('/repo', '/repo/tests/runner')).toBe('tests/runner');
  });
});

describe('tailText', () => {
  it('keeps the end and says how much was cut', () => {
    const out = tailText('abcdefghij', 4);
    expect(out).toBe('…(6 chars omitted)\nghij');
  });

  it('returns short text unchanged, without trailing whitespace', () => {
    expect(tailText('ok\n\n', 100)).toBe('ok');
  });
});

describe('describeSyncOutcome', () => {
  it('says up to date when nothing moved', () => {
    expect(
      describeSyncOutcome({
        commitsPulled: 0,
        summary: summarizeChangedFiles([]),
        dependenciesInstalled: false,
      }),
    ).toMatch(/up to date/i);
  });

  it('names commits, files and scenario scripts', () => {
    const text = describeSyncOutcome({
      commitsPulled: 3,
      summary: summarizeChangedFiles(['a.scenario.ts', 'b.md', 'package.json']),
      dependenciesInstalled: true,
    });
    expect(text).toBe(
      'Pulled 3 commits, 3 files changed under the runner, 1 scenario script, dependencies installed.',
    );
  });
});

describe('gitFailureMessage', () => {
  it('prefers the error line over the trailing "Aborting"', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by merge:',
      '\ttests/runner/src/suites/kho/api/b.scenario.ts',
      'Please commit your changes or stash them before you merge.',
      'Aborting',
    ].join('\n');
    expect(gitFailureMessage(stderr, 'x')).toBe(
      'Your local changes to the following files would be overwritten by merge:',
    );
  });

  it('strips a fatal: prefix', () => {
    expect(gitFailureMessage('fatal: Not possible to fast-forward, aborting.\n', 'x')).toBe(
      'Not possible to fast-forward, aborting.',
    );
  });

  it('falls back to the last line, then to the caller text', () => {
    expect(gitFailureMessage('something odd\n', 'x')).toBe('something odd');
    expect(gitFailureMessage('', 'git pull failed (exit 1)')).toBe('git pull failed (exit 1)');
  });
});
