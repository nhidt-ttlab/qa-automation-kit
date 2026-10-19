import { resolveEnvValue } from '../config/load.js';
import type { AuthConfig } from '../config/schema.js';
import { jwtExpiresAt } from './jwt.js';
import { OidcFlowError, refreshOidcTokens, runOidcCodeFlow, type OidcClient, type OidcTokenSet } from './oidc.js';
import { TokenStore, type CachedToken } from './token-store.js';

/** A cached credential this close to expiry is renewed before use. */
export const EXPIRY_BUFFER_MS = 30_000;
/** Lifetime assumed when a login response states none and the token is not a JWT with `exp`. */
const DEFAULT_LIFETIME_MS = 60 * 60_000;

export interface AuthorizationParts {
  headers: Record<string, string>;
  /** Query parameters carrying credentials. Callers must keep these out of traces. */
  query: Record<string, string>;
}

export interface AuthProvider {
  readonly type: AuthConfig['type'];
  readonly sourceId: string;
  /** Cheap, no-network check for whether a live call would carry credentials. */
  isConfigured(): boolean;
  /** The bearer token, for token-based providers; `undefined` otherwise or when unconfigured. */
  getToken(): Promise<string | undefined>;
  /** Everything to attach to a request, logging in or refreshing first when needed. */
  authorize(): Promise<AuthorizationParts>;
}

export interface AuthSource {
  baseUrl: string;
  auth: AuthConfig;
}

export interface AuthTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface AuthTransportResponse {
  status: number;
  body: string;
  setCookies: string[];
}

/** POSTs a login request. Injectable so tests never touch the network. */
export type AuthTransport = (request: AuthTransportRequest) => Promise<AuthTransportResponse>;

export interface AuthProviderOptions {
  /** Read at call time, so credentials set after construction are honoured. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  tokenStore?: TokenStore;
  transport?: AuthTransport;
  /** Used by `oidc-code`, whose sign-in is more than one POST. Injectable so tests never touch the network. */
  fetchImpl?: typeof fetch;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export const fetchTransport: AuthTransport = async (request) => {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
  });
  return { status: response.status, body: await response.text(), setCookies: response.headers.getSetCookie() };
};

interface ProviderContext {
  env: NodeJS.ProcessEnv;
  tokenStore: TokenStore;
  transport: AuthTransport;
  fetchImpl: typeof fetch;
  lookup: (sourceId: string) => AuthProvider | undefined;
}

/**
 * Builds one provider per api source. Providers share `tokenStore`, so every client handed the same
 * store reuses one login per source. `reuse` providers resolve their target lazily, so declaration
 * order does not matter.
 */
export function createAuthProviders(
  sources: ReadonlyMap<string, AuthSource> | Readonly<Record<string, AuthSource>>,
  options: AuthProviderOptions = {},
): Map<string, AuthProvider> {
  const providers = new Map<string, AuthProvider>();
  const context: ProviderContext = {
    env: options.env ?? process.env,
    tokenStore: options.tokenStore ?? new TokenStore(),
    transport: options.transport ?? fetchTransport,
    fetchImpl: options.fetchImpl ?? fetch,
    lookup: (sourceId) => providers.get(sourceId),
  };
  const entries = sources instanceof Map ? [...sources.entries()] : Object.entries(sources);
  for (const [sourceId, source] of entries) providers.set(sourceId, createProvider(sourceId, source, context));
  return providers;
}

