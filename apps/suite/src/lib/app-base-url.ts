/**
 * The web app's canonical public origin for links an administrator copies (invitation links; FR-ADM-17,
 * FR-IAM-03; security reviews L2): APP_BASE_URL — configuration, not a secret; the same variable the worker
 * uses for e-mailed links (https, or plain http for localhost only; no path). Set it in Vercel for
 * Production and Preview (docs/engineering/production-setup.md § I). Without it the server says nothing
 * (null) and the browser uses its own origin (window.location.origin) — never a URL derived from the
 * request's Host header. Framework-free parsing; the server helper is `appBaseUrl` (lib/app-base-url-request.ts).
 */

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** A valid APP_BASE_URL as an origin (no trailing slash), else null. */
export function parseAppBaseUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname));
  if (!secure || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) {
    return null;
  }
  if (url.search || url.hash) return null;
  return url.origin;
}
