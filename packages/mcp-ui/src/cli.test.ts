import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadProjectConfig } from '@qakit/core';
import { parseUiMcpArgs } from './cli.js';
import { createDefaultUiMcpSetup, loadLocalePack, secretValuesFromConfig, setupDefaultsFromConfig } from './default-setup.js';
import { resolveUiMcpSetup } from './server.js';
import { englishUiMcpText } from './text.js';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function writeConfig(yaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-mcp-ui-cli-'));
  const file = path.join(dir, 'qakit.config.yaml');
  fs.writeFileSync(file, yaml);
  return file;
}

const CONFIG = `
project: demo-shop
environment: uat
apiSources:
  shop:
    baseUrl: https://shop.example.test
    auth: { type: jwt-login, loginPath: /auth/login, usernameEnv: SHOP_USER, passwordEnv: SHOP_PASSWORD }
web:
  baseUrl: { env: SHOP_WEB_URL, default: https://shop.example.test }
  allowedHosts: [shop.example.test]
  authMode: form
  apiSource: shop
safety:
  allowWritesEnv: SHOP_ALLOW_WRITES
  budget: { maxActionsPerSession: 50 }
mcp: { uiServerName: shop-ui }
`;

describe('parseUiMcpArgs', () => {
  it('reads --config and --env in both forms', () => {
    assert.deepEqual(parseUiMcpArgs(['--config', 'a.yaml', '--env=uat']), { configPath: 'a.yaml', environment: 'uat' });
    assert.deepEqual(parseUiMcpArgs([]), {});
  });

  it('rejects a missing value or an unknown flag', () => {
    assert.throws(() => parseUiMcpArgs(['--config']), /needs a value/);
    assert.throws(() => parseUiMcpArgs(['--headed']), /Unknown argument/);
  });
});

describe('config-driven setup', () => {
  it('turns the config into server defaults', () => {
    const loaded = loadProjectConfig({ configPath: writeConfig(CONFIG), env: { SHOP_ALLOW_WRITES: '1' } });
    const { defaults, overrides } = setupDefaultsFromConfig(loaded, undefined, { QAKIT_UI_MCP_IDLE_MS: '5000' });
    assert.equal(defaults.serverName, 'shop-ui-mcp');
    assert.equal(defaults.environment, 'uat');
    assert.equal(defaults.allowWrites, true);
    assert.equal(defaults.allowDestructive, true);
    assert.equal(defaults.maxActionsPerSession, 50);
    assert.equal(defaults.idleTimeoutMs, 5000);
    assert.equal(defaults.auditRoot, path.join(loaded.rootDir, 'evidence'));
    assert.ok(defaults.checkRefPattern?.test('TC-ORD-U01 / A2'));
    assert.deepEqual(overrides, {});
  });

  it('lets a pattern in the config beat the project setup', () => {
    const loaded = loadProjectConfig({
      configPath: writeConfig(`${CONFIG.replace('safety:', "safety:\n  destructiveLabels: { pattern: 'archive' }")}`),
      env: {},
    });
    const setup = createDefaultUiMcpSetup(loaded, undefined, { logger });
    const { defaults, overrides } = setupDefaultsFromConfig(loaded, undefined, {});
    const resolved = resolveUiMcpSetup({ ...setup, destructiveLabel: /delete/ }, defaults, overrides);
    assert.equal(resolved.destructiveLabel.source, 'archive');
    assert.equal(resolved.destructiveLabel.flags, 'i');
  });

  it('offers only the auth modes the adapter can back', () => {
    const loaded = loadProjectConfig({ configPath: writeConfig(CONFIG), env: {} });
    const warnings: string[] = [];
    const bare = createDefaultUiMcpSetup(loaded, undefined, { logger: { ...logger, warn: (m: string) => warnings.push(m) } });
    assert.deepEqual(bare.authModes, ['none']);
    assert.equal(bare.defaultAuthMode, 'none');
    assert.match(warnings.join('\n'), /authMode "form"/);

    const withForm = createDefaultUiMcpSetup(loaded, { name: 'demo-shop', browser: { loginViaForm: async () => undefined } }, { logger });
    assert.deepEqual(withForm.authModes, ['form', 'none']);
    assert.equal(withForm.defaultAuthMode, 'form');
    assert.equal(withForm.web.baseUrl, 'https://shop.example.test');
  });

  it('collects credential values as secrets', () => {
    const loaded = loadProjectConfig({ configPath: writeConfig(CONFIG), env: {} });
    assert.deepEqual(secretValuesFromConfig(loaded, { SHOP_USER: 'qa', SHOP_PASSWORD: 'hunter2' }), ['hunter2']);
  });

  it('falls back to English when no locale pack is installed', async () => {
    const loaded = loadProjectConfig({ configPath: writeConfig(`${CONFIG}\nlocale: xx\n`), env: {} });
    assert.equal(await loadLocalePack(loaded), undefined);
    const resolved = resolveUiMcpSetup(createDefaultUiMcpSetup(loaded, undefined, { logger }));
    assert.equal(resolved.text, englishUiMcpText);
  });
});
