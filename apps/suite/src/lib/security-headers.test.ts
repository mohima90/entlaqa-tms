import { describe, expect, it } from 'vitest';
import {
  SECRET_URL_PAGES,
  STATIC_FALLBACK_CSP,
  buildContentSecurityPolicy,
  createNonce,
  secretUrlHeaders,
  staticSecurityHeaders,
} from './security-headers';

const directive = (csp: string, name: string) =>
  csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('buildContentSecurityPolicy', () => {
  const prod = buildContentSecurityPolicy({
    nonce: 'abc',
    isDev: false,
    upgradeInsecureRequests: true,
  });

  it('uses a nonce with strict-dynamic and no unsafe-inline/unsafe-eval for scripts in production', () => {
    expect(directive(prod, 'script-src')).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(prod).not.toContain('unsafe-eval');
    expect(directive(prod, 'style-src')).toBe("style-src 'self' 'nonce-abc'");
  });

  it('forbids framing, plugins and foreign form targets', () => {
    expect(directive(prod, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(prod, 'object-src')).toBe("object-src 'none'");
    expect(directive(prod, 'form-action')).toBe("form-action 'self'");
    expect(directive(prod, 'base-uri')).toBe("base-uri 'self'");
    expect(prod).toContain('upgrade-insecure-requests');
  });

  it('allows the Supabase origin (HTTPS + WSS) for connect-src only when configured', () => {
    const withSupabase = buildContentSecurityPolicy({
      nonce: 'n',
      isDev: false,
      upgradeInsecureRequests: false,
      supabaseUrl: 'https://proj.supabase.co',
    });
    expect(directive(withSupabase, 'connect-src')).toBe(
      "connect-src 'self' https://proj.supabase.co wss://proj.supabase.co",
    );
    expect(withSupabase).not.toContain('upgrade-insecure-requests');
    const local = buildContentSecurityPolicy({
      nonce: 'n',
      isDev: false,
      upgradeInsecureRequests: false,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    expect(directive(local, 'connect-src')).toContain('ws://127.0.0.1:54321');
    const bad = buildContentSecurityPolicy({
      nonce: 'n',
      isDev: false,
      upgradeInsecureRequests: false,
      supabaseUrl: 'not a url',
    });
    expect(directive(bad, 'connect-src')).toBe("connect-src 'self'");
  });

  it('relaxes only what React/Next dev tooling needs in development', () => {
    const dev = buildContentSecurityPolicy({
      nonce: 'n',
      isDev: true,
      upgradeInsecureRequests: false,
    });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(dev, 'style-src')).toContain("'unsafe-inline'");
  });
});

describe('createNonce', () => {
  it('returns unique base64 values with 128 bits of entropy', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });
});

describe('staticSecurityHeaders', () => {
  it('sets HSTS, nosniff, frame denial, referrer and permissions policies', () => {
    const map = Object.fromEntries(staticSecurityHeaders.map((h) => [h.key, h.value]));
    expect(map['Strict-Transport-Security']).toContain('max-age=63072000');
    // No preload: tenants bring custom domains (ADR 0002 §4).
    expect(map['Strict-Transport-Security']).not.toContain('preload');
    expect(map['X-Frame-Options']).toBe('DENY');
    expect(map['X-Content-Type-Options']).toBe('nosniff');
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(map['Permissions-Policy']).toContain('camera=()');
  });
});

describe('secretUrlHeaders (invitation links, T-M2-07)', () => {
  it('sends no referrer from the invitation pages, whose URL carries the token', () => {
    expect(SECRET_URL_PAGES).toBe('/:locale/invite/:path*');
    expect(Object.fromEntries(secretUrlHeaders.map((h) => [h.key, h.value]))).toEqual({
      'Referrer-Policy': 'no-referrer',
    });
  });
});

describe('STATIC_FALLBACK_CSP (responses that bypass the proxy)', () => {
  it('allows no scripts, framing, plugins or form targets', () => {
    expect(STATIC_FALLBACK_CSP).toContain("default-src 'none'");
    expect(STATIC_FALLBACK_CSP).toContain("frame-ancestors 'none'");
    expect(STATIC_FALLBACK_CSP).toContain("object-src 'none'");
    expect(STATIC_FALLBACK_CSP).toContain("form-action 'none'");
    expect(STATIC_FALLBACK_CSP).not.toMatch(/script-src|unsafe-/);
  });
});
