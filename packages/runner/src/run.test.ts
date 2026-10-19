import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createLogger, loadProjectConfig } from '@qakit/core';
import { runScenario } from './run.js';
import { defineUiScenario } from './scenario.js';

describe('runScenario — UI scenarios without a web block', () => {
  it('runs a desktop-only project, and reading ctx.web is what fails, not the run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-runner-desktop-'));
    fs.writeFileSync(path.join(dir, 'qakit.config.yaml'), ['project: desktop-only', 'desktop:', '  appBinaryPath: dist/App.exe'].join('\n'));
    const loaded = loadProjectConfig({ configPath: path.join(dir, 'qakit.config.yaml'), env: {} });

    let webError: unknown;
    const scenario = defineUiScenario({
      name: 'desktop-only-probe',
      testCaseId: 'TC-APP-U01',
      title: 'Desktop-only project',
      objective: 'A UI scenario runs without a web block.',
      async run(ctx) {
        try {
          void ctx.web.baseUrl;
        } catch (error) {
          webError = error;
        }
        ctx.check('A1', 'context built', true, typeof ctx.desktop === 'function');
      },
    });

    const outcome = await runScenario(scenario, { loaded, logger: createLogger('error'), env: {} });
    assert.equal(outcome.verdict, 'PASS', outcome.error);
    assert.match(String(webError), /has no `web` block/);
  });
});
