import { NextRequest, NextResponse } from 'next/server';
import type {
  CookieMethodsServer,
  createSupabaseServerClient,
} from '@jadarat/platform-db/supabase-server';
import { describe, expect, it, vi } from 'vitest';
import { applySessionCookies, hasSessionCookie, refreshSessionCookies } from './session-refresh';

const SESSION_COOKIE = 'sb-kgmhlmiwlbvdmalesexv-auth-token';

function request(cookie?: string) {
  return new NextRequest('https://app.example.test/ar/suite', {
    headers: cookie ? { cookie } : {},
  });
}

type SetAll = (c: unknown[], headers: Record<string, string>) => void;

function fakeClient(onGetClaims: (setAll: SetAll) => Promise<unknown>) {
  return vi.fn((cookies: CookieMethodsServer) => {
    expect(Array.isArray(cookies.getAll())).toBe(true);
    return {
      auth: {
        getClaims: () =>
          onGetClaims((c, h) => {
            void cookies.setAll?.(c as never, h);
          }),
      },
    } as never;
  }) as unknown as typeof createSupabaseServerClient;
}

describe('session refresh in the proxy (ADR 0003 §2)', () => {
  it('recognises Supabase session cookies, including chunked ones', () => {
    expect(hasSessionCookie(request(`${SESSION_COOKIE}=x`))).toBe(true);
    expect(hasSessionCookie(request(`${SESSION_COOKIE}.0=x; ${SESSION_COOKIE}.1=y`))).toBe(true);
    expect(hasSessionCookie(request('NEXT_LOCALE=ar; sb-other=1'))).toBe(false);
    expect(hasSessionCookie(request())).toBe(false);
  });

  it('does nothing (no Auth call) for anonymous requests', async () => {
    const create = fakeClient(() => Promise.resolve(null));
    expect(await refreshSessionCookies(request('NEXT_LOCALE=ar'), create)).toEqual({
      cookies: [],
      headers: {},
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('applies rotated cookies to the request and returns them for the response', async () => {
    const rotated = { name: SESSION_COOKIE, value: 'new-token', options: { httpOnly: true } };
    const create = fakeClient((setAll) => {
      setAll([rotated], { 'cache-control': 'private, no-cache', expires: '0' });
      return Promise.resolve({ data: { claims: {} }, error: null });
    });
    const req = request(`${SESSION_COOKIE}=old-token`);
    const writes = await refreshSessionCookies(req, create);
    expect(writes).toEqual({
      cookies: [rotated],
      headers: { 'cache-control': 'private, no-cache', expires: '0' },
    });
    expect(req.cookies.get(SESSION_COOKIE)?.value).toBe('new-token');
    expect(req.headers.get('cookie')).toContain('new-token');
  });

  it('fails open on Auth errors (the page verification fails closed) and without configuration', async () => {
    const throwing = fakeClient(() => Promise.reject(new Error('network')));
    const none = { cookies: [], headers: {} };
    expect(await refreshSessionCookies(request(`${SESSION_COOKIE}=x`), throwing)).toEqual(none);
    const unconfigured = vi.fn(() => null) as unknown as typeof createSupabaseServerClient;
    expect(await refreshSessionCookies(request(`${SESSION_COOKIE}=x`), unconfigured)).toEqual(none);
  });

  it('sets rotated cookies on the response and forbids caching it', () => {
    const response = NextResponse.next();
    applySessionCookies(response, {
      cookies: [
        { name: SESSION_COOKIE, value: 'new-token', options: { httpOnly: true, secure: true } },
      ],
      headers: { expires: '0', 'cache-control': 'public' },
    });
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe('new-token');
    expect(response.headers.get('expires')).toBe('0');
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    const untouched = NextResponse.next();
    applySessionCookies(untouched, { cookies: [], headers: {} });
    expect(untouched.headers.get('cache-control')).toBeNull();
  });
});
