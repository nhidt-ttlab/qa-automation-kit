export interface CachedToken {
  /** The bearer token, or the `Cookie` header value for cookie-session sources. */
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** In-memory credential cache, keyed by api source id, with in-flight login dedup. */
export class TokenStore {
  private cache = new Map<string, CachedToken>();
  private pending = new Map<string, Promise<CachedToken>>();

  get(sourceId: string): CachedToken | undefined {
    return this.cache.get(sourceId);
  }

  set(sourceId: string, token: CachedToken): void {
    this.cache.set(sourceId, token);
  }

  clear(sourceId: string): void {
    this.cache.delete(sourceId);
  }

  getPending(sourceId: string): Promise<CachedToken> | undefined {
    return this.pending.get(sourceId);
  }

  setPending(sourceId: string, promise: Promise<CachedToken>): void {
    this.pending.set(sourceId, promise);
  }

  clearPending(sourceId: string): void {
    this.pending.delete(sourceId);
  }
}
