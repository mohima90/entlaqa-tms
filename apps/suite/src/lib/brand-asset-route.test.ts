import { describe, expect, it, vi } from 'vitest';
import { brandImageHeaders, brandImageResponse } from './brand-asset-route';

vi.mock('@jadarat/platform-db', () => ({
  isDatabaseConfigured: () => false,
  publicBrandAsset: vi.fn(),
}));

const ASSET = '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d';
const png = {
  contentType: 'image/png',
  content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  sha256: 'a'.repeat(64),
};

describe('/api/brand/<id> (WP-ADM-02, public)', () => {
  it('serves a published copy inline, typed, cacheable, embeddable, never sniffed or run', async () => {
    const load = vi.fn(() => Promise.resolve(png));
    const response = await brandImageResponse(ASSET, { configured: () => true, load });
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith(ASSET);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('etag')).toBe(`"${'a'.repeat(64)}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png.content);
  });

  it('the same 404 for everything else, without asking the database for a malformed id', async () => {
    const load = vi.fn(() => Promise.resolve(null));
    for (const id of ['../../etc/passwd', `${ASSET}x`, 'ABC', '']) {
      const response = await brandImageResponse(id, { configured: () => true, load });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(load).not.toHaveBeenCalled();
    expect((await brandImageResponse(ASSET, { configured: () => true, load })).status).toBe(404);
    expect((await brandImageResponse(ASSET, { configured: () => false, load })).status).toBe(404);
    const svg = vi.fn(() => Promise.resolve({ ...png, contentType: 'image/svg+xml' }));
    expect((await brandImageResponse(ASSET, { configured: () => true, load: svg })).status).toBe(
      404,
    );
  });

  it('without a database by default: 404', async () => {
    expect((await brandImageResponse(ASSET)).status).toBe(404);
    expect(brandImageHeaders(png).get('content-length')).toBe('4');
  });
});
