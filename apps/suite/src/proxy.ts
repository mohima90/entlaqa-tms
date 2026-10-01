/**
 * Request proxy (Next.js 16 convention, formerly "middleware"; runs on the Node.js runtime).
 *
 * Responsibilities (BRD Appendix H.2, ADR 0002 §4, ADR 0003 §2):
 *  1. on EVERY request path (pages, /api, files with an extension): remove client-supplied internal
 *     headers (`x-jadarat-*`, `x-nonce`), set the host classification and a per-request CSP nonce
 *  2. host → tenant resolution (placeholder classification; DB lookup in T-M1-D03)
 *  3. locale routing (/ar default, /en) via next-intl — page paths only
 *  4. Supabase session refresh on page requests (lib/session-refresh.ts, T-M1-D03)
 * It makes NO authorization decisions: pages verify the session themselves and fail closed.
 * Only `/_next/static/*` (immutable build assets) bypasses the proxy; next.config.ts gives those a
 * strict static CSP.
 */
import { routing } from '@jadarat/platform-i18n/routing';
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { INTERNAL_HEADER_PREFIX, applyHostHeaders, classifyHost } from './lib/host-tenant';
import { NONCE_HEADER, buildContentSecurityPolicy, createNonce } from './lib/security-headers';
import { applySessionCookies, refreshSessionCookies } from './lib/session-refresh';

const handleI18nRouting = createMiddleware(routing);

/** How Next.js encodes request-header overrides on a proxy response (NextResponse `request.headers`). */
const OVERRIDE_HEADERS = 'x-middleware-override-headers';
const OVERRIDE_PREFIX = 'x-middleware-request-';

function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  return request.nextUrl.protocol === 'https:' || forwarded?.split(',')[0]?.trim() === 'https';
}

/** Page routes get locale handling; API routes, Next/Vercel internals and files do not. */
export function isLocaleRouted(pathname: string): boolean {
  return !/^\/(api|_next|_vercel)(\/|$)/.test(pathname) && !pathname.includes('.');
}

function isProxyOwned(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(INTERNAL_HEADER_PREFIX) || lower === NONCE_HEADER;
}

/**
 * Makes `headers` (already scrubbed and set by the proxy) the request headers the app receives,
 * whatever the downstream handler returned: next-intl passes its own copy on next/rewrite (plus its
 * locale header), but returns a bare NextResponse.next() when the path cannot be decoded — which would
 * otherwise forward the ORIGINAL client headers. Headers next-intl added are kept, except any in the
 * proxy-owned namespace. Redirects are not rendered and need no request headers.
 */
export function forwardRequestHeaders(response: NextResponse, headers: Headers): void {
  const continues =
    response.headers.has('x-middleware-next') || response.headers.has('x-middleware-rewrite');
  if (!continues) return;

  const merged = new Headers(headers);
  for (const name of response.headers.get(OVERRIDE_HEADERS)?.split(',') ?? []) {
    const value = response.headers.get(`${OVERRIDE_PREFIX}${name}`);
    if (name && value !== null && !merged.has(name) && !isProxyOwned(name)) merged.set(name, value);
  }
  for (const name of [...response.headers.keys()]) {
    if (name.startsWith(OVERRIDE_PREFIX)) response.headers.delete(name);
  }
  const names: string[] = [];
  for (const [name, value] of merged) {
    response.headers.set(`${OVERRIDE_PREFIX}${name}`, value);
    names.push(name);
  }
  response.headers.set(OVERRIDE_HEADERS, names.join(','));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Rotated session cookies are applied to the request first, so the copied headers carry them.
  const sessionCookies = isLocaleRouted(request.nextUrl.pathname)
    ? await refreshSessionCookies(request)
    : { cookies: [], headers: {} };
  const response = routeRequest(request);
  applySessionCookies(response, sessionCookies);
  return response;
}

/** Header scrubbing, CSP and locale routing (synchronous part of the proxy). */
export function routeRequest(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    upgradeInsecureRequests: isHttps(request),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  // 1. Scrub + set proxy-owned request headers (every path).
  const headers = new Headers(request.headers);
  const host = request.headers.get('host') ?? request.nextUrl.host;
  applyHostHeaders(headers, classifyHost(host, process.env.JADARAT_BASE_DOMAIN));
  headers.set(NONCE_HEADER, nonce);
  // Next.js reads the nonce from the request CSP header and applies it to its scripts and styles.
  headers.set('content-security-policy', csp);

  let response: NextResponse;
  if (isLocaleRouted(request.nextUrl.pathname)) {
    // next-intl only reads URL, headers and cookies; the original body is forwarded by Next.js itself.
    response = handleI18nRouting(new NextRequest(request.url, { headers, method: request.method }));
    forwardRequestHeaders(response, headers);
  } else {
    response = NextResponse.next({ request: { headers } });
  }
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // Every request except immutable build assets (/_next/static), which get the static fallback CSP
  // from next.config.ts. /api, /_next/image and files with an extension DO pass the proxy.
  matcher: ['/((?!_next/static/).*)'],
};
