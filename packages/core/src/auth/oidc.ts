import { createHash, randomBytes } from 'node:crypto';
import { jwtExpiresAt } from './jwt.js';

/**
 * The OpenID Connect authorization code + PKCE flow, driven over plain HTTP the way a browser would:
 * authorization request, the identity provider's sign-in form, the redirect back, the token request.
 * No password grant and no test-only client: the provider sees an ordinary sign-in by a registered client.
 * This is what a project needs to test single sign-on, audience-bound tokens, refresh rotation and sign-out
 * without a browser.
 *
 * What it can sign in to: a server-rendered page with one form holding the username and the password. A
 * sign-in page built by JavaScript, a username-then-password sequence, MFA or a consent screen is not
 * handled; drive those through the browser (`submitSignInForm` in `@qakit/ui`).
 *
 * Error messages name the step and the status. They never contain a password, secret, code or token.
 */

export interface OidcClient {
  clientId: string;
  /** Sent as `client_secret` in the token request. Leave out for a public client, which relies on PKCE alone. */
  clientSecret?: string;
  /** Must equal a redirect URI registered for the client. The code is read from the redirect; this URL is never called. */
  redirectUri: string;
  scope: string;
}

export interface OidcTokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  /** Epoch milliseconds: from `expires_in`, else the access token's `exp` claim, else the time of issue. */
  expiresAt: number;
}

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
}

export interface OidcCodeFlowOptions {
  issuer: string;
  client: OidcClient;
  username: string;
  password: string;
  /** Extra authorization request parameters, e.g. the organization or tenant the token is asked for. */
  authorizeParams?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export class OidcFlowError extends Error {
  constructor(
    readonly step: string,
    detail: string,
  ) {
    super(`OIDC ${step}: ${detail}`);
    this.name = 'OidcFlowError';
  }
}

const MAX_REDIRECTS = 10;

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export async function discoverOidc(issuer: string, fetchImpl: typeof fetch = fetch): Promise<OidcDiscoveryDocument> {
  // Relative to the issuer, so an issuer with a path (a realm, a tenant) keeps it.
  const response = await fetchImpl(new URL('.well-known/openid-configuration', issuer.endsWith('/') ? issuer : `${issuer}/`));
  if (!response.ok) throw new OidcFlowError('discovery', `answered ${response.status}`);
  const document = (await response.json()) as Partial<OidcDiscoveryDocument>;
  if (!document.authorization_endpoint || !document.token_endpoint || !document.issuer) {
    throw new OidcFlowError('discovery', 'the document names no issuer, authorization endpoint or token endpoint');
  }
  return document as OidcDiscoveryDocument;
}

/** A signed-in user: the tokens, and the way to end the login session they came from. */
export interface OidcSignedIn {
  tokens: OidcTokenSet;
  /** Signs out at the identity provider with the session cookie of this sign-in, as the browser would. */
  signOut(): Promise<void>;
}

/** Signs the user in and returns the tokens the client would hold. */
export async function runOidcCodeFlow(options: OidcCodeFlowOptions): Promise<OidcTokenSet> {
  return (await oidcSignIn(options)).tokens;
}

/** Signs the user in and keeps the provider's session, so the caller can sign out of exactly this session. */
export async function oidcSignIn(options: OidcCodeFlowOptions): Promise<OidcSignedIn> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { client } = options;
  const discovery = await discoverOidc(options.issuer, fetchImpl);
  const pkce = createPkce();
  const state = randomBytes(16).toString('base64url');

  const authorize = new URL(discovery.authorization_endpoint);
  authorize.search = new URLSearchParams({
    ...options.authorizeParams,
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: client.scope,
    state,
    nonce: randomBytes(16).toString('base64url'),
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  }).toString();

  const session = new BrowserLikeSession([new URL(options.issuer).origin, authorize.origin], client.redirectUri, fetchImpl);
  let outcome = await session.follow(authorize, undefined, 'authorization request');
  if (outcome.kind === 'page') {
    const form = findSignInForm(outcome.html, outcome.url);
    if (!form) throw new OidcFlowError('sign-in', 'the identity provider answered a page without a sign-in form');
    form.fields.set(form.usernameField, options.username);
    form.fields.set(form.passwordField, options.password);
    outcome = await session.follow(form.action, new URLSearchParams([...form.fields]), 'sign-in');
    if (outcome.kind === 'page') {
      throw new OidcFlowError(
        'sign-in',
        findSignInForm(outcome.html, outcome.url)
          ? 'the credentials were not accepted'
          : 'the identity provider showed another page (consent? a second factor? a choice of organization?) instead of redirecting to the client',
      );
    }
  }

  const callback = outcome.callback;
  const error = callback.searchParams.get('error');
  if (error) throw new OidcFlowError('authorization response', `the identity provider returned error "${error}"`);
  if (callback.searchParams.get('state') !== state) throw new OidcFlowError('authorization response', 'the state does not match the request');
  const code = callback.searchParams.get('code');
  if (!code) throw new OidcFlowError('authorization response', 'no code was returned');

