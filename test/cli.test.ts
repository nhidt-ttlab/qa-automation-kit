import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadProjectConfig } from '../packages/core/src/index.js';
import { envPrefixOf, initProject } from '../packages/cli/src/init.js';
import { runDoctor } from '../packages/cli/src/doctor.js';
import { runQakitCli } from '../packages/cli/src/cli.js';

describe('qakit init', () => {
  it('scaffolds a project whose config validates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qakit-init-'));
    const result = initProject({ targetDir: dir, project: 'demo-shop', locale: 'vi' });

    assert.ok(result.written.length > 10);
    for (const file of ['qakit.config.yaml', '.gitignore', '.env.example', 'package.json', 'src/adapter/index.ts', 'mcp.json.snippet', '.qakit/knowledge/project.md']) {
      assert.ok(existsSync(join(dir, file)), `${file} written`);
    }
    const config = readFileSync(join(dir, 'qakit.config.yaml'), 'utf8');
    assert.ok(!/\{\{\w+\}\}/.test(config), 'every token is substituted');
    assert.match(config, /usernameEnv: DEMO_SHOP_USERNAME/);
    assert.match(readFileSync(join(dir, 'package.json'), 'utf8'), /"@qakit\/core": "file:.*packages\/core"/);

    const loaded = loadProjectConfig({ configPath: join(dir, 'qakit.config.yaml'), env: {} });
    assert.equal(loaded.config.project, 'demo-shop');
    assert.equal(loaded.config.locale, 'vi');
    assert.equal(loaded.config.mcp.uiServerName, 'demo-shop-ui');

    const again = initProject({ targetDir: dir, project: 'demo-shop' });
    assert.equal(again.written.length, 0, 'existing files are kept');
    assert.ok(again.skipped.length > 0);
  });

  it('rejects an invalid project id', () => {
    assert.throws(() => initProject({ targetDir: mkdtempSync(join(tmpdir(), 'qakit-init-')), project: 'Demo Shop' }), /kebab-case/);
    assert.equal(envPrefixOf('demo-shop'), 'DEMO_SHOP');
  });
});

describe('qakit doctor', () => {
  it('reports config problems and offline checks for a fresh project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qakit-doctor-'));
    initProject({ targetDir: dir, project: 'demo-shop' });
    const checks = await runDoctor({ configPath: join(dir, 'qakit.config.yaml'), offline: true, env: {} });
    const byName = new Map(checks.map((c) => [c.name, c]));
    assert.equal(byName.get('config')?.status, 'ok');
    assert.equal(byName.get('api source app credentials')?.status, 'warn', 'no credentials in a fresh project');
    assert.equal(byName.get('api source app spec')?.status, 'skip');
    assert.equal(byName.get('api domains')?.status, 'ok');
    assert.equal(byName.get('env file')?.status, 'warn');
    // Nothing is installed in a bare scaffold, so the adapter cannot import the kit yet — say how to fix it.
    assert.equal(byName.get('adapter')?.status, 'fail');
    assert.match(byName.get('adapter')?.detail ?? '', /run `npm install`/);
    const otherFailures = checks.filter((c) => c.status === 'fail' && c.name !== 'adapter');
    assert.deepEqual(otherFailures, []);
  });

  it('fails on a broken config without throwing', async () => {
    const checks = await runDoctor({ configPath: join(tmpdir(), 'no-such-dir', 'qakit.config.yaml'), offline: true, env: {} });
    assert.deepEqual(checks.map((c) => [c.name, c.status]), [['config', 'fail']]);
  });
});

describe('qakit command', () => {
  it('prints help and rejects unknown commands', async () => {
    const log = console.log;
    const error = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      assert.equal(await runQakitCli(['help']), 0);
      assert.equal(await runQakitCli(['nope']), 1);
    } finally {
      console.log = log;
      console.error = error;
    }
  });
});
