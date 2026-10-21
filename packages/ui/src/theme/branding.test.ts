import { describe, expect, it } from 'vitest';
import {
  BRAND_PRESETS,
  JADARAT_BRAND,
  brandFromSettings,
  checkBrandContrast,
  emailBrandColors,
  isJadaratLook,
  parseBrandColor,
  storedBrandColors,
} from './branding';
import { WHITE, contrastRatio } from './color';
import { deriveOrganizationBrand } from './organization-brand';

describe('brand colour input (WP-ADM-02)', () => {
  it('accepts #RRGGBB and #RGB in any case and nothing else', () => {
    expect(parseBrandColor('#0f6e5a')).toBe('#0F6E5A');
    expect(parseBrandColor(' #abc ')).toBe('#AABBCC');
    for (const bad of ['0F6E5A', '#0F6E5', '#0F6E5AZ', 'red', '#0F6E5A;}', 'rgb(1,2,3)', '', '#']) {
      expect(parseBrandColor(bad)).toBeNull();
    }
  });
});

describe('the Jadarat look', () => {
  it('is no colours, or the Jadarat pair with the gradient', () => {
    expect(isJadaratLook({ primary: null, secondary: null, gradient: true })).toBe(true);
    expect(isJadaratLook({ primary: '#2f4858', secondary: '#33658a', gradient: true })).toBe(true);
    expect(isJadaratLook({ ...JADARAT_BRAND, gradient: false })).toBe(false);
    expect(isJadaratLook({ primary: '#0F5E4E', secondary: '#13806A', gradient: true })).toBe(false);
  });

  it('stores nothing for it (reset = the shipped theme exactly) and no layer', () => {
    expect(storedBrandColors({ ...JADARAT_BRAND, gradient: true })).toBeNull();
    expect(brandFromSettings({ primary: null, secondary: null, gradient: true })).toBeNull();
    expect(emailBrandColors({ primary: null, secondary: null, gradient: true })).toBeNull();
  });

  it('the first preset is the Jadarat pair', () => {
    expect(BRAND_PRESETS[0]).toEqual({ id: 'jadarat', ...JADARAT_BRAND });
  });
});

describe('stored colours', () => {
  it('upper-cases, and keeps one colour without the gradient', () => {
    expect(storedBrandColors({ primary: '#0f5e4e', secondary: '#13806a', gradient: true })).toEqual(
      {
        primary: '#0F5E4E',
        secondary: '#13806A',
      },
    );
    expect(
      storedBrandColors({ primary: '#0F5E4E', secondary: '#13806A', gradient: false }),
    ).toEqual({
      primary: '#0F5E4E',
      secondary: '#0F5E4E',
    });
  });

  it('a missing secondary colour is the primary one', () => {
    expect(storedBrandColors({ primary: '#7A1F2B', secondary: null, gradient: true })).toEqual({
      primary: '#7A1F2B',
      secondary: '#7A1F2B',
    });
  });
});

describe('contrast check (WCAG 2.2 AA, BR-BRD-c)', () => {
  it('passes for every preset: white text on both ends, the colour as text on white', () => {
    for (const preset of BRAND_PRESETS) {
      const checks = checkBrandContrast({ ...preset, gradient: true });
      expect(checks.map((c) => c.id)).toEqual([
        'textOnPrimary',
        'textOnSecondary',
        'primaryOnWhite',
      ]);
      expect(
        checks.every((c) => c.pass),
        preset.id,
      ).toBe(true);
    }
  });

  it('warns about a light colour, with the real ratio', () => {
    const checks = checkBrandContrast({ primary: '#FFD500', secondary: '#FFE866', gradient: true });
    const onPrimary = checks.find((c) => c.id === 'textOnPrimary');
    expect(onPrimary?.pass).toBe(false);
    expect(onPrimary?.ratio).toBeCloseTo(contrastRatio(WHITE, '#FFD500'), 5);
    expect(checks.find((c) => c.id === 'primaryOnWhite')?.pass).toBe(false);
  });

  it('checks the secondary colour only with the gradient', () => {
    const on = checkBrandContrast({ primary: '#1E3A5F', secondary: '#FFFF00', gradient: true });
    expect(on.find((c) => c.id === 'textOnSecondary')?.pass).toBe(false);
    const off = checkBrandContrast({ primary: '#1E3A5F', secondary: '#FFFF00', gradient: false });
    expect(off.map((c) => c.id)).toEqual(['textOnPrimary', 'primaryOnWhite']);
    expect(off.every((c) => c.pass)).toBe(true);
  });

  it('decides on the exact ratio at 4.5 : 1', () => {
    // #767676 on white is 4.54 : 1 (passes); #777777 is 4.48 : 1 (fails).
    expect(
      checkBrandContrast({ primary: '#767676', secondary: null, gradient: false })[0]?.pass,
    ).toBe(true);
    expect(
      checkBrandContrast({ primary: '#777777', secondary: null, gradient: false })[0]?.pass,
    ).toBe(false);
  });
});

describe('the product stays readable whatever was chosen', () => {
  it('a light colour still gives readable buttons and menu entries', () => {
    const brand = brandFromSettings({ primary: '#FFD500', secondary: '#FFE866', gradient: true });
    expect(brand).not.toBeNull();
    const light = brand?.layer.light ?? {};
    expect(contrastRatio(light['on-primary'] ?? '', light.primary ?? '')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(brand?.adjustments.length).toBeGreaterThan(0);
  });

  it('without the gradient, the brand gradient (menu, buttons) is one colour', () => {
    const brand = brandFromSettings({ primary: '#1E3A5F', secondary: '#2C5282', gradient: false });
    expect(brand?.layer.light.brand).toBe(brand?.layer.light['brand-end']);
    expect(brand?.layer.dark.brand).toBe(brand?.layer.dark['brand-end']);
    const withGradient = brandFromSettings({
      primary: '#1E3A5F',
      secondary: '#2C5282',
      gradient: true,
    });
    expect(withGradient?.layer.light.brand).not.toBe(withGradient?.layer.light['brand-end']);
  });

  it('a gradient-off brand is checked like any other (no failure thrown)', () => {
    for (const primary of ['#FFFFFF', '#000000', '#FFFF00', '#00FF00', '#808080']) {
      expect(() => deriveOrganizationBrand({ primary, gradient: false })).not.toThrow();
    }
  });
});

describe('e-mail colours (FR-NTF-02)', () => {
  it('a button with white text and links that read on white', () => {
    for (const primary of ['#FFD500', '#0F5E4E', '#000000', '#FFFFFF', '#33658A']) {
      const colors = emailBrandColors({ primary, secondary: primary, gradient: false });
      expect(colors).not.toBeNull();
      expect(contrastRatio(WHITE, colors?.action ?? '')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors?.link ?? '', WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(colors?.action).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