function createProvider(sourceId: string, source: AuthSource, context: ProviderContext): AuthProvider {
  const { auth } = source;
  switch (auth.type) {
    case 'none':
      return { type: 'none', sourceId, isConfigured: () => false, getToken: async () => undefined, authorize: async () => empty() };

    case 'static-bearer':
      return bearerProvider('static-bearer', sourceId, () => readEnv(context, auth.tokenEnv), async () => readEnv(context, auth.tokenEnv));

    case 'api-key':
      return {
        type: 'api-key',
        sourceId,
        isConfigured: () => readEnv(context, auth.keyEnv) !== undefined,
        getToken: async () => undefined,
        authorize: async () => {
          const key = readEnv(context, auth.keyEnv);
          if (key === undefined) return empty();
          return auth.in === 'query' ? { headers: {}, query: { [auth.name]: key } } : { headers: { [auth.name]: key }, query: {} };
        },
      };

    case 'oauth2-password':
      return oauth2PasswordProvider(sourceId, source.baseUrl, auth, context);

    case 'oidc-code':
      return oidcCodeProvider(sourceId, source.baseUrl, auth, context);

    case 'jwt-login':
      return jwtLoginProvider(sourceId, source.baseUrl, auth, context);

    case 'cookie-session':
      return cookieSessionProvider(sourceId, source.baseUrl, auth, context);

    case 'reuse': {
      const fixed = () => readEnv(context, auth.staticTokenEnv);
      return {
        type: 'reuse',
        sourceId,
        isConfigured: () => fixed() !== undefined || (context.lookup(auth.from)?.isConfigured() ?? false),
        getToken: async () => fixed() ?? (await context.lookup(auth.from)?.getToken()),
        authorize: async () => {
          const token = fixed();
          if (token !== undefined) return bearer(token);
          return (await context.lookup(auth.from)?.authorize()) ?? empty();
        },
      };
    }
  }
}

type AuthOf<T extends AuthConfig['type']> = Extract<AuthConfig, { type: T }>;

