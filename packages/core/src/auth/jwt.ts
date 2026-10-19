/**
 * Decodes a JWT's payload without verifying the signature. Only for reading claims of a token the
 * server under test already issued or accepted — never for trusting one.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims: unknown = JSON.parse(json);
    return claims !== null && typeof claims === 'object' && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The `exp` claim as epoch milliseconds, when the token is a JWT that carries one. */
export function jwtExpiresAt(token: string): number | undefined {
  const exp = decodeJwtClaims(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : undefined;
}

/** The first non-empty string among `claimNames`, e.g. `['sub', 'nameid']` for a user id. */
export function readJwtClaim(token: string, claimNames: readonly string[]): string | undefined {
  const claims = decodeJwtClaims(token);
  if (!claims) return undefined;
  for (const name of claimNames) {
    const value = claims[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
