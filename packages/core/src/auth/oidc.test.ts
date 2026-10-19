import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { fakeIdp } from '../../../../test/support/fake-idp.js';
import { OidcFlowError, discoverOidc, findSignInForm, oidcSignIn, oidcTokenRequest, refreshOidcTokens, runOidcCodeFlow, type OidcClient } from './oidc.js';

const CLIENT: OidcClient = { clientId: 'shop-web', clientSecret: 'client-secret', redirectUri: 'https://shop.example.test/signin-oidc', scope: 'openid offline_access shop' };
const USER = { username: 'qa', password: 'secret' };

describe('the authorization code flow', () => {
  it('signs in at the form and redeems the code with its PKCE verifier', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    const tokens = await runOidcCodeFlow({ issuer: idp.issuer, client: CLIENT, ...USER, fetchImpl: idp.fetchImpl });

    assert.equal(tokens.accessToken, 'access-1');
    assert.equal(tokens.refreshToken, 'refresh-1');
    assert.equal(tokens.idToken, 'id-1');
    assert.ok(tokens.expiresAt > Date.now() + 290_000 && tokens.expiresAt <= Date.now() + 300_000);

    const authorize = idp.to('/connect/authorize')[0]!.url.searchParams;
    assert.equal(authorize.get('response_type'), 'code');
    assert.equal(authorize.get('code_challenge_method'), 'S256');
    assert.ok(authorize.get('state') && authorize.get('nonce'));

    // The form is posted back with its hidden fields, entities decoded, under the page's own field names.
    const signIn = idp.to('/Account/Login').find((request) => request.method === 'POST')!;
    assert.equal(signIn.form!.get('Input.Email'), 'qa');
    assert.equal(signIn.form!.get('__RequestVerificationToken'), 'anti&forgery');

    const token = idp.to('/connect/token')[0]!.form!;
    assert.equal(token.get('grant_type'), 'authorization_code');
    assert.equal(createHash('sha256').update(token.get('code_verifier')!).digest('base64url'), authorize.get('code_challenge'));
    // The redirect URI is where the code is read from; nothing is ever sent there.
    assert.equal(idp.requests.some((request) => request.url.origin === 'https://shop.example.test'), false);
  });

  it('sends extra authorization parameters and reports the error the provider returns', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret', deniedParam: ['organization', 'org-b'] });
    const flow = (organization: string) => runOidcCodeFlow({ issuer: idp.issuer, client: CLIENT, ...USER, authorizeParams: { organization }, fetchImpl: idp.fetchImpl });

    await flow('org-a');
    assert.equal(idp.to('/connect/authorize')[0]!.url.searchParams.get('organization'), 'org-a');
    await assert.rejects(flow('org-b'), (error: unknown) => error instanceof OidcFlowError && error.step === 'authorization response' && error.message.includes('access_denied'));
  });

  it('cannot have its protocol parameters replaced by extra ones', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    await runOidcCodeFlow({ issuer: idp.issuer, client: CLIENT, ...USER, authorizeParams: { response_type: 'token', client_id: 'other' }, fetchImpl: idp.fetchImpl });
    const authorize = idp.to('/connect/authorize')[0]!.url.searchParams;
    assert.equal(authorize.get('response_type'), 'code');
    assert.equal(authorize.get('client_id'), 'shop-web');
  });

  it('says the credentials were not accepted, without repeating them', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    await assert.rejects(
      runOidcCodeFlow({ issuer: idp.issuer, client: CLIENT, username: 'qa', password: 'wrong-password', fetchImpl: idp.fetchImpl }),
      (error: unknown) => error instanceof OidcFlowError && error.step === 'sign-in' && /not accepted/.test(error.message) && !error.message.includes('wrong-password'),
    );
    assert.equal(idp.to('/connect/token').length, 0);
  });

  it('never takes the password, or a cookie, outside the identity provider', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret', strayRedirect: 'https://elsewhere.example.test/sign-in' });
    await assert.rejects(
      runOidcCodeFlow({ issuer: idp.issuer, client: CLIENT, ...USER, fetchImpl: idp.fetchImpl }),
      (error: unknown) => error instanceof OidcFlowError && /redirected outside the identity provider to https:\/\/elsewhere\.example\.test/.test(error.message),
    );
    assert.equal(idp.requests.some((request) => request.url.host === 'elsewhere.example.test'), false);
  });

  it('works for a public client: no secret is sent', async () => {
    const idp = fakeIdp();
    const tokens = await runOidcCodeFlow({ issuer: idp.issuer, client: { ...CLIENT, clientSecret: undefined }, ...USER, fetchImpl: idp.fetchImpl });
    assert.equal(tokens.accessToken, 'access-1');
    assert.equal(idp.to('/connect/token')[0]!.form!.has('client_secret'), false);
  });

  it('reads discovery under an issuer that has a path', async () => {
    const idp = fakeIdp({ issuer: 'https://sso.example.test/realms/shop', clientSecret: 'client-secret' });
    const discovery = await discoverOidc(idp.issuer, idp.fetchImpl);
    assert.equal(discovery.token_endpoint, 'https://sso.example.test/realms/shop/connect/token');
    assert.equal(idp.requests[0]!.url.pathname, '/realms/shop/.well-known/openid-configuration');
    assert.equal((await runOidcCodeFlow({ issuer: idp.issuer, client: CLIENT, ...USER, fetchImpl: idp.fetchImpl })).accessToken, 'access-1');
  });
});

