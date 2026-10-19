import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { LocatorResolutionError, parseLocatorSpec } from '@qakit/ui';
import { FakeBrowser, FakeElement } from './fake-session.test-support.js';
import { candidateFor, countDesktopMatches, resolveDesktopLocator, xpathLiteral } from './locator.js';

/** Step-doc targets mean the same thing on a desktop window as in the browser lane. */
describe('candidateFor', () => {
  it('maps each strategy to a WebdriverIO selector', () => {
    assert.equal(candidateFor({ domId: 'form=save' }, 'domId')?.selector, '#form\\=save');
    assert.equal(candidateFor({ testId: 'save-btn' }, 'testId')?.selector, '[data-testid="save-btn"]');
    assert.equal(candidateFor({ role: 'button', name: 'Save' }, 'role')?.selector, 'aria/Save');
    assert.equal(candidateFor({ label: 'Server URL' }, 'label')?.selector, 'aria/Server URL');
    assert.equal(candidateFor({ placeholder: 'https://' }, 'placeholder')?.selector, '[placeholder="https://"]');
    assert.equal(candidateFor({ text: 'Connected' }, 'text')?.selector, './/*[text()[normalize-space(.)="Connected"]]');
    assert.equal(candidateFor({ css: '.tray > li' }, 'css')?.selector, '.tray > li');
    assert.equal(candidateFor({ text: 'x' }, 'domId'), undefined);
  });

  it('matches a bare role by the attribute and the implicit elements that carry it', () => {
    const selector = candidateFor({ role: 'button' }, 'role')!.selector;
    assert.ok(selector.startsWith('[role="button"], button:not([role])'));
    assert.ok(selector.includes('input[type="submit"]:not([role])'));
  });

  it('quotes XPath text holding either or both quote kinds', () => {
    assert.equal(xpathLiteral('plain'), '"plain"');
    assert.equal(xpathLiteral('say "hi"'), `'say "hi"'`);
    assert.equal(xpathLiteral(`it's "x"`), `concat("it's ", '"', "x", '"', "")`);
  });
});

describe('resolveDesktopLocator', () => {
  it('takes the first strategy that matches and reports which one', async () => {
    const button = new FakeElement({ tag: 'button' });
    const browser = new FakeBrowser({ '[data-testid="save"]': [button] });
    const { element, resolved } = await resolveDesktopLocator(browser, { domId: 'save', testId: 'save' }, 0);
    assert.equal(element, button);
    assert.deepEqual(resolved, { strategy: 'testId', matched: 1, description: '#save | testid=save' });
  });

  it('keeps only elements whose computed role is the one asked for', async () => {
    const heading = new FakeElement({ role: 'heading' });
    const button = new FakeElement({ role: 'button' });
    const browser = new FakeBrowser({ 'aria/Save': [heading, button] });
    const { element } = await resolveDesktopLocator(browser, parseLocatorSpec('role=button[name="Save"]'), 0);
    assert.equal(element, button);
  });

  it('never lets a <label> win a label= target', async () => {
    const label = new FakeElement({ tag: 'label' });
    const input = new FakeElement({ tag: 'input' });
    const browser = new FakeBrowser({ 'aria/Server URL': [label, input] });
    assert.equal((await resolveDesktopLocator(browser, { label: 'Server URL' }, 0)).element, input);
  });

  it('refuses a multi-match unless nth is given', async () => {
    const browser = new FakeBrowser({ '.row': [new FakeElement(), new FakeElement({ text: 'second' })] });
    await assert.rejects(resolveDesktopLocator(browser, { css: '.row' }, 0), (error: unknown) => error instanceof LocatorResolutionError && /matched 2 elements/.test(error.message));
    assert.equal(await (await resolveDesktopLocator(browser, { css: '.row', nth: 1 }, 0)).element.getText(), 'second');
  });

  it('searches inside the within scope', async () => {
    const inner = new FakeElement({ tag: 'button' });
    const dialog = new FakeElement({ children: { '#ok': [inner] } });
    const browser = new FakeBrowser({ '[role="dialog"], dialog:not([role])': [dialog], '#ok': [new FakeElement(), new FakeElement()] });
    assert.equal((await resolveDesktopLocator(browser, parseLocatorSpec('role=dialog >> id=ok'), 0)).element, inner);
  });

  it('polls until the element appears, then times out naming what it tried', async () => {
    const browser = new FakeBrowser();
    setTimeout(() => (browser.dom['#late'] = [new FakeElement()]), 30);
    assert.ok((await resolveDesktopLocator(browser, { domId: 'late' }, 1000, 10)).element);
    await assert.rejects(resolveDesktopLocator(browser, { domId: 'never' }, 20, 5), /matched nothing within 20ms \(domId: 0 matches\)/);
  });
});

describe('countDesktopMatches', () => {
  it('answers zero without waiting or failing', async () => {
    const browser = new FakeBrowser({ '.badge': [new FakeElement(), new FakeElement()] });
    assert.equal(await countDesktopMatches(browser, { css: '.badge' }), 2);
    assert.equal(await countDesktopMatches(browser, { css: '.missing' }), 0);
    assert.equal(await countDesktopMatches(browser, parseLocatorSpec('id=absent >> css=.badge')), 0);
  });
});
