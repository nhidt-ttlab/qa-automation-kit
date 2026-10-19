import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebTarget } from '@qakit/ui';
import { UiPolicy, type UiPolicyConfig } from './policy.js';

const WEB: WebTarget = {
  baseUrl: 'https://app.example.test',
  loginPath: '/login',
  allowedHosts: ['app.example.test', 'api.example.test'],
};

const policy = (overrides: Partial<UiPolicyConfig> = {}): UiPolicy => new UiPolicy({ web: WEB, ...overrides });

test('navigation is confined to the allowlist', () => {
  const p = policy();
  assert.equal(p.checkNavigation('https://app.example.test/orders').allowed, true);
  assert.equal(p.checkNavigation('/orders/42').allowed, true, 'relative paths resolve against baseUrl');
  assert.equal(p.checkNavigation('https://api.example.test/v1/x').allowed, true);
});

test('navigation denial names the host and the allowlist', () => {
  const decision = policy().checkNavigation('https://evil.com/');
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? '', /evil\.com/);
  assert.match(decision.reason ?? '', /allowedHosts/);
});

test('allowlist matching is on a dot boundary, not a bare suffix', () => {
  const p = policy();
  assert.equal(p.checkNavigation('https://sub.app.example.test/').allowed, true);
  assert.equal(p.checkNavigation('https://notapp.example.test/').allowed, false);
  assert.equal(p.checkNavigation('https://app.example.test.evil.com/').allowed, false);
});

test('unparseable urls are denied rather than defaulting open', () => {
  assert.equal(policy().checkNavigation('http://[bad').allowed, false);
});

test('destructive-looking controls are denied by default', () => {
  const p = policy();
  for (const label of ['Delete row', 'Approve', 'btn-remove-item', 'Cancel order', 'Submit for review']) {
    assert.equal(p.checkDestructive(label).allowed, false, `${label} must be denied`);
  }
  for (const label of ['input-search-orders', 'Search', 'btn-refresh', 'Export Excel']) {
    assert.equal(p.checkDestructive(label).allowed, true, `${label} must be allowed`);
  }
});

test('a project or locale pattern replaces the English default', () => {
  const p = policy({ destructiveLabel: /archive/i });
  assert.equal(p.checkDestructive('Archive order').allowed, false);
  assert.equal(p.checkDestructive('Delete row').allowed, true);
});

test('destructive actions need BOTH allowWrites and allowDestructive', () => {
  assert.equal(policy({ allowDestructive: true }).checkDestructive('Delete').allowed, false, 'allowDestructive alone is not enough');
  assert.equal(policy({ allowWrites: true }).checkDestructive('Delete').allowed, false, 'allowWrites alone is not enough');
  assert.equal(policy({ allowWrites: true, allowDestructive: true }).checkDestructive('Delete').allowed, true);
});

test('denial wording comes from the text', () => {
  const p = policy({ text: { ...new UiPolicyTextStub(), destructive: (d) => `nope: ${d}` } });
  assert.equal(p.checkDestructive('Delete').reason, 'nope: Delete');
});

test('a configured secret can never be typed into the page', () => {
  const p = policy({ secretValues: ['hunter2'] });
  assert.equal(p.checkValue('hunter2').allowed, false);
  assert.equal(p.checkValue('prefix-hunter2-suffix').allowed, false, 'substring matches too');
  assert.equal(p.checkValue('something else').allowed, true);
  assert.equal(p.checkValue(undefined).allowed, true);
  assert.equal(policy({ secretValues: [''] }).checkValue('anything').allowed, true, 'an empty secret denies nothing');
});

test('the action budget stops a runaway loop, and opening a session starts a fresh window', () => {
  const p = policy({ maxActionsPerSession: 2 });
  p.recordAction();
  p.recordAction();
  const decision = p.checkBudget();
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? '', /2 actions/);
  p.startSession();
  assert.equal(p.checkBudget().allowed, true);
  assert.equal(p.actionsUsed, 0);
});

test('an elapsed time window is recoverable by opening a session', async () => {
  const p = policy({ maxSessionMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(p.checkBudget().allowed, false, 'precondition: the time window has elapsed');
  p.startSession();
  assert.equal(p.checkBudget().allowed, true, 'the clock restarts with the session');
});

test('a disabled tool is reported as unavailable', () => {
  const p = policy({ enabledTools: ['ui_open_screen', 'ui_read_grid'] });
  assert.equal(p.isToolEnabled('ui_read_grid'), true);
  assert.equal(p.isToolEnabled('ui_act'), false);
  assert.equal(policy().isToolEnabled('ui_act'), true, 'omitting the list means everything');
});

class UiPolicyTextStub {
  unparseableUrl = (url: string) => url;
  hostNotAllowed = (host: string) => host;
  destructive = (descriptor: string) => descriptor;
  secretValue = 'secret';
  actionBudget = (max: number) => String(max);
  timeBudget = (minutes: number) => String(minutes);
}
