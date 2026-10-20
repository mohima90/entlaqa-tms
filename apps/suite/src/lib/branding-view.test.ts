import { describe, expect, it } from 'vitest';
import {
  JADARAT_BRAND,
  brandAssetPath,
  brandCss,
  brandProperties,
  contrastChecks,
  deriveBrandingColors,
  sniffImageType,
  websiteLooksValid,
} from './branding-view';
import { BRAND_COOKIE, parseBrandCookie, signInBrandSlug } from './sign-in-brand-cookie';

const ASSET = '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d';
const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('brand CSS for the shell and the sign-in page (WP-ADM-02)', () => {
  it('nothing for the Jadarat look', () => {
    expect(brandCss(null)).toBeNull();
    expect(brandCss({ primaryColor: null, secondaryColor: null, useGradient: true })).toBeNull();
    expect(
      brandCss({
        primaryColor: JADARAT_BRAND.primary,
        secondaryColor: JADARAT_BRAND.secondary,
        useGradient: true,
      }),
    ).toBeNull();
  });

  it("the organization's colours as custom properties, light and dark, nothing else", () => {
    const css = brandCss({ primaryColor: '#7A1F2B', secondaryColor: '#9B2C3A', useGradient: true });
    expect(css).toContain(':root {');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain('--color-nav-item-current:');
    expect(css).not.toContain('<');
    expect(css?.match(/--[a-z-]+: [^;]+;/g)?.every((line) => /: #[0-9A-F]{6};$/.test(line))).toBe(
      true,
    );
  });

  it('a stored value that is not a colour falls back to the Jadarat look', () => {
    expect(
      brandCss({ primaryColor: 'red;}', secondaryColor: '#000000', useGradient: true }),
    ).toBeNull();
  });
});

describe('the live preview', () => {
  it('sets every colour role, the Jadarat ones after a reset too', () => {
    const jadarat = brandProperties(
      {
        primaryColor: JADARAT_BRAND.primary,
        secondaryColor: JADARAT_BRAND.secondary,
        useGradient: true,
      },
      'light',
    );
    const burgundy = brandProperties(
      { primaryColor: '#7A1F2B', secondaryColor: '#9B2C3A', useGradient: true },
      'light',
    );
    expect(Object.keys(jadarat)).toEqual(Object.keys(burgundy));
    expect(jadarat['--color-nav-item-current']).toBe('#2F4858');
    expect(burgundy['--color-nav-item-current']).not.toBe(jadarat['--color-nav-item-current']);
    const dark = brandProperties(
      { primaryColor: '#7A1F2B', secondaryColor: '#9B2C3A', useGradient: false },
      'dark',
    );
    expect(dark['--color-nav-item-current']).toBe(dark['--color-nav-item-current-end']);
    expect(
      brandProperties({ primaryColor: 'nope', secondaryColor: 'nope', useGradient: true }, 'light'),
    ).toEqual(jadarat);
  });

  it('the contrast check of the chosen colours', () => {
    expect(
      contrastChecks({
        primaryColor: '#FFD500',
        secondaryColor: '#FFD500',
        useGradient: false,
      }).some((c) => !c.pass),
    ).toBe(true);
    expect(
      contrastChecks({
        primaryColor: '#1E3A5F',
        secondaryColor: '#2C5282',
        useGradient: true,
      }).every((c) => c.pass),
    ).toBe(true);
  });

  it('what is stored and the e-mail colours', () => {
    expect(deriveBrandingColors({ ...JADARAT_BRAND, gradient: true })).toEqual({
      stored: null,
      email: null,
    });
    const derived = deriveBrandingColors({
      primary: '#7a1f2b',
      secondary: '#9b2c3a',
      gradient: false,
    });
    expect(derived.stored).toEqual({ primary: '#7A1F2B', secondary: '#7A1F2B' });
    expect(derived.email?.action).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('images', () => {
  it('links only public ids, same origin', () => {
    expect(brandAssetPath(ASSET)).toBe(`/api/brand/${ASSET}`);
    expect(brandAssetPath(null)).toBeNull();
    expect(brandAssetPath('../secret')).toBeNull();
    expect(brandAssetPath(`${ASSET}?x`)).toBeNull();
  });

  it('sniffs PNG, JPEG and WebP; SVG, GIF and others are refused', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(
      sniffImageType(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')])),
    ).toBe('image/webp');
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(ascii('GIF89a'))).toBeNull();
    expect(
      sniffImageType(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')])),
    ).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('website as typed', () => {
  it('empty or https with a host', () => {
    expect(websiteLooksValid('')).toBe(true);
    expect(websiteLooksValid(' https://www.example.com ')).toBe(true);
    expect(websiteLooksValid('http://www.example.com')).toBe(false);
    expect(websiteLooksValid('https://localhost')).toBe(false);
    expect(websiteLooksValid('javascript:alert(1)')).toBe(false);
    expect(websiteLooksValid('https://a.example/"x')).toBe(false);
    expect(websiteLooksValid('not a url')).toBe(false);
  });
});

describe('whose look the sign-in page shows', () => {
  it('the subdomain first, never a custom domain yet, else the remembered one', () => {
    expect(signInBrandSlug('subdomain', 'raya', 'other')).toBe('raya');
    expect(signInBrandSlug('subdomain', 'Bad Slug', 'other')).toBeNull();
    expect(signInBrandSlug('custom', 'tms.raya.example', 'raya')).toBeNull();
    expect(signInBrandSlug('platform', null, 'raya')).toBe('raya');
    expect(signInBrandSlug(null, null, undefined)).toBeNull();
  });

  it('a tampered cookie is ignored', () => {
    expect(BRAND_COOKIE).toBe('jadarat_brand');
    expect(parseBrandCookie("raya'; drop")).toBeNull();
    expect(parseBrandCookie('-raya')).toBeNull();
    expect(parseBrandCookie('raya-2')).toBe('raya-2');
  });
});