function oauth2PasswordProvider(
  sourceId: string,
  baseUrl: string,
  auth: AuthOf<'oauth2-password'>,
  context: ProviderContext,
): AuthProvider {
  const tokenUrl = new URL(auth.tokenPath, baseUrl).toString();
  const clientFields = (): Record<string, string> => {
    const secret = readEnv(context, auth.clientSecretEnv);
    return secret === undefined ? { client_id: auth.clientId } : { client_id: auth.clientId, client_secret: secret };
  };
  const postForm = async (form: Record<string, string>): Promise<CachedToken> => {
    const response = await context.transport({
      url: tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const body = parseLoginResponse(sourceId, response);
    const accessToken = body.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new AuthError(`Login response from "${sourceId}" has no access_token.`);
    }
    return {
      accessToken,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      expiresAt: expiryOf(accessToken, typeof body.expires_in === 'number' ? body.expires_in : undefined),
    };
  };

  const getToken = async (): Promise<string | undefined> => {
    const fixed = readEnv(context, auth.staticTokenEnv);
    if (fixed !== undefined) return fixed;
    const credentials = readCredentials(context, auth.usernameEnv, auth.passwordEnv);
    if (!credentials) return undefined;

    const token = await cachedCredential(sourceId, context, async (previous) => {
      if (previous?.refreshToken) {
        try {
          return await postForm({ grant_type: 'refresh_token', ...clientFields(), refresh_token: previous.refreshToken });
        } catch {
          context.tokenStore.clear(sourceId); // the refresh token is dead — fall through to a fresh login
        }
      }
      return postForm({
        grant_type: 'password',
        ...(auth.scope === undefined ? {} : { scope: auth.scope }),
        ...clientFields(),
        username: credentials.username,
        password: credentials.password,
      });
    });
    return token.accessToken;
  };

  return bearerProvider(
    'oauth2-password',
    sourceId,
    () => readEnv(context, auth.staticTokenEnv) ?? (readCredentials(context, auth.usernameEnv, auth.passwordEnv) ? 'configured' : undefined),
    getToken,
  );
}

function oidcCodeProvider(sourceId: string, baseUrl: string, auth: AuthOf<'oidc-code'>, context: ProviderContext): AuthProvider {
  const issuer = (): string => resolveEnvValue(auth.issuer, context.env) ?? baseUrl;
  const client = (): OidcClient => ({
    clientId: auth.clientId,
    clientSecret: readEnv(context, auth.clientSecretEnv),
    redirectUri: new URL(auth.redirectUri, baseUrl).toString(),
    scope: resolveEnvValue(auth.scope, context.env) ?? 'openid',
  });
  const authorizeParams = (): Record<string, string> => {
    const params: Record<string, string> = {};
    for (const [name, value] of Object.entries(auth.authorizeParams)) {
      const resolved = resolveEnvValue(value, context.env);
      if (resolved !== undefined && resolved !== '') params[name] = resolved;
    }
    return params;
  };
  const cached = (tokens: OidcTokenSet): CachedToken => ({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    // A response that states no lifetime, for a token that is not a JWT, would otherwise sign in on every call.
    expiresAt: tokens.expiresAt > Date.now() ? tokens.expiresAt : Date.now() + DEFAULT_LIFETIME_MS,
  });

  const getToken = async (): Promise<string | undefined> => {
    const fixed = readEnv(context, auth.staticTokenEnv);
    if (fixed !== undefined) return fixed;
    const credentials = readCredentials(context, auth.usernameEnv, auth.passwordEnv);
    if (!credentials) return undefined;

    const token = await cachedCredential(sourceId, context, async (previous) => {
      if (previous?.refreshToken) {
        try {
          return cached(await refreshOidcTokens(issuer(), client(), previous.refreshToken, context.fetchImpl));
        } catch {
          context.tokenStore.clear(sourceId); // the refresh token is dead — fall through to a fresh sign-in
        }
      }
      try {
        return cached(await runOidcCodeFlow({ issuer: issuer(), client: client(), ...credentials, authorizeParams: authorizeParams(), fetchImpl: context.fetchImpl }));
      } catch (error) {
        if (error instanceof OidcFlowError) throw new AuthError(`Sign-in to "${sourceId}" failed: ${error.message}`);
        throw error;
      }
    });
    return token.accessToken;
  };

  return bearerProvider(
    'oidc-code',
    sourceId,
    () => readEnv(context, auth.staticTokenEnv) ?? (readCredentials(context, auth.usernameEnv, auth.passwordEnv) ? 'configured' : undefined),
    getToken,
  );
}

function jwtLoginProvider(sourceId: string, baseUrl: string, auth: AuthOf<'jwt-login'>, context: ProviderContext): AuthProvider {
  const loginUrl = new URL(auth.loginPath, baseUrl).toString();

  const getToken = async (): Promise<string | undefined> => {
    const fixed = readEnv(context, auth.staticTokenEnv);
    if (fixed !== undefined) return fixed;
    const credentials = readCredentials(context, auth.usernameEnv, auth.passwordEnv);
    if (!credentials) return undefined;

    const token = await cachedCredential(sourceId, context, async () => {
      const response = await context.transport({
        url: loginUrl,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [auth.usernameField]: credentials.username, [auth.passwordField]: credentials.password }),
      });
      const body = parseLoginResponse(sourceId, response);
      const accessToken = readPath(body, auth.tokenJsonPath);
      if (typeof accessToken !== 'string' || accessToken.length === 0) {
        throw new AuthError(`Login response from "${sourceId}" has no token at "${auth.tokenJsonPath}".`);
      }
      const refreshToken = auth.refreshTokenJsonPath === undefined ? undefined : readPath(body, auth.refreshTokenJsonPath);
      const expiresIn = auth.expiresInJsonPath === undefined ? undefined : readPath(body, auth.expiresInJsonPath);
      return {
        accessToken,
        refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
        expiresAt: expiryOf(accessToken, typeof expiresIn === 'number' ? expiresIn : undefined),
      };
    });
    return token.accessToken;
  };

  return bearerProvider(
    'jwt-login',
    sourceId,
    () => readEnv(context, auth.staticTokenEnv) ?? (readCredentials(context, auth.usernameEnv, auth.passwordEnv) ? 'configured' : undefined),
    getToken,
  );
}

