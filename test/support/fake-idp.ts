import { createHash } from 'node:crypto';

/**
 * An in-memory OpenID Connect provider behind a `fetch` — discovery, an authorization endpoint that sends
 * an unknown browser to a server-rendered sign-in form, a token endpoint with PKCE and rotating refresh
 * tokens, and sign-out. Enough for the code flow tests to run without a network.
 */
export interface FakeIdpOptions {
  issuer?: string;
  username?: string;
  password?: string;
  clientId?: string;
  /** Leave out for a public client: the token endpoint then refuses a request that sends a secret. */
  clientSecret?: string;
  redirectUri?: string;
  /** Seconds in `expires_in`. */
  expiresIn?: number;
  /** An authorization request carrying this parameter value is answered with `error=access_denied`. */
  deniedParam?: [name: string, value: string];
  /** Where the authorization endpoint sends the browser instead of the sign-in page. */
  strayRedirect?: string;
}

export interface FakeIdpRequest {
  method: string;
  url: URL;
  form?: URLSearchParams;
  cookie?: string;
}

export interface FakeIdp {
  issuer: string;
  fetchImpl: typeof fetch;
  requests: FakeIdpRequest[];
  /** Requests to one path, in order. */
  to(pathname: string): FakeIdpRequest[];
  /** Makes every refresh token issued so far worthless. */
  revokeRefreshTokens(): void;
  signedInSessions(): number;
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const redirect = (location: string, cookies: string[] = []): Response => {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
};

export function fakeIdp(options: FakeIdpOptions = {}): FakeIdp {
  const issuer = options.issuer ?? 'https://sso.example.test';
  const base = issuer.endsWith('/') ? issuer : `${issuer}/`;
  const endpoint = (path: string): string => new URL(path, base).toString();
  const username = options.username ?? 'qa';
  const password = options.password ?? 'secret';
  const clientId = options.clientId ?? 'shop-web';
  const redirectUri = options.redirectUri ?? 'https://shop.example.test/signin-oidc';

  const requests: FakeIdpRequest[] = [];
  const sessions = new Set<string>();
  const codes = new Map<string, { challenge: string }>();
  const refreshTokens = new Set<string>();
  let counter = 0;

  const issue = (): Record<string, unknown> => {
    counter += 1;
    const refreshToken = `refresh-${counter}`;
    refreshTokens.add(refreshToken);
    return { access_token: `access-${counter}`, refresh_token: refreshToken, id_token: `id-${counter}`, token_type: 'Bearer', expires_in: options.expiresIn ?? 300, scope: 'openid shop' };
  };

  const signInPage = (returnUrl: string): Response =>
    new Response(
      `<html><body><form method="post" action="${new URL('Account/Login', base).pathname}?ReturnUrl=${encodeURIComponent(returnUrl)}">
        <input type="hidden" name="__RequestVerificationToken" value="anti&amp;forgery">
        <input type="email" name="Input.Email"><input type="password" name="Input.Password">
        <button type="submit">Sign in</button></form></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );

  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const form = init?.body ? new URLSearchParams(init.body as URLSearchParams | string) : undefined;
    const cookie = headers.get('cookie') ?? undefined;
    requests.push({ method, url, form, cookie });
    const session = /(?:^|;\s*)session=([^;]+)/.exec(cookie ?? '')?.[1];
    const path = url.href.startsWith(base) ? url.href.slice(base.length).split('?')[0] : undefined;

    switch (path) {
      case '.well-known/openid-configuration':
        return json(200, { issuer, authorization_endpoint: endpoint('connect/authorize'), token_endpoint: endpoint('connect/token'), end_session_endpoint: endpoint('connect/logout') });

      case 'connect/authorize': {
        const query = url.searchParams;
        if (options.strayRedirect) return redirect(options.strayRedirect);
        if (!session || !sessions.has(session)) return redirect(`${endpoint('Account/Login')}?ReturnUrl=${encodeURIComponent(url.pathname + url.search)}`);
        const callback = new URL(query.get('redirect_uri') ?? '');
        callback.searchParams.set('state', query.get('state') ?? '');
        if (options.deniedParam && query.get(options.deniedParam[0]) === options.deniedParam[1]) {
          callback.searchParams.set('error', 'access_denied');
          return redirect(callback.toString());
        }
        if (query.get('client_id') !== clientId || callback.origin + callback.pathname !== redirectUri || query.get('code_challenge_method') !== 'S256') {
          return new Response('invalid request', { status: 400 });
        }
        const code = `code-${codes.size + 1}`;
        codes.set(code, { challenge: query.get('code_challenge') ?? '' });
        callback.searchParams.set('code', code);
        return redirect(callback.toString());
      }

      case 'Account/Login': {
        const returnUrl = url.searchParams.get('ReturnUrl') ?? '/';
        if (method === 'GET') return signInPage(returnUrl);
        const accepted = form?.get('Input.Email') === username && form?.get('Input.Password') === password && form?.get('__RequestVerificationToken') === 'anti&forgery';
        if (!accepted) return signInPage(returnUrl);
        const id = `s${sessions.size + 1}`;
        sessions.add(id);
        return redirect(new URL(returnUrl, url).toString(), [`session=${id}; Path=/; HttpOnly; Secure`]);
      }

      case 'connect/token': {
        const secretOk = options.clientSecret === undefined ? !form?.has('client_secret') : form?.get('client_secret') === options.clientSecret;
        if (form?.get('client_id') !== clientId || !secretOk) return json(401, { error: 'invalid_client' });
        if (form.get('grant_type') === 'authorization_code') {
          const issued = codes.get(form.get('code') ?? '');
          const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
          if (!issued || issued.challenge !== challenge || form.get('redirect_uri') !== redirectUri) return json(400, { error: 'invalid_grant' });
          codes.delete(form.get('code') ?? '');
          return json(200, issue());
        }
        if (form.get('grant_type') === 'refresh_token') {
          // Rotation: a refresh token is good once.
          if (!refreshTokens.delete(form.get('refresh_token') ?? '')) return json(400, { error: 'invalid_grant' });
          return json(200, issue());
        }
        return json(400, { error: 'unsupported_grant_type' });
      }

      case 'connect/logout':
        if (session) sessions.delete(session);
        return new Response('<html><body>Signed out</body></html>', { status: 200, headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=; Path=/; Max-Age=0' } });

      default:
        return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;

  return {
    issuer,
    fetchImpl,
    requests,
    to: (pathname) => requests.filter((request) => request.url.pathname === pathname),
    revokeRefreshTokens: () => refreshTokens.clear(),
    signedInSessions: () => sessions.size,
  };
}