  const tokens = await requestTokens(discovery.token_endpoint, client, { grant_type: 'authorization_code', code, redirect_uri: client.redirectUri, code_verifier: pkce.verifier }, fetchImpl);
  return {
    tokens,
    signOut: async () => {
      if (!discovery.end_session_endpoint) throw new OidcFlowError('sign-out', 'the identity provider advertises no end-session endpoint');
      await session.follow(new URL(discovery.end_session_endpoint), undefined, 'sign-out');
    },
  };
}

/** Redeems a refresh token. With rotation, the returned set carries the next refresh token. */
export async function refreshOidcTokens(issuer: string, client: OidcClient, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<OidcTokenSet> {
  const discovery = await discoverOidc(issuer, fetchImpl);
  return requestTokens(discovery.token_endpoint, client, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl);
}

function clientFields(client: OidcClient): Record<string, string> {
  return client.clientSecret === undefined ? { client_id: client.clientId } : { client_id: client.clientId, client_secret: client.clientSecret };
}

function tokenSetOf(body: Record<string, unknown>, accessToken: string): OidcTokenSet {
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    idToken: typeof body.id_token === 'string' ? body.id_token : undefined,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    expiresAt: typeof body.expires_in === 'number' ? Date.now() + body.expires_in * 1000 : (jwtExpiresAt(accessToken) ?? Date.now()),
  };
}

async function requestTokens(tokenEndpoint: string, client: OidcClient, parameters: Record<string, string>, fetchImpl: typeof fetch): Promise<OidcTokenSet> {
  const response = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...parameters, ...clientFields(client) }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== 'string') {
    throw new OidcFlowError('token request', `answered ${response.status}${typeof body.error === 'string' ? ` (${body.error})` : ''}`);
  }
  return tokenSetOf(body, body.access_token);
}

type FlowOutcome = { kind: 'callback'; callback: URL } | { kind: 'page'; url: URL; html: string };

/** Follows redirects by hand, keeping the provider's cookies, until it shows a page or redirects to the client. */
class BrowserLikeSession {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly providerOrigins: string[],
    private readonly redirectUri: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async follow(start: URL, form: URLSearchParams | undefined, step: string): Promise<FlowOutcome> {
    let url = start;
    let body = form;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (this.isCallback(url)) return { kind: 'callback', callback: url };
      // Cookies and credentials go to the identity provider only, never to wherever a redirect points.
      if (!this.providerOrigins.includes(url.origin)) throw new OidcFlowError(step, `redirected outside the identity provider to ${url.origin}`);

      const response = await this.fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'text/html',
          ...(this.cookies.size > 0 ? { Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body,
      });
      this.remember(response);

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url);
        body = undefined;
        continue;
      }
      if (response.status === 200) return { kind: 'page', url, html: await response.text() };
      throw new OidcFlowError(step, `${url.pathname} answered ${response.status}`);
    }
    throw new OidcFlowError(step, 'too many redirects');
  }

  private isCallback(url: URL): boolean {
    const registered = new URL(this.redirectUri);
    return url.origin === registered.origin && url.pathname === registered.pathname;
  }

  private remember(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';', 1)[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

export interface SignInForm {
  action: URL;
  /** Every field the form posts, hidden ones (antiforgery token, return URL) included. */
  fields: Map<string, string>;
  usernameField: string;
  passwordField: string;
}

/**
 * Finds the form with a password field and works out its fields from the markup, so the flow does not
 * depend on the sign-in page's field names.
 */
export function findSignInForm(html: string, pageUrl: URL): SignInForm | undefined {
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const inputs = [...(match[2] ?? '').matchAll(/<input\b([^>]*)>/gi)].map((input) => attributes(input[1] ?? ''));
    const password = inputs.find((input) => input.type === 'password' && input.name);
    if (!password) continue;

    const username = inputs.find((input) => input.name && ['text', 'email', undefined].includes(input.type));
    if (!username) continue;

    const fields = new Map<string, string>();
    for (const input of inputs) {
      if (input.name && input.type === 'hidden') fields.set(input.name, input.value ?? '');
    }
    const formAttributes = attributes(match[1] ?? '');
    return {
      action: new URL(formAttributes.action || pageUrl.href, pageUrl),
      fields,
      usernameField: username.name!,
      passwordField: password.name!,
    };
  }
  return undefined;
}

function attributes(tag: string): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    result[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  if (result.type) result.type = result.type.toLowerCase();
  return result;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export interface OidcTokenResponse {
  status: number;
  /** The OAuth error code of a refused request. */
  error?: string;
  /** The names of the fields the response carried, for asserting what was and was not returned. */
  fields: string[];
  tokens?: OidcTokenSet;
}

/**
 * A raw token request as the given client: refresh with a narrower scope, token exchange, client
 * credentials, anything a scenario needs to probe. A refusal is returned, not thrown, so the scenario can
 * assert on it.
 */
export async function oidcTokenRequest(issuer: string, client: OidcClient, parameters: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<OidcTokenResponse> {
  const discovery = await discoverOidc(issuer, fetchImpl);
  const response = await fetchImpl(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...parameters, ...clientFields(client) }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const result: OidcTokenResponse = { status: response.status, fields: Object.keys(body).sort(), error: typeof body.error === 'string' ? body.error : undefined };
  if (response.ok && typeof body.access_token === 'string') result.tokens = tokenSetOf(body, body.access_token);
  return result;
}
