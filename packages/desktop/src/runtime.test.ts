import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EvidenceStore, loadProjectConfig } from '@qakit/core';
import { FakeBrowser } from './fake-session.test-support.js';
import { openProjectDesktop } from './project-desktop.js';
import { applyLaunchEnv, createDesktopRuntime, electronCapability, quietWebdriverLogs, type DesktopLauncher } from './runtime.js';
import { describeDesktopTarget, projectDesktopTarget } from './target.js';
import type { DesktopTarget } from './types.js';

const target: DesktopTarget = {
  framework: 'electron',
  appEntryPoint: '/app/out/main/index.js',
  appRoot: '/app',
  appArgs: ['--qa'],
  env: { APP_MODE: 'qa' },
  timeoutMs: 1000,
  captureLogs: true,
};

function tempProject(yaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-desktop-config-'));
  fs.writeFileSync(path.join(dir, 'qakit.config.yaml'), yaml);
  return path.join(dir, 'qakit.config.yaml');
}

describe('projectDesktopTarget', () => {
  it('resolves paths against the config file and reads env values', () => {
    const configPath = tempProject(
      ['project: demo', 'desktop:', '  appEntryPoint: { env: APP_ENTRY, default: ../app/out/main/index.js }', '  appRoot: ../app', '  env:', '    APP_MODE: qa', '    APP_TOKEN: { env: APP_TOKEN }'].join('\n'),
    );
    const loaded = loadProjectConfig({ configPath, env: {} });
    const resolved = projectDesktopTarget(loaded);
    const root = path.dirname(configPath);
    assert.equal(resolved.appEntryPoint, path.resolve(root, '../app/out/main/index.js'));
    assert.equal(resolved.appRoot, path.resolve(root, '../app'));
    assert.equal(resolved.appBinaryPath, undefined);
    assert.deepEqual(resolved.env, { APP_MODE: 'qa' }, 'a value that resolves to nothing is not set');
    assert.equal(resolved.timeoutMs, 30_000);
    assert.match(describeDesktopTarget(resolved), /^electron entry /);
  });

  it('refuses a project without a desktop block', () => {
    const loaded = loadProjectConfig({ configPath: tempProject('project: demo\n'), env: {} });
    assert.throws(() => projectDesktopTarget(loaded), /no `desktop` block/);
  });
});

describe('electronCapability', () => {
  it('passes the entry point, arguments and log capture to the Electron service', () => {
    assert.deepEqual(electronCapability(target, { logDir: '/logs' }), {
      browserName: 'electron',
      'wdio:electronServiceOptions': { appEntryPoint: '/app/out/main/index.js', appArgs: ['--qa'], captureMainProcessLogs: true, captureRendererLogs: true, logDir: '/logs' },
    });
  });

  it('prefers a packaged binary over an entry point', () => {
    const options = electronCapability({ ...target, appBinaryPath: '/app/dist/App.exe', captureLogs: false })['wdio:electronServiceOptions'];
    assert.deepEqual(options, { appBinaryPath: '/app/dist/App.exe', appArgs: ['--qa'] });
  });

  it('hands a configured chromedriver to WebdriverIO instead of downloading one', () => {
    assert.deepEqual(electronCapability({ ...target, chromedriverPath: '/drivers/chromedriver.exe' })['wdio:chromedriverOptions'], { binary: '/drivers/chromedriver.exe' });
    assert.equal(electronCapability(target)['wdio:chromedriverOptions'], undefined);
  });
});

describe('applyLaunchEnv', () => {
  it('clears ELECTRON_RUN_AS_NODE and sets the app env for the launch only', () => {
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1', APP_MODE: 'dev', KEEP: 'yes' };
    const restore = applyLaunchEnv({ APP_MODE: 'qa', NEW_VAR: 'x' }, env);
    assert.deepEqual(env, { APP_MODE: 'qa', KEEP: 'yes', NEW_VAR: 'x' });
    restore();
    assert.deepEqual(env, { ELECTRON_RUN_AS_NODE: '1', APP_MODE: 'dev', KEEP: 'yes' });
  });
});

