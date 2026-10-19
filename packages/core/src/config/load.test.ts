import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { ConfigError, deepMerge, loadProjectConfig, overlayPathFor, resolveEnvValue } from './load.js';

const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function writeConfig(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'qakit-config-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return join(dir, 'qakit.config.yaml');
}

const MINIMAL = 'project: demo-shop\n';

describe('loadProjectConfig', () => {
  it('applies defaults to a minimal config', () => {
    const { config } = loadProjectConfig({ configPath: writeConfig({ 'qakit.config.yaml': MINIMAL }), env: {} });
    assert.equal(config.locale, 'en');
    assert.equal(config.environment, 'default');
    assert.equal(config.safety.allowWrites, false);
    assert.equal(config.safety.allowDestructive, false);
    assert.equal(config.safety.budget.maxActionsPerSession, 200);
    assert.equal(config.paths.suites, 'src/suites');
    assert.deepEqual(config.reporting.tracker, { type: 'none' });
    assert.equal(config.mcp.uiServerName, 'qakit-ui');
  });

  it('merges the environment overlay, replacing arrays wholesale', () => {
    const configPath = writeConfig({
      'qakit.config.yaml': [
        'project: demo-shop',
        'web:',
        '  baseUrl: https://base.example.test',
        '  allowedHosts: [base.example.test, api.example.test]',
        '  loginPath: /sign-in',
      ].join('\n'),
      'qakit.config.uat.yaml': ['web:', '  baseUrl: https://uat.example.test', '  allowedHosts: [uat.example.test]'].join('\n'),
    });
    const loaded = loadProjectConfig({ configPath, environment: 'uat', env: {} });
    assert.equal(loaded.config.environment, 'uat');
    assert.equal(loaded.config.web?.baseUrl, 'https://uat.example.test');
    assert.deepEqual(loaded.config.web?.allowedHosts, ['uat.example.test']);
    assert.equal(loaded.config.web?.loginPath, '/sign-in');
    assert.equal(loaded.overlayPath, overlayPathFor(configPath, 'uat'));
  });

  it('takes the environment from QAKIT_ENV when none is passed', () => {
    const configPath = writeConfig({ 'qakit.config.yaml': MINIMAL, 'qakit.config.ci.yaml': 'locale: vi\n' });
    const { config } = loadProjectConfig({ configPath, env: { QAKIT_ENV: 'ci' } });
    assert.equal(config.environment, 'ci');
    assert.equal(config.locale, 'vi');
  });

  it('turns on writes and destructive actions when the configured switch is 1', () => {
    const configPath = writeConfig({
      'qakit.config.yaml': ['project: demo-shop', 'safety:', '  allowWritesEnv: QA_ALLOW_WRITES'].join('\n'),
    });
    assert.equal(loadProjectConfig({ configPath, env: { QA_ALLOW_WRITES: '0' } }).config.safety.allowWrites, false);
    const on = loadProjectConfig({ configPath, env: { QA_ALLOW_WRITES: '1' } }).config.safety;
    assert.equal(on.allowWrites, true);
    assert.equal(on.allowDestructive, true);
  });

  it('parses every auth provider type', () => {
    const configPath = writeConfig({
      'qakit.config.yaml': [
        'project: demo-shop',
        'apiSources:',
        '  core:',
        '    baseUrl: { env: CORE_URL, default: https://core.example.test }',
        '    openapi: { path: /openapi.json }',
        '    auth: { type: oauth2-password, tokenPath: /connect/token, clientId: app, usernameEnv: QA_USER, passwordEnv: QA_PASS }',
        '  shop:',
        '    baseUrl: https://shop.example.test',
        '    auth: { type: jwt-login, loginPath: /auth/login, tokenJsonPath: data.accessToken, usernameEnv: QA_USER, passwordEnv: QA_PASS }',
        '  files:',
        '    baseUrl: https://files.example.test',
        '    auth: { type: reuse, from: core }',
        '  search:',
        '    baseUrl: https://search.example.test',
        '    auth: { type: api-key, keyEnv: SEARCH_KEY, name: X-Api-Key }',
        '  legacy:',
        '    baseUrl: https://legacy.example.test',
        '    auth: { type: cookie-session, loginPath: /login, usernameEnv: QA_USER, passwordEnv: QA_PASS }',
        '  public:',
        '    baseUrl: https://public.example.test',
      ].join('\n'),
    });
    const { config } = loadProjectConfig({ configPath, env: {} });
    assert.equal(config.apiSources.core?.auth.type, 'oauth2-password');
    assert.equal(config.apiSources.core?.openapi?.cacheTtlSeconds, 3600);
    const shop = config.apiSources.shop?.auth;
    assert.ok(shop?.type === 'jwt-login');
    assert.equal(shop.usernameField, 'username');
    assert.equal(config.apiSources.search?.auth.type === 'api-key' && config.apiSources.search.auth.in, 'header');
    assert.deepEqual(config.apiSources.public?.auth, { type: 'none' });
  });

  it('resolves relative paths against the config directory', () => {
    const configPath = writeConfig({ 'qakit.config.yaml': MINIMAL });
    const loaded = loadProjectConfig({ configPath, env: {} });
    assert.equal(loaded.resolvePath('src/suites'), join(loaded.rootDir, 'src/suites'));
  });

  const rejects: Array<[string, string, RegExp]> = [
    ['a missing project name', 'locale: en\n', /project: Required/],
    ['an unknown top-level key', `${MINIMAL}colour: blue\n`, /Unrecognized key/],
    [
      'duplicate module ids',
      `${MINIMAL}modules:\n  - { id: orders }\n  - { id: orders }\n`,
      /modules\.1\.id: Duplicate module id "orders"/,
    ],
    [
      'a reuse of an unknown source',
      `${MINIMAL}apiSources:\n  files:\n    baseUrl: https://f.example.test\n    auth: { type: reuse, from: core }\n`,
      /apiSources\.files\.auth\.from: Unknown api source "core"/,
    ],
    [
      'a two-hop reuse chain',
      [
        MINIMAL.trim(),
        'apiSources:',
        '  a: { baseUrl: https://a.example.test, auth: { type: static-bearer, tokenEnv: A_TOKEN } }',
        '  b: { baseUrl: https://b.example.test, auth: { type: reuse, from: a } }',
        '  c: { baseUrl: https://c.example.test, auth: { type: reuse, from: b } }',
      ].join('\n'),
      /one hop only/,
    ],
    ['destructive without writes', `${MINIMAL}safety: { allowDestructive: true }\n`, /requires `allowWrites`/],
    ['an invalid id pattern', `${MINIMAL}ids: { testCase: "([" }\n`, /ids\.testCase: Not a valid regular expression/],
    [
      'a web api source that does not exist',
      `${MINIMAL}web: { baseUrl: https://w.example.test, allowedHosts: [w.example.test], apiSource: core }\n`,
      /web\.apiSource: Unknown api source "core"/,
    ],
    ['a non-mapping file', '- just\n- a list\n', /must be a YAML mapping/],
  ];

  for (const [name, yaml, message] of rejects) {
    it(`rejects ${name}`, () => {
      const configPath = writeConfig({ 'qakit.config.yaml': yaml });
      assert.throws(() => loadProjectConfig({ configPath, env: {} }), (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, message);
        return true;
      });
    });
  }

  it('reports a missing file clearly', () => {
    assert.throws(() => loadProjectConfig({ configPath: join(tmpdir(), 'nope', 'qakit.config.yaml') }), /not found/);
  });
});

describe('resolveEnvValue', () => {
  it('prefers a non-empty env var, then the default', () => {
    assert.equal(resolveEnvValue('literal', {}), 'literal');
    assert.equal(resolveEnvValue({ env: 'URL', default: 'fallback' }, { URL: 'from-env' }), 'from-env');
    assert.equal(resolveEnvValue({ env: 'URL', default: 'fallback' }, { URL: '' }), 'fallback');
    assert.equal(resolveEnvValue({ env: 'URL' }, {}), undefined);
    assert.equal(resolveEnvValue(undefined, {}), undefined);
  });
});

describe('deepMerge', () => {
  it('merges nested objects and replaces arrays and scalars', () => {
    assert.deepEqual(
      deepMerge({ a: { b: 1, c: [1, 2] }, d: 'x' }, { a: { c: [3] }, d: 'y', e: true }),
      { a: { b: 1, c: [3] }, d: 'y', e: true },
    );
  });
});