describe('the session and its tokens', () => {
  it('signs out of exactly the session it signed in with', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    const first = await oidcSignIn({ issuer: idp.issuer, client: CLIENT, ...USER, fetchImpl: idp.fetchImpl });
    await oidcSignIn({ issuer: idp.issuer, client: CLIENT, ...USER, fetchImpl: idp.fetchImpl });
    assert.equal(idp.signedInSessions(), 2);

    await first.signOut();
    assert.equal(idp.signedInSessions(), 1);
    assert.equal(idp.to('/connect/logout')[0]!.cookie, 'session=s1');
  });

  it('rotates refresh tokens: the next set carries the next one, and the old one is refused', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    const tokens = await runOidcCodeFlow({ issuer: idp.issuer, client: CLIENT, ...USER, fetchImpl: idp.fetchImpl });
    const next = await refreshOidcTokens(idp.issuer, CLIENT, tokens.refreshToken!, idp.fetchImpl);
    assert.equal(next.refreshToken, 'refresh-2');
    await assert.rejects(refreshOidcTokens(idp.issuer, CLIENT, tokens.refreshToken!, idp.fetchImpl), (error: unknown) => error instanceof OidcFlowError && error.message.includes('invalid_grant'));
  });

  it('returns a refused raw token request instead of throwing', async () => {
    const idp = fakeIdp({ clientSecret: 'client-secret' });
    const refused = await oidcTokenRequest(idp.issuer, CLIENT, { grant_type: 'refresh_token', refresh_token: 'unknown' }, idp.fetchImpl);
    assert.deepEqual(refused, { status: 400, error: 'invalid_grant', fields: ['error'] });

    const tokens = await runOidcCodeFlow({ issuer: idp.issuer, client: CLIENT, ...USER, fetchImpl: idp.fetchImpl });
    const issued = await oidcTokenRequest(idp.issuer, CLIENT, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken! }, idp.fetchImpl);
    assert.equal(issued.status, 200);
    assert.equal(issued.tokens?.accessToken, 'access-2');
    assert.ok(issued.fields.includes('access_token') && issued.fields.includes('expires_in'));
  });
});

describe('findSignInForm', () => {
  const page = new URL('https://sso.example.test/Account/Login?ReturnUrl=%2F');

  it('picks the form with a password field and resolves its action against the page', () => {
    const form = findSignInForm(
      `<form action="/search"><input type="text" name="q"></form>
       <form method="post" action="/Account/Login?a=1&amp;b=2"><input name="user"><input type="PASSWORD" name="pass"><input type="hidden" name="token" value='t"1'><input type="checkbox" name="remember"></form>`,
      page,
    )!;
    assert.equal(form.action.toString(), 'https://sso.example.test/Account/Login?a=1&b=2');
    assert.equal(form.usernameField, 'user');
    assert.equal(form.passwordField, 'pass');
    assert.deepEqual([...form.fields], [['token', 't"1']]);
  });

  it('posts back to the page itself when the form names no action', () => {
    assert.equal(findSignInForm('<form><input type="email" name="e"><input type="password" name="p"></form>', page)!.action.toString(), page.toString());
  });

  it('finds nothing on a page without a password form', () => {
    assert.equal(findSignInForm('<form><input type="text" name="code"></form><p>Enter the code we sent you</p>', page), undefined);
  });
});
