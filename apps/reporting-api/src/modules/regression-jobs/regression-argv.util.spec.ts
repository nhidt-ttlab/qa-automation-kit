/**
 * The argv builder is the security boundary between an HTTP body and a spawned process, so these
 * tests are about what must NEVER reach the runner rather than about happy-path formatting.
 *
 * Two of them protect decisions that are easy to undo by accident and expensive when undone:
 *   - `--clean-all` is never emitted (the API does that wipe itself, safely).
 *   - QAKIT_ALLOW_WRITES is always set, in both directions, never omitted.
 */
import { ValidationError } from '@qakit/reporting-shared';
import {
  buildLabel,
  buildPreviewArgv,
  buildRegressionArgv,
  normalizeCustomEnv,
  normalizeRegressionSpec,
  runnerWritesEnvName,
  type NormalizeContext,
  type RegressionJobSpec,
} from './regression-argv.util';

const ctx: NormalizeContext = {
  allowedEnvironments: ['qa', 'uat'],
  knownTestCaseIds: new Set(['TC-DH-L01', 'TC-DH-L02', 'SPIKE-R01', 'TC-BOQG-A04B']),
};

function spec(overrides: Partial<RegressionJobSpec> = {}): RegressionJobSpec {
  return {
    modules: [],
    testCaseIds: [],
    environment: 'qa',
    dataMode: 'existing',
    writeMode: false,
    bail: false,
    headed: false,
    customEnv: {},
    ...overrides,
  };
}

describe('normalizeRegressionSpec', () => {
  it('accepts the empty selector, which means the whole suite', () => {
    const result = normalizeRegressionSpec({}, ctx);
    expect(result).toMatchObject({
      modules: [],
      testCaseIds: [],
      environment: 'qa',
      dataMode: 'existing',
      writeMode: false,
    });
    expect(result.kind).toBeUndefined();
    expect(result.cleanup).toBeUndefined();
  });

  it('defaults to the runner\'s first environment when it offers no "qa"', () => {
    const local = { ...ctx, allowedEnvironments: ['local', 'uat'] };
    expect(normalizeRegressionSpec({}, local).environment).toBe('local');
    expect(normalizeRegressionSpec({ environment: '  ' }, local).environment).toBe('local');
    expect(() => normalizeRegressionSpec({ environment: 'qa' }, local)).toThrow(/local, uat/);
  });

  it('rejects a kind the runner would throw on', () => {
    expect(() => normalizeRegressionSpec({ kind: 'both' }, ctx)).toThrow(ValidationError);
  });

  it('lowercases, trims and dedupes module tokens', () => {
    const result = normalizeRegressionSpec(
      { modules: ['  Warehouse ', 'warehouse', 'KHO'] },
      ctx,
    );
    expect(result.modules).toEqual(['warehouse', 'kho']);
  });

  it.each([
    ['a space', 'purchase order'],
    ['a semicolon', 'kho;rm'],
    ['a traversal', '../../etc'],
    ['a newline', 'kho\nwarehouse'],
    ['a leading dash', '--all'],
  ])('rejects a module token containing %s', (_label, token) => {
    expect(() => normalizeRegressionSpec({ modules: [token] }, ctx)).toThrow(ValidationError);
  });

  it('uppercases test case ids and accepts the irregular real-world shapes', () => {
    const result = normalizeRegressionSpec(
      { test_case_ids: ['tc-dh-l01', 'spike-r01', 'tc-boqg-a04b'] },
      ctx,
    );
    expect(result.testCaseIds).toEqual(['TC-DH-L01', 'SPIKE-R01', 'TC-BOQG-A04B']);
  });

  it('rejects a test case id that is not in the runner catalog, and names it', () => {
    expect(() =>
      normalizeRegressionSpec({ test_case_ids: ['TC-DH-L01', 'TC-NOPE-99'] }, ctx),
    ).toThrow(/TC-NOPE-99/);
  });

  it('rejects more than the configured maximum of ids or modules', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `TC-X-${i}`);
    expect(() => normalizeRegressionSpec({ test_case_ids: ids }, ctx)).toThrow(ValidationError);
    const modules = Array.from({ length: 21 }, (_, i) => `mod-${i}`);
    expect(() => normalizeRegressionSpec({ modules }, ctx)).toThrow(ValidationError);
  });

  it('rejects a grep containing a newline or a space', () => {
    expect(() => normalizeRegressionSpec({ grep: 'a\nb' }, ctx)).toThrow(ValidationError);
    expect(() => normalizeRegressionSpec({ grep: 'a b' }, ctx)).toThrow(ValidationError);
  });

  it('rejects an environment outside the runner config directory', () => {
    expect(() => normalizeRegressionSpec({ environment: 'prod' }, ctx)).toThrow(/qa, uat/);
  });

  it('keeps cleanup tri-state: absent stays undefined, false stays false', () => {
    expect(normalizeRegressionSpec({}, ctx).cleanup).toBeUndefined();
    expect(normalizeRegressionSpec({ cleanup: null }, ctx).cleanup).toBeUndefined();
    expect(normalizeRegressionSpec({ cleanup: false }, ctx).cleanup).toBe(false);
    expect(normalizeRegressionSpec({ cleanup: true }, ctx).cleanup).toBe(true);
  });

  it('rejects a slow-mo above the cap or below zero', () => {
    expect(() => normalizeRegressionSpec({ ui_slowmo_ms: 99999 }, ctx)).toThrow(ValidationError);
    expect(() => normalizeRegressionSpec({ ui_slowmo_ms: -1 }, ctx)).toThrow(ValidationError);
  });
});

