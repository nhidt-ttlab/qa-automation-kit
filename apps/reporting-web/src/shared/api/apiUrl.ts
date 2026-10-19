/**
 * Base URL of the reporting API.
 *
 * Kept here rather than inline so the axios client and anything that builds a plain browser
 * URL — an `<img src>`, a `<video src>`, a download link — agree on one origin. Those cannot
 * go through axios, so a relative `/api/...` would resolve against the web app's own origin
 * and depend on the Vite dev proxy pointing at the same port as VITE_API_URL.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000';

/** Absolute URL for an API-relative path such as `/api/runs/:id/ui-evidence/E-UI-01`. */
export function apiUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${API_BASE_URL.replace(/\/+$/, '')}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
}