function cookieSessionProvider(
  sourceId: string,
  baseUrl: string,
  auth: AuthOf<'cookie-session'>,
  context: ProviderContext,
): AuthProvider {
  const loginUrl = new URL(auth.loginPath, baseUrl).toString();

  const getCookie = async (): Promise<string | undefined> => {
    const credentials = readCredentials(context, auth.usernameEnv, auth.passwordEnv);
    if (!credentials) return undefined;
    const session = await cachedCredential(sourceId, context, async () => {
      const response = await context.transport({
        url: loginUrl,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [auth.usernameField]: credentials.username, [auth.passwordField]: credentials.password }),
      });
      if (response.status < 200 || response.status >= 400) {
        throw new AuthError(`Login request to "${sourceId}" failed: ${response.status} ${response.body}`.trim());
      }
      const cookie = response.setCookies
        .map((header) => header.split(';', 1)[0]?.trim() ?? '')
        .filter((pair) => pair.length > 0)
        .join('; ');
      if (cookie.length === 0) throw new AuthError(`Login response from "${sourceId}" set no cookies.`);
      return { accessToken: cookie, expiresAt: Date.now() + DEFAULT_LIFETIME_MS };
    });
    return session.accessToken;
  };

  return {
    type: 'cookie-session',
    sourceId,
    isConfigured: () => readCredentials(context, auth.usernameEnv, auth.passwordEnv) !== undefined,
    getToken: async () => undefined,
    authorize: async () => {
      const cookie = await getCookie();
      return cookie === undefined ? empty() : { headers: { Cookie: cookie }, query: {} };
    },
  };
}

/** Returns a live cached credential, or acquires one — at most one acquisition per source at a time. */
async function cachedCredential(
  sourceId: string,
  context: ProviderContext,
  acquire: (previous: CachedToken | undefined) => Promise<CachedToken>,
): Promise<CachedToken> {
  const cached = context.tokenStore.get(sourceId);
  if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER_MS) return cached;

  const pending = context.tokenStore.getPending(sourceId);
  if (pending) return pending;

  const promise = acquire(cached).then((token) => {
    context.tokenStore.set(sourceId, token);
    return token;
  });
  context.tokenStore.setPending(sourceId, promise);
  try {
    return await promise;
  } finally {
    context.tokenStore.clearPending(sourceId);
  }
}

function bearerProvider(
  type: AuthConfig['type'],
  sourceId: string,
  configured: () => string | undefined,
  getToken: () => Promise<string | undefined>,
): AuthProvider {
  return {
    type,
    sourceId,
    isConfigured: () => configured() !== undefined,
    getToken,
    authorize: async () => {
      const token = await getToken();
      return token === undefined ? empty() : bearer(token);
    },
  };
}

function parseLoginResponse(sourceId: string, response: AuthTransportResponse): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) {
    throw new AuthError(`Login request to "${sourceId}" failed: ${response.status} ${response.body}`.trim());
  }
  try {
    const parsed: unknown = JSON.parse(response.body);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new AuthError(`Login response from "${sourceId}" is not a JSON object.`);
}

function expiryOf(accessToken: string, expiresInSeconds: number | undefined): number {
  if (expiresInSeconds !== undefined) return Date.now() + expiresInSeconds * 1000;
  return jwtExpiresAt(accessToken) ?? Date.now() + DEFAULT_LIFETIME_MS;
}

/** Dot path into a JSON value, e.g. `data.accessToken`. */
export function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function readEnv(context: ProviderContext, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const value = context.env[name];
  return value !== undefined && value.length > 0 ? value : undefined;
}

function readCredentials(
  context: ProviderContext,
  usernameEnv: string,
  passwordEnv: string,
): { username: string; password: string } | undefined {
  const username = readEnv(context, usernameEnv);
  const password = readEnv(context, passwordEnv);
  return username !== undefined && password !== undefined ? { username, password } : undefined;
}

function bearer(token: string): AuthorizationParts {
  return { headers: { Authorization: `Bearer ${token}` }, query: {} };
}

function empty(): AuthorizationParts {
  return { headers: {}, query: {} };
}
