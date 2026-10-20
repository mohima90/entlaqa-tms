import { describe, expect, it } from 'vitest';
import {
  BRAND_IMAGE_MAX_SIDE,
  BRAND_IMAGE_PURPOSES,
  BRAND_IMAGE_SLOTS,
  brandImageMaxBytes,
  checkBrandImageContent,
  checkBrandImageDimensions,
  checkBrandImageUpload,
  isBrandImageSlot,
  prepareBrandImage,
} from './brand-images';
import { EXE, PNG, bytes, pngChunk, pngImage } from './test-fixtures';

const utf8 = (text: string) => new TextEncoder().encode(text);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1);
/** RIFF....WEBPVP8 — the WebP signature. */
const WEBP = new Uint8Array([
  ...utf8('RIFF'),
  0x24,
  0,
  0,
  0,
  ...utf8('WEBPVP8 '),
  0x18,
  0,
  0,
  0,
  0x30,
  0x01,
  0,
  0x9d,
  0x01,
  0x2a,
]);
const GIF = utf8('GIF89a\u0001\u0000\u0001\u0000');
const SVG = utf8(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>',
);

describe('branding image slots (WP-ADM-02)', () => {
  it('map to their purposes with Kawadir limits', () => {
    expect(BRAND_IMAGE_SLOTS).toEqual(['logo', 'favicon', 'sign_in_image']);
    expect(BRAND_IMAGE_PURPOSES.favicon).toBe('platform.brand_favicon');
    expect(brandImageMaxBytes('logo')).toBe(2 * 1024 * 1024);
    expect(brandImageMaxBytes('favicon')).toBe(500 * 1024);
    expect(brandImageMaxBytes('sign_in_image')).toBe(5 * 1024 * 1024);
    expect(isBrandImageSlot('logo')).toBe(true);
    expect(isBrandImageSlot('toString')).toBe(false);
    expect(isBrandImageSlot('banner')).toBe(false);
  });
});

describe('checkBrandImageUpload (by name and size, before the upload)', () => {
  it('accepts PNG, JPEG and WebP names within the limit', () => {
    expect(checkBrandImageUpload('logo', 'logo.png', 1000)).toBeNull();
    expect(checkBrandImageUpload('logo', 'شعار.JPG', 1000)).toBeNull();
    expect(checkBrandImageUpload('sign_in_image', 'welcome.webp', 5 * 1024 * 1024)).toBeNull();
  });

  it('refuses SVG, GIF, ICO, HTML and names without an extension', () => {
    for (const name of [
      'logo.svg',
      'logo.gif',
      'favicon.ico',
      'logo.html',
      'logo',
      'logo.png.exe',
    ]) {
      expect(checkBrandImageUpload('favicon', name, 100), name).toBe('TYPE_NOT_ALLOWED');
    }
  });

  it('refuses empty and too large files (favicon 500 KB)', () => {
    expect(checkBrandImageUpload('favicon', 'icon.png', 0)).toBe('EMPTY');
    expect(checkBrandImageUpload('favicon', 'icon.png', 500 * 1024 + 1)).toBe('TOO_LARGE');
    expect(checkBrandImageUpload('favicon', 'icon.png', 500 * 1024)).toBeNull();
    expect(checkBrandImageUpload('logo', 'logo.png', Number.NaN)).toBe('EMPTY');
  });
});

describe('checkBrandImageContent (by content: sniffing, never the name)', () => {
  it('detects PNG, JPEG and WebP from their bytes', async () => {
    expect(await checkBrandImageContent('logo', PNG)).toEqual({ type: 'image/png' });
    expect(await checkBrandImageContent('logo', JPEG)).toEqual({ type: 'image/jpeg' });
    expect(await checkBrandImageContent('favicon', WEBP)).toEqual({ type: 'image/webp' });
  });

  it('refuses an SVG (scripts), a GIF and an executable renamed as an image', async () => {
    expect(await checkBrandImageContent('logo', SVG)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    expect(await checkBrandImageContent('logo', GIF)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    expect(await checkBrandImageContent('logo', EXE)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    expect(await checkBrandImageContent('logo', utf8('<html><body>hi</body></html>'))).toEqual({
      refused: 'TYPE_NOT_ALLOWED',
    });
  });

  it('refuses empty and oversized content', async () => {
    expect(await checkBrandImageContent('logo', new Uint8Array(0))).toEqual({ refused: 'EMPTY' });
    const big = new Uint8Array(500 * 1024 + 1);
    big.set(PNG);
    expect(await checkBrandImageContent('favicon', big)).toEqual({ refused: 'TOO_LARGE' });
  });
});

describe('checkBrandImageDimensions (security review L8)', () => {
  it('caps each side at 4096 px, the browser icon at 512 px', () => {
    expect(BRAND_IMAGE_MAX_SIDE).toEqual({ logo: 4096, favicon: 512, sign_in_image: 4096 });
    expect(checkBrandImageDimensions('logo', { width: 4096, height: 4096 })).toBeNull();
    expect(checkBrandImageDimensions('logo', { width: 4097, height: 10 })).toBe(
      'DIMENSIONS_TOO_LARGE',
    );
    expect(checkBrandImageDimensions('favicon', { width: 512, height: 512 })).toBeNull();
    expect(checkBrandImageDimensions('favicon', { width: 64, height: 513 })).toBe(
      'DIMENSIONS_TOO_LARGE',
    );
    expect(checkBrandImageDimensions('sign_in_image', null)).toBe('MALFORMED');
  });
});

describe('prepareBrandImage (before a copy goes public)', () => {
  it('removes the metadata and reports the type and size', async () => {
    const tagged = pngImage(200, 80, [pngChunk('eXIf', utf8('MM\u0000*GPSLatitude 24.7 N'))]);
    const prepared = await prepareBrandImage('logo', tagged);
    expect(prepared).toEqual({
      type: 'image/png',
      content: pngImage(200, 80),
      size: { width: 200, height: 80 },
    });
  });

  it('refuses images larger than the cap in pixels (a 5000 px logo, a 1024 px icon)', async () => {
    expect(await prepareBrandImage('logo', pngImage(5000, 10))).toEqual({
      refused: 'DIMENSIONS_TOO_LARGE',
    });
    expect(await prepareBrandImage('favicon', pngImage(1024, 1024))).toEqual({
      refused: 'DIMENSIONS_TOO_LARGE',
    });
  });

  it('refuses truncated images and other types', async () => {
    expect(await prepareBrandImage('logo', PNG)).toEqual({ refused: 'MALFORMED' });
    expect(await prepareBrandImage('logo', SVG)).toEqual({ refused: 'TYPE_NOT_ALLOWED' });
    expect(await prepareBrandImage('logo', new Uint8Array(0))).toEqual({ refused: 'EMPTY' });
  });
});
