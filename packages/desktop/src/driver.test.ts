import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EvidenceStore } from '@qakit/core';
import { DesktopDriver } from './driver.js';
import { FakeBrowser, FakeElement } from './fake-session.test-support.js';

function setup(dom: Record<string, FakeElement[]> = {}, redact: string[] = []) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-desktop-'));
  const evidence = new EvidenceStore({ scenario: 's', runId: 'r1', webBaseUrl: 'electron://app', rootDir, runDir: path.join(rootDir, 'run'), idPrefix: 'E-DT' });
  const browser = new FakeBrowser(dom);
  const driver = new DesktopDriver({ browser, evidence, defaultTimeoutMs: 50, redact });
  return { browser, driver, evidence };
}

describe('DesktopDriver', () => {
  it('records one report step per action, naming the strategy that resolved the target', async () => {
    const input = new FakeElement({ tag: 'input' });
    const { driver } = setup({ '#server-url': [input] });
    await driver.fill('id=server-url', 'https://agents.example.test');
    assert.deepEqual(input.actions, ['clearValue', 'setValue:https://agents.example.test']);
    const [step] = driver.recordedSteps();
    assert.equal(step?.title, 'Type "https://agents.example.test" into #server-url');
    assert.equal(step?.ok, true);
    assert.equal(step?.data.locator?.resolvedBy, 'domId');
    assert.equal(step?.data.url, 'file:///app/index.html');
  });

  it('returns read values and records them', async () => {
    const { driver } = setup({ '[data-testid="status"]': [new FakeElement({ text: '  Connected ' })] });
    assert.equal(await driver.readText('testid=status'), 'Connected');
    assert.equal(driver.recordedSteps()[0]?.data.value, 'Connected');
  });

  it('records a failed step with the error and a window screenshot, then rethrows', async () => {
    const { driver, evidence } = setup();
    await assert.rejects(driver.click('id=missing'), /matched nothing/);
    const [step] = driver.recordedSteps();
    assert.equal(step?.ok, false);
    assert.match(String(step?.data.error), /#missing matched nothing/);
    assert.equal(step?.data.evidence?.length, 1);
    assert.equal(evidence.list()[0]?.kind, 'screenshot');
    assert.equal(evidence.list()[0]?.id, 'E-DT-01');
  });

  it('keeps secrets out of step titles and values', async () => {
    const { driver } = setup({ '#api-key': [new FakeElement({ tag: 'input', value: 'QA_AUTOTEST-secret' })] }, ['QA_AUTOTEST-secret']);
    await driver.fill('id=api-key', 'QA_AUTOTEST-secret');
    await driver.readValue('id=api-key');
    const text = JSON.stringify(driver.recordedSteps());
    assert.ok(!text.includes('QA_AUTOTEST-secret'), text);
    assert.match(text, /Type \\"\*\*\*\\" into #api-key/);
  });

  it('reports an absent control as not visible and not disabled', async () => {
    const { driver } = setup({ '#cancel': [new FakeElement({ enabled: false, text: 'Cancel' })] });
    assert.deepEqual(await driver.readControlState('id=pause'), { visible: false, disabled: false, text: '' });
    assert.deepEqual(await driver.readControlState('id=cancel'), { visible: true, disabled: true, text: 'Cancel' });
  });

  it('runs code in the main process with arguments', async () => {
    const { driver, browser } = setup();
    assert.equal(await driver.executeMain((electron: { app: { getName(): string } }, suffix: string) => electron.app.getName() + suffix, '!'), 'fake-app!');
    assert.equal(browser.mainCalls[0]?.[1], '!');
  });

  it('switches to the window whose title matches', async () => {
    const { driver, browser } = setup();
    browser.windows.push({ handle: 'w2', title: 'Diagnostics', url: 'file:///app/diag.html' });
    await driver.switchWindow(/diag/i);
    assert.equal(await browser.getTitle(), 'Diagnostics');
  });

  it('captures a screenshot as evidence tied to a check', async () => {
    const { driver, evidence } = setup();
    const relPath = await driver.screenshot('Overview after enrollment', { checkTestId: 'TC-WRK-U01 / A1' });
    assert.equal(relPath, 'run/screenshots/desktop-01.png');
    assert.equal(evidence.list()[0]?.checkTestId, 'TC-WRK-U01 / A1');
  });
});
