import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __testing } from './guards.js';

const { isAllowedHost, isDeclaredPostLookup, SAFE_METHODS, AUTH_PATHS, authPathsOf, carriesCredentials, isSettledRouteError, settleRoute } = __testing;
const ALLOWED = ['app.example.test', 'api.example.test'];

test('allowlist accepts exact hosts and subdomains only', () => {
  assert.equal(isAllowedHost('https://app.example.test/login', ALLOWED), true);
  assert.equal(isAllowedHost('https://api.example.test/api/app/x', ALLOWED), true);
  assert.equal(isAllowedHost('https://a.app.example.test/', ALLOWED), true);
});

test('allowlist rejects lookalike hosts a redirect could walk to', () => {
  assert.equal(isAllowedHost('https://evil.com/', ALLOWED), false);
  // Suffix match must be on a dot boundary, not a bare string suffix.
  assert.equal(isAllowedHost('https://notapp.example.test/', ALLOWED), false);
  assert.equal(isAllowedHost('https://app.example.test.evil.com/', ALLOWED), false);
});

test('allowlist rejects unparseable urls rather than defaulting open', () => {
  assert.equal(isAllowedHost('not-a-url', ALLOWED), false);
  assert.equal(isAllowedHost('', ALLOWED), false);
});

test('read-only mode treats only GET/HEAD/OPTIONS as safe', () => {
  assert.equal(SAFE_METHODS.has('GET'), true);
  assert.equal(SAFE_METHODS.has('HEAD'), true);
  assert.equal(SAFE_METHODS.has('OPTIONS'), true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(SAFE_METHODS.has(method), false, `${method} must not be treated as safe`);
  }
});

test('declared POST lookups pass only as POST, only on a path match', () => {
  const lookups = ['/api/Phase/list'];
  assert.equal(isDeclaredPostLookup('POST', 'https://files.example.test/api/Phase/list?projectId=x', lookups), true);
  // Same route, other verbs stay blocked.
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal(isDeclaredPostLookup(method, 'https://files.example.test/api/Phase/list', lookups), false);
  }
  // A sibling write on the same controller is not opened by the lookup.
  assert.equal(isDeclaredPostLookup('POST', 'https://files.example.test/api/Phase/download-all', lookups), false);
  // The query string is not the path: a write cannot smuggle the lookup name in a parameter.
  assert.equal(isDeclaredPostLookup('POST', 'https://x.example.test/api/app/purchase-order?next=/api/Phase/list', lookups), false);
});

test('no declared lookups, or an empty entry, opens nothing', () => {
  assert.equal(isDeclaredPostLookup('POST', 'https://files.example.test/api/Phase/list', []), false);
  assert.equal(isDeclaredPostLookup('POST', 'https://files.example.test/api/app/purchase-order', ['']), false);
  assert.equal(isDeclaredPostLookup('POST', 'not-a-url', ['/api/Phase/list']), false);
});

test('a route settled by a navigation race is tolerated, not fatal', () => {
  assert.equal(isSettledRouteError(new Error('route.continue: Route is already handled!')), true);
  assert.equal(isSettledRouteError(new Error('route.abort: Target page, context or browser has been closed')), true);
  // Playwright is not the only thing that can throw here; a bare string must not crash the check.
  assert.equal(isSettledRouteError('Target closed'), true);
});

test('a real routing failure is never mistaken for a settled route', () => {
  assert.equal(isSettledRouteError(new Error('route.continue: Protocol error (Fetch.continueRequest)')), false);
  assert.equal(isSettledRouteError(new Error('boom')), false);
  assert.equal(isSettledRouteError(undefined), false);
});

test('settleRoute swallows only the settled-route races and rethrows everything else', async () => {
  await settleRoute(() => Promise.reject(new Error('route.continue: Route is already handled!')));

  await assert.rejects(
    () => settleRoute(() => Promise.reject(new Error('Protocol error (Fetch.continueRequest)'))),
    /Protocol error/,
    'a genuine routing bug must still fail the run',
  );

  let ran = false;
  await settleRoute(async () => {
    ran = true;
  });
  assert.equal(ran, true, 'the action still runs on the happy path');
});

test('the token endpoint stays reachable in read-only mode', () => {
  const matches = (url: string): boolean => AUTH_PATHS.some((p) => p.test(url));
  assert.equal(matches('https://api.example.test/connect/token'), true);
  // A business write must not sneak through by merely containing the word "token".
  assert.equal(matches('https://api.example.test/api/app/purchase-order/token-thing'), false);
});

test('a project names its own identity provider endpoints, replacing the defaults', () => {
  const web = { baseUrl: 'https://app.example.test', loginPath: '/login', allowedHosts: ALLOWED };
  const matches = (target: typeof web & { authPaths?: string[] }, url: string): boolean => authPathsOf(target).some((p) => p.test(url));

  assert.equal(matches(web, 'https://api.example.test/connect/token'), true, 'unset keeps the defaults');
  const realm = { ...web, authPaths: ['/protocol/openid-connect/token$', '/protocol/openid-connect/auth'] };
  assert.equal(matches(realm, 'https://sso.example.test/realms/shop/protocol/openid-connect/token'), true);
  assert.equal(matches(realm, 'https://api.example.test/connect/token'), false);
  assert.equal(matches({ ...web, authPaths: [] }, 'https://api.example.test/connect/token'), false, 'an empty list opens nothing');
});

test('a body that holds credentials is never read into the registry', () => {
  const web = { baseUrl: 'https://app.example.test', loginPath: '/Account/Login', allowedHosts: ALLOWED };
  assert.equal(carriesCredentials('https://sso.example.test/connect/token', web), true);
  // The sign-in form posts back to its own page, with the return URL in the query.
  assert.equal(carriesCredentials('https://sso.example.test/Account/Login?ReturnUrl=%2Fconnect%2Fauthorize', web), true);
  assert.equal(carriesCredentials('https://sso.example.test/account/login/', web), true);
  // A business write keeps its body: it is what a payload assertion reads.
  assert.equal(carriesCredentials('https://api.example.test/api/app/purchase-order', web), false);
  assert.equal(carriesCredentials('https://api.example.test/api/app/Account/Login/history', web), false);
  assert.equal(carriesCredentials('not-a-url', web), false);
});
