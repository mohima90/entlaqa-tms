/**
 * Host → tenant resolution — PLACEHOLDER (ADR 0002 §4, completed in T-M1-D03).
 *
 * Today this only classifies the Host header. The full implementation looks the host up in
 * platform.tenant_domains (verified domains only) through a narrow lookup, caches briefly, and
 * the server compares the result with the session's tenant_id claim. The proxy never makes
 * authorization decisions; the classification is a hint for server code, not an input to RLS.
 */
export type HostClassification =
  | { readonly kind: 'platform' }
  | { readonly kind: 'subdomain'; readonly slug: string }
  | { readonly kind: 'custom'; readonly hostname: string }
  | { readonly kind: 'invalid' };

/** Request headers the proxy owns. Inbound values from clients are always removed first. */
export const INTERNAL_HEADER_PREFIX = 'x-jadarat-';
export const HOST_KIND_HEADER = 'x-jadarat-host-kind';
export const HOST_REF_HEADER = 'x-jadarat-host-ref';

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

export function classifyHost(
  hostHeader: string | null,
  baseDomain: string | undefined,
): HostClassification {
  if (!hostHeader) return { kind: 'invalid' };
  const hostname = stripPort(hostHeader.trim().toLowerCase()).replace(/\.$/, '');
  if (LOCAL_HOSTS.has(hostname)) return { kind: 'platform' };
  if (!HOSTNAME_RE.test(hostname)) return { kind: 'invalid' };

  const base = baseDomain?.trim().toLowerCase().replace(/\.$/, '');
  if (base) {
    if (hostname === base || hostname === `www.${base}`) return { kind: 'platform' };
    if (hostname.endsWith(`.${base}`)) {
      const label = hostname.slice(0, -(base.length + 1));
      return SLUG_RE.test(label) ? { kind: 'subdomain', slug: label } : { kind: 'invalid' };
    }
  }
  return { kind: 'custom', hostname };
}

/** Removes every client-supplied header in the proxy-owned namespace, then sets the classification. */
export function applyHostHeaders(headers: Headers, classification: HostClassification): void {
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith(INTERNAL_HEADER_PREFIX)) headers.delete(name);
  }
  headers.set(HOST_KIND_HEADER, classification.kind);
  if (classification.kind === 'subdomain') headers.set(HOST_REF_HEADER, classification.slug);
  if (classification.kind === 'custom') headers.set(HOST_REF_HEADER, classification.hostname);
}
