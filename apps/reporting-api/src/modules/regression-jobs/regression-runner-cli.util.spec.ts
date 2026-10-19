/**
 * Runner layout resolution: the defaults describe a tsx runner checkout, and every location can be
 * repointed from the API's .env (a qakit project runs a compiled bin with a --config and no
 * environment files).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkRunnerAvailability,
  environmentConfigPath,
  environmentFileRequired,
  environmentSupportsUi,
  listRunnerEnvironments,
  resolveRunnerPaths,
  runnerSpawnArgs,
} from './regression-runner-cli.util';

const RUNNER_ENV_KEYS = [
  'REGRESSION_RUNNER_PATH',
  'REGRESSION_RUNNER_SCRIPT',
  'REGRESSION_RUNNER_TSX',
  'REGRESSION_RUNNER_ARGS',
  'REGRESSION_RUNNER_ENVIRONMENTS_DIR',
  'REGRESSION_RUNNER_ENVIRONMENT_FILE',
  'REGRESSION_RUNNER_ENVIRONMENTS',
  'REGRESSION_RUNNER_SESSIONS_DIR',
] as const;

describe('regression runner layout', () => {
  let root: string;
  const saved: Partial<Record<string, string>> = {};

  const touch = (rel: string, content = ''): void => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-layout-'));
    for (const key of RUNNER_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.REGRESSION_RUNNER_PATH = root;
  });

  afterEach(() => {
    for (const key of RUNNER_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('defaults', () => {
    it('describe a tsx runner checkout', () => {
      const paths = resolveRunnerPaths();
      expect(paths.runSuite).toBe(path.join(root, 'src', 'entrypoints', 'run-suite.ts'));
      expect(paths.tsxCli).toBe(path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'));
      expect(paths.environmentsDir).toBe(path.join(root, 'configs', 'environments'));
      expect(paths.sessionsDir).toBe(path.join(root, '.sessions'));
      expect(paths.baseArgs).toEqual([]);
      expect(environmentFileRequired(paths)).toBe(true);
      expect(runnerSpawnArgs(paths, ['--list'])).toEqual([paths.tsxCli, paths.runSuite, '--list']);
    });

    it('list environments from configs/environments/*.json', () => {
      touch('configs/environments/uat.json', '{"web":{}}');
      touch('configs/environments/qa.json', '{}');
      touch('configs/environments/notes.md');
      const paths = resolveRunnerPaths();
      expect(listRunnerEnvironments(paths)).toEqual(['qa', 'uat']);
      expect(environmentSupportsUi(paths, 'uat')).toBe(true);
      expect(environmentSupportsUi(paths, 'qa')).toBe(false);
      expect(environmentSupportsUi(paths, 'missing')).toBe(false);
    });

    it('report a missing script by its configured path', () => {
      const result = checkRunnerAvailability(resolveRunnerPaths());
      expect(result.available).toBe(false);
      expect(result.reason).toContain('run-suite.ts');
      expect(result.reason).toContain('REGRESSION_RUNNER_SCRIPT');
    });
  });

  describe('a qakit project', () => {
    beforeEach(() => {
      process.env.REGRESSION_RUNNER_SCRIPT = 'node_modules/@qakit/runner/dist/bin.js';
      process.env.REGRESSION_RUNNER_TSX = 'none';
      process.env.REGRESSION_RUNNER_ARGS = '  --config   qakit.config.yaml ';
      process.env.REGRESSION_RUNNER_ENVIRONMENTS = 'local, uat';
    });

    it('runs the compiled bin on plain node with its base args first', () => {
      const paths = resolveRunnerPaths();
      expect(paths.tsxCli).toBeUndefined();
      expect(runnerSpawnArgs(paths, ['--kind', 'api'])).toEqual([
        path.join(root, 'node_modules', '@qakit', 'runner', 'dist', 'bin.js'),
        '--config',
        'qakit.config.yaml',
        '--kind',
        'api',
      ]);
    });

    it('is available without tsx once the script exists', () => {
      touch('node_modules/@qakit/runner/dist/bin.js');
      expect(checkRunnerAvailability(resolveRunnerPaths())).toEqual({ available: true });
    });

    it('takes the fixed environment list and needs no file per environment', () => {
      const paths = resolveRunnerPaths();
      expect(listRunnerEnvironments(paths)).toEqual(['local', 'uat']);
      expect(environmentFileRequired(paths)).toBe(false);
      expect(environmentSupportsUi(paths, 'local')).toBe(true);
    });
  });

  it('scans a custom environment file pattern, and leaves non-JSON UI checks to the runner', () => {
    process.env.REGRESSION_RUNNER_ENVIRONMENTS_DIR = '.';
    process.env.REGRESSION_RUNNER_ENVIRONMENT_FILE = 'qakit.config.{env}.yaml';
    touch('qakit.config.yaml');
    touch('qakit.config.uat.yaml');
    touch('qakit.config.local.yaml');
    const paths = resolveRunnerPaths();
    expect(listRunnerEnvironments(paths)).toEqual(['local', 'uat']);
    expect(environmentConfigPath(paths, 'uat')).toBe(path.join(root, 'qakit.config.uat.yaml'));
    expect(environmentSupportsUi(paths, 'uat')).toBe(true);
  });
});