describe('buildRegressionArgv', () => {
  it('emits every value as its own argv element, never --flag=value', () => {
    const { argv } = buildRegressionArgv(
      spec({ kind: 'ui', modules: ['kho'], grep: 'receipt' }),
    );
    expect(argv).toContain('--kind');
    expect(argv[argv.indexOf('--kind') + 1]).toBe('ui');
    expect(argv.some((a) => a.includes('='))).toBe(false);
  });

  it('repeats --module and --testcase rather than comma-joining them', () => {
    const { argv } = buildRegressionArgv(
      spec({ modules: ['kho', 'don-hang'], testCaseIds: ['TC-DH-L01', 'TC-DH-L02'] }),
    );
    expect(argv.filter((a) => a === '--module')).toHaveLength(2);
    expect(argv.filter((a) => a === '--testcase')).toHaveLength(2);
    expect(argv.some((a) => a.includes(','))).toBe(false);
  });

  it('NEVER emits --clean-all; scope "all" is performed by the API instead', () => {
    const { argv } = buildRegressionArgv(spec({ cleanScope: 'all' }));
    expect(argv).not.toContain('--clean-all');
    expect(argv).not.toContain('--clean');
  });

  it('delegates scope "run" to the runner, which also purges its own SQLite rows', () => {
    expect(buildRegressionArgv(spec({ cleanScope: 'run' })).argv).toContain('--clean');
  });

  it('always states the environment rather than relying on the runner default', () => {
    const { argv } = buildRegressionArgv(spec({ environment: 'qa' }));
    expect(argv[argv.indexOf('--env') + 1]).toBe('qa');
  });

  it('emits cleanup flags only when the tri-state was actually decided', () => {
    expect(buildRegressionArgv(spec()).argv).not.toContain('--cleanup');
    expect(buildRegressionArgv(spec()).argv).not.toContain('--no-cleanup');
    expect(buildRegressionArgv(spec({ cleanup: true })).argv).toContain('--cleanup');
    expect(buildRegressionArgv(spec({ cleanup: false })).argv).toContain('--no-cleanup');
  });

  it("sets QAKIT_ALLOW_WRITES explicitly in both directions, and never to ''", () => {
    // The runner's own .env sets this to 1 and its loader only fills unset keys, so omitting the
    // patch would silently mean write mode. '' is also unsafe: libuv drops empty env vars on
    // Windows, which lands back on the .env value.
    expect(buildRegressionArgv(spec({ writeMode: false })).envPatch).toMatchObject({
      QAKIT_ALLOW_WRITES: '0',
    });
    expect(buildRegressionArgv(spec({ writeMode: true })).envPatch).toMatchObject({
      QAKIT_ALLOW_WRITES: '1',
    });
  });

  it('refuses a flag-like value that slipped past normalisation', () => {
    // parseArgs only *warns* on an unknown flag, so a swallowed "--all" would silently widen a
    // one-testcase job into the whole suite.
    expect(() => buildRegressionArgv(spec({ grep: '--all' }))).toThrow(ValidationError);
  });
});

