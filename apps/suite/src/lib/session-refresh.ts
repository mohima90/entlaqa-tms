import 'server-only';
import {
  type CookieMethodsServer,
  createSupabaseServerClient,
} from '@jadarat/platform-db/supabase-server';
import type { NextRequest, NextResponse } from 'next/server';

type CookieWrite = Parameters<NonNullable<CookieMethodsServer['setAll']>>[0][number];

/** Rotated cookies plus the cache headers @supabase/ssr asks for when it sets auth cookies. */
export interface SessionCookieWrites {
  readonly cookies: readonly CookieWrite[];
  readonly headers: Readonly<Record<string, string>>;
}

const NONE: SessionCookieWrites = { cookies: [], headers: {} };

/** Supabase session cookies are named `sb-<project-ref>-auth-token` (possibly chunked: `.0`, `.1`, …). */
export function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name));
}

/**
 * Refreshes an expiring Supabase session (ADR 0003 §2) on page requests: getClaims() verifies the
 * access token and, when it has expired, rotates it with the refresh token. Server Components cannot
 * write cookies, so the proxy is where rotated tokens are persisted; without it every page would
 * re-use the old refresh token and trip refresh-token reuse detection.
 *
 * Rotated cookies are applied to the REQUEST (so this render sees the new session) and returned for
 * the RESPONSE. This makes no authorization decision: pages verify claims themselves and fail closed.
 * The browser's User-Agent goes to Auth with the refresh: Auth records it on the session at every refresh,
 * and the session lists show it (T-M2-10) — never the server's own.
 */
export async function refreshSessionCookies(
  request: NextRequest,
  createClient: typeof createSupabaseServerClient = createSupabaseServerClient,
): Promise<SessionCookieWrites> {
  if (!hasSessionCookie(request)) return NONE;
  const cookies: CookieWrite[] = [];
  const headers: Record<string, string> = {};
  const supabase = createClient(
    {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, cacheHeaders) => {
        for (const cookie of toSet) {
          cookies.push(cookie);
          request.cookies.set(cookie.name, cookie.value);
        }
        Object.assign(headers, cacheHeaders);
      },
    },
    undefined,
    { userAgent: request.headers.get('user-agent') },
  );
  if (!supabase) return NONE;
  try {
    await supabase.auth.getClaims();
  } catch {
    // Fail open here only: the page's own verification (getClaims/getUser) fails closed.
  }
  return { cookies, headers };
}

/** Applies rotated session cookies to the response; such responses must never be cached. */
export function applySessionCookies(response: NextResponse, writes: SessionCookieWrites): void {
  if (writes.cookies.length === 0) return;
  for (const { name, value, options } of writes.cookies) response.cookies.set(name, value, options);
  for (const [name, value] of Object.entries(writes.headers)) response.headers.set(name, value);
  // Whatever @supabase/ssr suggested, a response carrying session cookies is never cacheable.
  response.headers.set('cache-control', 'private, no-store');
}