describe('quietWebdriverLogs', () => {
  it('defaults WebdriverIO to warnings and leaves a level the user set alone', () => {
    const unset: NodeJS.ProcessEnv = {};
    quietWebdriverLogs(unset);
    assert.equal(unset.WDIO_LOG_LEVEL, 'warn');
    const chosen: NodeJS.ProcessEnv = { WDIO_LOG_LEVEL: 'debug' };
    quietWebdriverLogs(chosen);
    assert.equal(chosen.WDIO_LOG_LEVEL, 'debug');
  });
});

describe('createDesktopRuntime', () => {
  function runtimeWith(launch: DesktopLauncher) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-desktop-rt-'));
    const evidence = new EvidenceStore({ scenario: 's', runId: 'r1', webBaseUrl: 'electron://app', rootDir, runDir: path.join(rootDir, 'run'), idPrefix: 'E-DT' });
    const warnings: string[] = [];
    const runtime = createDesktopRuntime({ target, evidence, logger: { warn: (m: string) => warnings.push(m) }, launch });
    return { runtime, evidence, warnings };
  }

  it('launches once, lazily, and on a failed run keeps the final window, the app logs and a manifest', async () => {
    let launches = 0;
    let closed = false;
    const { runtime, evidence } = runtimeWith(async (_target, { logDir }) => {
      launches += 1;
      fs.writeFileSync(path.join(logDir!, 'electron-main.log'), 'main started\n');
      return { browser: new FakeBrowser(), version: '38.1.0', close: async () => void (closed = true) };
    });
    assert.equal(launches, 0);
    const [a, b] = await Promise.all([runtime.app(), runtime.app()]);
    assert.equal(a, b);
    assert.equal(launches, 1);

    await runtime.close(false);
    assert.ok(closed);
    assert.deepEqual(evidence.list().map((item) => item.kind), ['screenshot', 'console_log']);
    const manifest = JSON.parse(fs.readFileSync(evidence.manifestPath, 'utf8'));
    assert.deepEqual(manifest.browser, { name: 'electron', version: '38.1.0' });
  });

  it('skips the final screenshot on a passing run and never throws on teardown', async () => {
    const { runtime, evidence, warnings } = runtimeWith(async () => ({
      browser: new FakeBrowser(),
      close: async () => {
        throw new Error('session already gone');
      },
    }));
    await runtime.app();
    await runtime.close(true);
    assert.deepEqual(evidence.list().map((item) => item.kind), []);
    assert.match(warnings.join('\n'), /did not close cleanly.*session already gone/);
  });

  it('names the target when the app cannot start', async () => {
    const { runtime } = runtimeWith(async () => {
      throw new Error('chromedriver exited');
    });
    await assert.rejects(runtime.app(), /Could not start the desktop app \(electron entry \/app\/out\/main\/index\.js.*chromedriver exited/);
    await runtime.close(false);
  });
});

describe('openProjectDesktop', () => {
  it('gives desktop evidence its own id prefix and the app as the manifest origin', async () => {
    const configPath = tempProject(['project: demo', 'desktop:', '  appBinaryPath: dist/App.exe', '  captureLogs: false'].join('\n'));
    const loaded = loadProjectConfig({ configPath, env: {} });
    const { runtime, evidence } = openProjectDesktop({
      loaded,
      logger: { warn: () => {} },
      scenario: 'helper-overview',
      runId: 'r1',
      runDir: path.join(loaded.rootDir, 'evidence', 'r1', 'desktop'),
      launch: async () => ({ browser: new FakeBrowser(), close: async () => {} }),
    });
    const app = await runtime.app();
    await app.screenshot('overview');
    assert.equal(evidence.list()[0]?.id, 'E-DT-01');
    await runtime.close(true);
    assert.match(JSON.parse(fs.readFileSync(evidence.manifestPath, 'utf8')).webBaseUrl, /^electron:\/\/.*dist\/App\.exe$/);
  });
});