describe('buildPreviewArgv', () => {
  it('carries the selection and --list, and nothing that would need credentials', () => {
    const argv = buildPreviewArgv(
      spec({ kind: 'api', modules: ['kho'], cleanScope: 'all', dataMode: 'seeded' }),
    );
    expect(argv).toEqual(['--kind', 'api', '--module', 'kho', '--list']);
    expect(argv).not.toContain('--env');
    expect(argv).not.toContain('--data-mode');
  });
});

describe('buildLabel', () => {
  it('matches what the runner computes for the same selector', () => {
    // Mirrors parseBatchArgs in run-suite.ts. The runner names its summary file after this, so a
    // divergence would lose the artifact the job just produced.
    expect(buildLabel(spec())).toBe('all');
    expect(
      buildLabel(spec({ kind: 'ui', modules: ['kho', 'don-hang'], grep: 'x' })),
    ).toBe('ui-kho-don-hang-x');
    expect(buildLabel(spec({ testCaseIds: ['TC-DH-L01', 'TC-DH-L02'] }))).toBe(
      'TC-DH-L01-TC-DH-L02',
    );
  });
});

describe('normalizeCustomEnv', () => {
  it('keeps well-formed parameters, including an empty value', () => {
    expect(
      normalizeCustomEnv({ REPLACE_MATERIAL_PROJECT_IDS: 'a,b', FIXTURE_PATH: '', X1_Y: 'v' }),
    ).toEqual({ REPLACE_MATERIAL_PROJECT_IDS: 'a,b', FIXTURE_PATH: '', X1_Y: 'v' });
    expect(normalizeCustomEnv(undefined)).toEqual({});
    expect(normalizeCustomEnv(null)).toEqual({});
  });

  it('refuses a name that is not UPPER_SNAKE_CASE', () => {
    for (const name of ['lower', '1LEADING', 'HAS-DASH', 'HAS SPACE', 'A'.repeat(65)]) {
      expect(() => normalizeCustomEnv({ [name]: 'v' })).toThrow(ValidationError);
    }
  });

  it('refuses a value carrying a line break or a NUL', () => {
    expect(() => normalizeCustomEnv({ FOO: 'a\nb' })).toThrow(ValidationError);
    expect(() => normalizeCustomEnv({ FOO: 'a\u0000b' })).toThrow(ValidationError);
  });

  it('refuses the names that would let a request hijack the process or lie about the run', () => {
    // PATH and NODE_OPTIONS decide which binary and which code run. The write switch decides
    // whether real records are modified - and the "Allow destructive writes" checkbox, plus the
    // preview warning built from it, would both still say "off".
    for (const name of ['PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'DATABASE_URL', runnerWritesEnvName()]) {
      expect(() => normalizeCustomEnv({ [name]: 'x' })).toThrow(ValidationError);
    }
  });

  it('caps the number of parameters', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 26; i++) many[`P${i}`] = 'v';
    expect(() => normalizeCustomEnv(many)).toThrow(ValidationError);
  });
});

describe('buildEnvPatch with custom parameters', () => {
  it('merges them under, never over, the variables the API owns', () => {
    // The name validation already refuses these keys; this is the second, independent defence -
    // a gap in that list still cannot flip the write switch or colour the log.
    const built = buildRegressionArgv(
      spec({ writeMode: false, customEnv: { ACME_FIXTURE: 'configs/x.json', NO_COLOR: '0' } as Record<string, string> }),
    );
    expect(built.envPatch.ACME_FIXTURE).toBe('configs/x.json');
    expect(built.envPatch[runnerWritesEnvName()]).toBe('0');
    expect(built.envPatch.NO_COLOR).toBe('1');
  });

  it('carries custom parameters through normalize into the patch', () => {
    const normalized = normalizeRegressionSpec(
      { custom_env: { REPLACE_MATERIAL_PROJECT_IDS: 'guid-1,guid-2' } },
      ctx,
    );
    expect(buildRegressionArgv(normalized).envPatch.REPLACE_MATERIAL_PROJECT_IDS).toBe(
      'guid-1,guid-2',
    );
  });

  it('never turns a custom parameter into an argv token', () => {
    const built = buildRegressionArgv(spec({ customEnv: { FOO: '--all' } }));
    expect(built.argv).not.toContain('--all');
    expect(built.argv).not.toContain('FOO');
  });
});
