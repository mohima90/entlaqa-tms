/**
 * The web app's public origin for links an administrator copies (invitation links; FR-ADM-17, FR-IAM-03).
 * Taken on the SERVER — never from the browser's location — from APP_BASE_URL (the same variable the
 * worker uses for e-mailed links: https, or plain http for localhost only; no path), else from the
 * request's own host (local development, previews without the variable). Framework-free parsing; the
 * request part is in `appBaseUrlForRequest` (server only).
 */

const HOST = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/;

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

/** The origin of a request's Host header (http for localhost, else https), or null when malformed. */
export function originFromHost(host: string | null): string | null {
  const value = host?.trim().toLowerCase() ?? '';
  if (!HOST.test(value)) return null;
  const hostname = value.replace(/:\d+$/, '');
  return `${isLocalHost(hostname) ? 'http' : 'https'}://${value}`;
}
