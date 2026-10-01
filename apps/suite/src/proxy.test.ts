import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, forwardRequestHeaders, isLocaleRouted, routeRequest } from './proxy';

function run(url: string, headers: Record<string, string> = {}) {
  return routeRequest(new NextRequest(url, { headers }));
}

/** Request-header overrides the proxy forwards to the app (Next.js encodes them on the response). */
function forwarded(response: Response, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe('proxy', () => {
  it('redirects the root to the Arabic default locale', () => {
    const response = run('http://localhost:3000/');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/ar');
  });

  it('passes locale-prefixed routes through with a nonce-based CSP on request and response', () => {
    const response = run('http://localhost:3000/en/suite');
    const csp = response.headers.get('content-security-policy') ?? '';
    const nonce = forwarded(response, 'x-nonce');
    expect(response.status).toBe(200);
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce ?? ''}'`);
    expect(forwarded(response, 'content-security-policy')).toBe(csp);
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('upgrades insecure requests behind an HTTPS terminator', () => {
    const response = run('http://localhost:3000/ar', { 'x-forwarded-proto': 'https' });
    expect(response.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
  });

  it('never trusts client-supplied nonce or tenant headers', () => {
    const response = run('http://localhost:3000/ar/suite', {
      'x-nonce': 'attacker',
      'x-jadarat-host-ref': 'other-tenant',
    });
    expect(forwarded(response, 'x-nonce')).not.toBe('attacker');
    expect(forwarded(response, 'x-jadarat-host-ref')).toBeNull();
    expect(forwarded(response, 'x-jadarat-host-kind')).toBe('platform');
  });

  it('generates a fresh nonce per request', () => {
    const a = forwarded(run('http://localhost:3000/ar'), 'x-nonce');
    const b = forwarded(run('http://localhost:3000/ar'), 'x-nonce');
    expect(a).not.toBe(b);
  });

  const hostile = {
    'x-nonce': 'attacker',
    'x-jadarat-host-ref': 'other-tenant',
    'X-Jadarat-Host-Kind': 'subdomain',
    'x-jadarat-tenant-id': '22222222-2222-4222-8222-222222222222',
  };

  /** The proxy's request headers must be the ones the app receives, with nothing client-supplied. */
  function expectScrubbed(response: Response) {
    const overrides = (response.headers.get('x-middleware-override-headers') ?? '').split(',');
    expect(overrides).toContain('x-nonce');
    expect(overrides).toContain('x-jadarat-host-kind');
    expect(overrides).not.toContain('x-jadarat-host-ref');
    expect(overrides).not.toContain('x-jadarat-tenant-id');
    expect(forwarded(response, 'x-nonce')).not.toBe('attacker');
    expect(forwarded(response, 'x-jadarat-host-kind')).toBe('platform');
    expect(forwarded(response, 'x-jadarat-tenant-id')).toBeNull();
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`'nonce-${forwarded(response, 'x-nonce') ?? ''}'`);
  }

  it.each(['/api/health', '/api/hooks/lms/abc', '/icon.svg', '/favicon.ico', '/_next/image'])(
    'scrubs internal headers and sets the CSP on %s (no locale routing)',
    (path) => {
      const response = run(`http://localhost:3000${path}`, hostile);
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
      expectScrubbed(response);
    },
  );

  it('scrubs internal headers when next-intl cannot decode the path (its bare next() branch)', () => {
    // decodeURI throws on a truncated escape: next-intl returns NextResponse.next() without headers.
    const response = run('http://localhost:3000/ar/%E0%A4%A', hostile);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expectScrubbed(response);
  });

  it('keeps next-intl request headers on rewrites/next and never lets them override proxy headers', () => {
    const response = run('http://localhost:3000/en/suite', hostile);
    expectScrubbed(response);
    expect(forwarded(response, 'x-next-intl-locale')).toBe('en');

    const downstream = NextResponse.next({
      request: {
        headers: new Headers({
          'x-next-intl-locale': 'ar',
          'x-jadarat-host-ref': 'evil',
          'x-nonce': 'evil',
        }),
      },
    });
    forwardRequestHeaders(
      downstream,
      new Headers({ 'x-nonce': 'n1', 'x-jadarat-host-kind': 'platform' }),
    );
    expect(forwarded(downstream, 'x-nonce')).toBe('n1');
    expect(forwarded(downstream, 'x-next-intl-locale')).toBe('ar');
    expect(forwarded(downstream, 'x-jadarat-host-ref')).toBeNull();
    expect(downstream.headers.get('x-middleware-override-headers')?.split(',').sort()).toEqual([
      'x-jadarat-host-kind',
      'x-next-intl-locale',
      'x-nonce',
    ]);
  });

  it('leaves redirects alone (they are not rendered) but still sets the CSP', () => {
    const response = run('http://localhost:3000/', hostile);
    expect(response.status).toBe(307);
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('matches every path except immutable build assets', () => {
    const matcher = new RegExp(`^${config.matcher[0] ?? ''}$`);
    for (const path of [
      '/ar/suite',
      '/api/health',
      '/favicon.ico',
      '/icon.svg',
      '/_next/image',
      '/_vercel/x',
    ]) {
      expect(matcher.test(path), path).toBe(true);
    }
    expect(matcher.test('/_next/static/chunks/app.js')).toBe(false);
  });

  it('routes locales for page paths only', () => {
    expect(isLocaleRouted('/ar/suite')).toBe(true);
    expect(isLocaleRouted('/apiary')).toBe(true);
    expect(isLocaleRouted('/api')).toBe(false);
    expect(isLocaleRouted('/api/health')).toBe(false);
    expect(isLocaleRouted('/_next/image')).toBe(false);
    expect(isLocaleRouted('/icon.svg')).toBe(false);
  });
});

describe('proxy (async wrapper)', () => {
  it('routes like routeRequest and skips session refresh without session cookies', async () => {
    const { proxy } = await import('./proxy');
    const response = await proxy(new NextRequest('http://localhost:3000/ar/suite'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBeNull();
    const asset = await proxy(new NextRequest('http://localhost:3000/icon.svg'));
    expect(asset.headers.get('content-security-policy')).toBeTruthy();
  });
});
