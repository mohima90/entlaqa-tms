import { describe, expect, it, vi } from 'vitest';
import {
  BRAND_IMAGE_LIMITS,
  type BrandImageDeps,
  brandImageHeaders,
  brandImageResponse,
  matchesEtag,
} from './brand-asset-route';

vi.mock('@jadarat/platform-db', () => ({
  isDatabaseConfigured: () => false,
  publicBrandAsset: vi.fn(),
  publicBrandAssetMeta: vi.fn(),
  rateLimitStore: { hit: vi.fn() },
}));

const ASSET = '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d';
const SHA = 'a'.repeat(64);
const png = {
  contentType: 'image/png',
  content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  sha256: SHA,
};
const allowed = { allowed: true, remaining: 10, retryAfterSeconds: 0, ref: 'rk_x' };

function deps(overrides: Partial<BrandImageDeps> = {}) {
  const value = {
    configured: () => true,
    load: vi.fn(() => Promise.resolve<typeof png | null>(png)),
    loadMeta: vi.fn(() =>
      Promise.resolve<{ contentType: string; sha256: string; byteSize: number } | null>({
        contentType: 'image/png',
        sha256: SHA,
        byteSize: 4,
      }),
    ),
    hit: vi.fn(() => Promise.resolve(allowed)),
    warn: vi.fn(),
    ...overrides,
  };
  return value;
}

const get = (headers: Record<string, string> = {}) =>
  new Request(`https://raya.example.test/api/brand/${ASSET}`, { headers });

describe('/api/brand/<id> (WP-ADM-02, public)', () => {
  it('serves a published copy inline, typed, cached for a day, embeddable, never sniffed or run', async () => {
    const d = deps();
    const response = await brandImageResponse(get(), ASSET, d);
    expect(response.status).toBe(200);
    expect(d.load).toHaveBeenCalledWith(ASSET);
    expect(d.loadMeta).not.toHaveBeenCalled();
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=86400');
    expect(response.headers.get('cdn-cache-control')).toBe('public, max-age=86400');
    expect(response.headers.get('cache-control')).not.toContain('immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('etag')).toBe(`"${SHA}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png.content);
  });

  it('a revalidation of the same copy is a 304 from the metadata: the bytes are never read', async () => {
    const d = deps();
    const response = await brandImageResponse(get({ 'if-none-match': `W/"${SHA}"` }), ASSET, d);
    expect(response.status).toBe(304);
    expect(d.loadMeta).toHaveBeenCalledWith(ASSET);
    expect(d.load).not.toHaveBeenCalled();
    expect(d.hit).not.toHaveBeenCalled();
    expect(response.headers.get('etag')).toBe(`"${SHA}"`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=86400');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(await response.arrayBuffer()).toHaveProperty('byteLength', 0);
  });

  it('another validator gets the image; a removed copy is a 404 even when revalidated', async () => {
    const d = deps();
    expect((await brandImageResponse(get({ 'if-none-match': '"b"' }), ASSET, d)).status).toBe(200);
    const removed = deps({ loadMeta: vi.fn(() => Promise.resolve(null)) });
    const response = await brandImageResponse(get({ 'if-none-match': `"${SHA}"` }), ASSET, removed);
    expect(response.status).toBe(404);
    expect(removed.load).not.toHaveBeenCalled();
  });

  it('matches If-None-Match lists, weak validators and *', () => {
    expect(matchesEtag(`"x", W/"${SHA}"`, SHA)).toBe(true);
    expect(matchesEtag('*', SHA)).toBe(true);
    expect(matchesEtag(SHA, SHA)).toBe(false); // unquoted: not a validator
    expect(matchesEtag(null, SHA)).toBe(false);
  });

  it('limits full answers per client (its address, hashed), more for visitors without one', async () => {
    vi.stubEnv('JADARAT_CLIENT_IP_HEADER', 'x-real-ip');
    const hit = vi.fn((_subject: Uint8Array, _limit: unknown) => Promise.resolve(allowed));
    const d = deps({ hit });
    await brandImageResponse(get({ 'x-real-ip': '192.0.2.7' }), ASSET, d);
    await brandImageResponse(get(), ASSET, d);
    vi.unstubAllEnvs();
    const calls = hit.mock.calls;
    const [known, unknown] = calls;
    expect(known?.[0]).toHaveLength(32);
    expect(Buffer.from(known?.[0] ?? []).toString('latin1')).not.toContain('192.0.2.7');
    expect(known?.[1]).toEqual(BRAND_IMAGE_LIMITS.client);
    expect(unknown?.[1]).toEqual(BRAND_IMAGE_LIMITS.shared);
    expect(Buffer.from(known?.[0] ?? [])).not.toEqual(Buffer.from(unknown?.[0] ?? []));
    expect(BRAND_IMAGE_LIMITS.shared.max).toBeGreaterThan(BRAND_IMAGE_LIMITS.client.max);
  });

  it('past the budget: 429 with Retry-After, the bytes are not read, logged without the address', async () => {
    const d = deps({
      hit: vi.fn(() =>
        Promise.resolve({ allowed: false, remaining: 0, retryAfterSeconds: 42, ref: 'rk_y' }),
      ),
    });
    const response = await brandImageResponse(get(), ASSET, d);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(d.load).not.toHaveBeenCalled();
    expect(d.warn).toHaveBeenCalledWith('branding image requests limited', {
      action: 'platform.brand_image.rate_limited',
      outcome: 'denied',
      status: 429,
    });
  });

  it('the limiter unavailable: served (fails open) and logged', async () => {
    const d = deps({ hit: vi.fn(() => Promise.reject(new Error('db down'))) });
    expect((await brandImageResponse(get(), ASSET, d)).status).toBe(200);
    expect(d.warn).toHaveBeenCalledWith('branding image limiter unavailable; served', {
      action: 'platform.brand_image.rate_limit_unavailable',
    });
  });

  it('the same 404 for everything else, without asking the database for a malformed id', async () => {
    const d = deps({ load: vi.fn(() => Promise.resolve(null)) });
    for (const id of ['../../etc/passwd', `${ASSET}x`, 'ABC', '']) {
      const response = await brandImageResponse(get(), id, d);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    }
    expect(d.load).not.toHaveBeenCalled();
    expect(d.hit).not.toHaveBeenCalled();
    expect((await brandImageResponse(get(), ASSET, d)).status).toBe(404);
    expect((await brandImageResponse(get(), ASSET, deps({ configured: () => false }))).status).toBe(
      404,
    );
    const svg = deps({
      load: vi.fn(() => Promise.resolve({ ...png, contentType: 'image/svg+xml' })),
    });
    expect((await brandImageResponse(get(), ASSET, svg)).status).toBe(404);
  });

  it('without a database by default: 404', async () => {
    expect((await brandImageResponse(get(), ASSET)).status).toBe(404);
    expect(brandImageHeaders(png).get('content-length')).toBe('4');
  });
});
