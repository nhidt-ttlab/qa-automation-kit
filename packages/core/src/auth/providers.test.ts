import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { AuthConfig } from '../config/schema.js';
import { AuthError, createAuthProviders, type AuthSource, type AuthTransport, type AuthTransportRequest } from './providers.js';
import { TokenStore } from './token-store.js';
import { fakeIdp, type FakeIdp } from '../../../../test/support/fake-idp.js';

const BASE = 'https://api.example.test';

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`;
}

/** A fake login endpoint: records every request and answers from a queue of responses. */
function fakeTransport(...responses: Array<{ status?: number; body: unknown; setCookies?: string[] }>) {
  const requests: AuthTransportRequest[] = [];
  const transport: AuthTransport = async (request) => {
    requests.push(request);
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    return {
      status: next.status ?? 200,
      body: typeof next.body === 'string' ? next.body : JSON.stringify(next.body),
      setCookies: next.setCookies ?? [],
    };
  };
  return { transport, requests };
}

function source(auth: AuthConfig, baseUrl = BASE): AuthSource {
  return { baseUrl, auth };
}

const OAUTH: AuthConfig = {
  type: 'oauth2-password',
  tokenPath: '/connect/token',
  clientId: 'qa-app',
  scope: 'offline_access api',
  usernameEnv: 'QA_USER',
  passwordEnv: 'QA_PASS',
  staticTokenEnv: 'QA_TOKEN',
};
const CREDS = { QA_USER: 'qa', QA_PASS: 'secret' };

describe('oauth2-password', () => {
  it('logs in with the password grant and caches the token', async () => {
    const { transport, requests } = fakeTransport({ body: { access_token: 'tok-1', expires_in: 3600 } });
    const auth = createAuthProviders({ core: source(OAUTH) }, { env: CREDS, transport }).get('core')!;

    assert.equal(auth.isConfigured(), true);
    assert.deepEqual(await auth.authorize(), { headers: { Authorization: 'Bearer tok-1' }, query: {} });
    assert.equal(await auth.getToken(), 'tok-1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, `${BASE}/connect/token`);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(requests[0]!.body)), {
      grant_type: 'password',
      scope: 'offline_access api',
      client_id: 'qa-app',
      username: 'qa',
      password: 'secret',
    });
  });

  it('dedups concurrent logins', async () => {
    const { transport, requests } = fakeTransport({ body: { access_token: 'tok-1', expires_in: 3600 } });
    const auth = createAuthProviders({ core: source(OAUTH) }, { env: CREDS, transport }).get('core')!;
    const tokens = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
    assert.deepEqual(tokens, ['tok-1', 'tok-1', 'tok-1']);
    assert.equal(requests.length, 1);
  });

  it('refreshes a token inside the expiry buffer, falling back to a password login when refresh fails', async () => {
    const { transport, requests } = fakeTransport(
      { body: { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 1 } },
      { status: 400, body: { error: 'invalid_grant' } },
      { body: { access_token: 'tok-2', expires_in: 3600 } },
    );
    const auth = createAuthProviders({ core: source(OAUTH) }, { env: CREDS, transport }).get('core')!;
    assert.equal(await auth.getToken(), 'tok-1');
    assert.equal(await auth.getToken(), 'tok-2');
    assert.deepEqual(
      requests.map((r) => new URLSearchParams(r.body).get('grant_type')),
      ['password', 'refresh_token', 'password'],
    );
  });

  it('prefers the static token and skips login', async () => {
    const { transport, requests } = fakeTransport({ body: {} });
    const auth = createAuthProviders({ core: source(OAUTH) }, { env: { ...CREDS, QA_TOKEN: 'fixed' }, transport }).get('core')!;
    assert.equal(await auth.getToken(), 'fixed');
    assert.equal(requests.length, 0);
  });

  it('is unconfigured and sends nothing without credentials', async () => {
    const { transport, requests } = fakeTransport({ body: {} });
    const auth = createAuthProviders({ core: source(OAUTH) }, { env: {}, transport }).get('core')!;
    assert.equal(auth.isConfigured(), false);
    assert.deepEqual(await auth.authorize(), { headers: {}, query: {} });
    assert.equal(requests.length, 0);
  });

  it('reports a failed login with its status', async () => {
    const { transport } = fakeTransport({ status: 401, body: 'nope' });
    const auth = createAuthProviders({ core: source(OAUTH) }, { env: CREDS, transport }).get('core')!;
    await assert.rejects(auth.getToken(), (error: unknown) => error instanceof AuthError && /"core" failed: 401 nope/.test(error.message));
  });

  it('shares one login across clients that share a token store', async () => {
    const { transport, requests } = fakeTransport({ body: { access_token: 'tok-1', expires_in: 3600 } });
    const tokenStore = new TokenStore();
    const a = createAuthProviders({ core: source(OAUTH) }, { env: CREDS, transport, tokenStore }).get('core')!;
    const b = createAuthProviders({ core: source(OAUTH) }, { env: CREDS, transport, tokenStore }).get('core')!;
    await a.getToken();
    assert.equal(await b.getToken(), 'tok-1');
    assert.equal(requests.length, 1);
  });
});

describe('jwt-login', () => {
  const JWT_LOGIN: AuthConfig = {
    type: 'jwt-login',
    loginPath: '/auth/login',
    usernameField: 'email',
    passwordField: 'password',
    tokenJsonPath: 'data.accessToken',
    usernameEnv: 'QA_USER',
    passwordEnv: 'QA_PASS',
  };

  it('posts JSON credentials and reads the token at the configured path', async () => {
    const token = jwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 });
    const { transport, requests } = fakeTransport({ body: { data: { accessToken: token } } });
    const auth = createAuthProviders({ shop: source(JWT_LOGIN) }, { env: CREDS, transport }).get('shop')!;
    assert.equal(await auth.getToken(), token);
    assert.equal(await auth.getToken(), token);
    assert.equal(requests.length, 1, 'the exp claim keeps the token cached');
    assert.deepEqual(JSON.parse(requests[0]!.body), { email: 'qa', password: 'secret' });
  });

  it('fails clearly when the token path is missing', async () => {
    const { transport } = fakeTransport({ body: { data: {} } });
    const auth = createAuthProviders({ shop: source(JWT_LOGIN) }, { env: CREDS, transport }).get('shop')!;
    await assert.rejects(auth.getToken(), /no token at "data\.accessToken"/);
  });
});

describe('api-key, static-bearer, cookie-session, none', () => {
  it('puts an api key in a header or in the query', async () => {
    const providers = createAuthProviders(
      {
        header: source({ type: 'api-key', keyEnv: 'KEY', in: 'header', name: 'X-Api-Key' }),
        query: source({ type: 'api-key', keyEnv: 'KEY', in: 'query', name: 'api_key' }),
      },
      { env: { KEY: 'k-1' } },
    );
    assert.deepEqual(await providers.get('header')!.authorize(), { headers: { 'X-Api-Key': 'k-1' }, query: {} });
    assert.deepEqual(await providers.get('query')!.authorize(), { headers: {}, query: { api_key: 'k-1' } });
  });

  it('sends a static bearer token', async () => {
    const auth = createAuthProviders({ a: source({ type: 'static-bearer', tokenEnv: 'TOKEN' }) }, { env: { TOKEN: 't' } }).get('a')!;
    assert.deepEqual(await auth.authorize(), { headers: { Authorization: 'Bearer t' }, query: {} });
  });

  it('turns login cookies into a Cookie header', async () => {
    const { transport } = fakeTransport({ body: '', setCookies: ['sid=abc; Path=/; HttpOnly', 'xsrf=def; Path=/'] });
    const auth = createAuthProviders(
      {
        legacy: source({
          type: 'cookie-session',
          loginPath: '/login',
          usernameField: 'username',
          passwordField: 'password',
          usernameEnv: 'QA_USER',
          passwordEnv: 'QA_PASS',
        }),
      },
      { env: CREDS, transport },
    ).get('legacy')!;
    assert.deepEqual(await auth.authorize(), { headers: { Cookie: 'sid=abc; xsrf=def' }, query: {} });
    assert.equal(await auth.getToken(), undefined);
  });

  it('sends nothing for none', async () => {
    const auth = createAuthProviders({ open: source({ type: 'none' }) }).get('open')!;
    assert.equal(auth.isConfigured(), false);
    assert.deepEqual(await auth.authorize(), { headers: {}, query: {} });
  });
});

describe('reuse', () => {
  it('delegates to the target, lets its own static token win, and tolerates an unknown target', async () => {
    const { transport, requests } = fakeTransport({ body: { access_token: 'tok-1', expires_in: 3600 } });
    const providers = createAuthProviders(
      {
        files: source({ type: 'reuse', from: 'core', staticTokenEnv: 'FILES_TOKEN' }),
        core: source(OAUTH),
        orphan: source({ type: 'reuse', from: 'missing' }),
      },
      { env: CREDS, transport },
    );
    assert.equal(await providers.get('files')!.getToken(), 'tok-1');
    assert.equal(await providers.get('core')!.getToken(), 'tok-1');
    assert.equal(requests.length, 1);
    assert.equal(providers.get('orphan')!.isConfigured(), false);
    assert.equal(await providers.get('orphan')!.getToken(), undefined);

    const overridden = createAuthProviders(
      { files: source({ type: 'reuse', from: 'core', staticTokenEnv: 'FILES_TOKEN' }), core: source(OAUTH) },
      { env: { ...CREDS, FILES_TOKEN: 'own' }, transport },
    );
    assert.equal(await overridden.get('files')!.getToken(), 'own');
  });
});

describe('oidc-code', () => {
  const OIDC: AuthConfig = {
    type: 'oidc-code',
    issuer: { env: 'SSO_URL', default: 'https://sso.example.test' },
    clientId: 'shop-web',
    clientSecretEnv: 'SHOP_CLIENT_SECRET',
    redirectUri: '/signin-oidc',
    scope: 'openid offline_access shop',
    authorizeParams: { organization: 'org-a' },
    usernameEnv: 'QA_USER',
    passwordEnv: 'QA_PASS',
    staticTokenEnv: 'QA_TOKEN',
  };
  const SHOP = 'https://shop.example.test';
  const ENV = { ...CREDS, SHOP_CLIENT_SECRET: 'client-secret' };
  const provider = (idp: FakeIdp, env: NodeJS.ProcessEnv = ENV, auth: AuthConfig = OIDC) =>
    createAuthProviders({ shop: source(auth, SHOP) }, { env, fetchImpl: idp.fetchImpl }).get('shop')!;

  it('signs in through the code flow once and sends the token as a bearer', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    const auth = provider(idp);

    assert.equal(auth.isConfigured(), true);
    assert.deepEqual(await auth.authorize(), { headers: { Authorization: 'Bearer access-1' }, query: {} });
    assert.deepEqual(await Promise.all([auth.getToken(), auth.getToken()]), ['access-1', 'access-1']);
    assert.equal(idp.to('/connect/token').length, 1);

    const authorize = idp.to('/connect/authorize')[0]!.url.searchParams;
    assert.equal(authorize.get('redirect_uri'), `${SHOP}/signin-oidc`, 'a path is resolved against the source');
    assert.equal(authorize.get('organization'), 'org-a');
  });

  it('reads the scope and the extra parameters from env vars, so the account can be chosen outside the config', async () => {
    const configurable: AuthConfig = {
      ...(OIDC as Extract<AuthConfig, { type: 'oidc-code' }>),
      scope: { env: 'QA_SCOPE', default: 'openid shop' },
      authorizeParams: { organization: { env: 'QA_ORGANIZATION' }, prompt: 'login' },
    };
    const sent = async (env: NodeJS.ProcessEnv): Promise<URLSearchParams> => {
      const idp = fakeIdp({ clientSecret: 'client-secret' });
      await provider(idp, { ...ENV, ...env }, configurable).getToken();
      return idp.to('/connect/authorize')[0]!.url.searchParams;
    };

    const defaults = await sent({});
    assert.equal(defaults.get('scope'), 'openid shop');
    assert.equal(defaults.has('organization'), false, 'a parameter that resolves to nothing is not sent');
    assert.equal(defaults.get('prompt'), 'login');

    const chosen = await sent({ QA_SCOPE: 'openid shop.admin', QA_ORGANIZATION: 'org-b' });
    assert.equal(chosen.get('scope'), 'openid shop.admin');
    assert.equal(chosen.get('organization'), 'org-b');
  });

  it('reads the issuer from its env var, and falls back to the source itself', async () => {
    const realm = fakeIdp({ issuer: 'https://login.example.test/realms/shop', clientSecret: 'client-secret' });
    assert.equal(await provider(realm, { ...ENV, SSO_URL: realm.issuer }).getToken(), 'access-1');

    const own = fakeIdp({ issuer: SHOP, clientSecret: 'client-secret' });
    const { issuer: _issuer, ...withoutIssuer } = OIDC as Extract<AuthConfig, { type: 'oidc-code' }>;
    assert.equal(await provider(own, ENV, withoutIssuer).getToken(), 'access-1');
  });

  it('refreshes a token inside the expiry buffer, and signs in again when the refresh token is dead', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret', expiresIn: 1 });
    const auth = provider(idp);
    assert.equal(await auth.getToken(), 'access-1');
    assert.equal(await auth.getToken(), 'access-2');
    idp.revokeRefreshTokens();
    assert.equal(await auth.getToken(), 'access-3');
    assert.deepEqual(
      idp.to('/connect/token').map((request) => request.form!.get('grant_type')),
      ['authorization_code', 'refresh_token', 'refresh_token', 'authorization_code'],
    );
  });

  it('prefers the static token, and is unconfigured without credentials', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    assert.equal(await provider(idp, { ...ENV, QA_TOKEN: 'fixed' }).getToken(), 'fixed');

    const anonymous = provider(idp, { SHOP_CLIENT_SECRET: 'client-secret' });
    assert.equal(anonymous.isConfigured(), false);
    assert.deepEqual(await anonymous.authorize(), { headers: {}, query: {} });
    assert.equal(idp.requests.length, 0);
  });

  it('reports a refused sign-in as an AuthError that names the step, never the password', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    await assert.rejects(
      provider(idp, { ...ENV, QA_PASS: 'wrong-password' }).getToken(),
      (error: unknown) => error instanceof AuthError && /Sign-in to "shop" failed: OIDC sign-in: the credentials were not accepted/.test(error.message) && !error.message.includes('wrong-password'),
    );
  });
});
