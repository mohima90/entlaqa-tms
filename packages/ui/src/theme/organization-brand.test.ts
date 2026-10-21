import { describe, expect, it } from 'vitest';
import { contrastRatio, mix, normalizeHex, relativeLuminance } from './color';
import { BRAND_ROLES, NAV_ROLES } from './contract';
import { InvalidBrandColorError, deriveOrganizationBrand } from './organization-brand';
import { checkTheme, resolveThemeColors } from './resolve';
import { jadaratLmsTheme } from './themes/jadarat-lms';
import { jadaratTheme } from './themes/jadarat';

/** Deterministic pseudo-random colours (no flaky tests). */
function* seededColours(count: number, seed = 20261009): Generator<string> {
  let s = seed;
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    yield `#${(s % 0x1000000).toString(16).padStart(6, '0')}`;
  }
}

const grid: string[] = [];
for (const r of [0, 51, 102, 153, 204, 255])
  for (const g of [0, 51, 102, 153, 204, 255])
    for (const b of [0, 51, 102, 153, 204, 255])
      grid.push(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);

const EDGE_CASES = [
  '#FFFFFF',
  '#000000',
  '#FFFF00',
  '#FFD500',
  '#00FFFF',
  '#FF0000',
  '#00FF00',
  '#0000FF',
  '#808080',
  '#777777',
  '#F2F5F5',
  '#0E1415',
  '#0F665F',
  '#62B5AB',
  '#fff',
  '#123',
];

describe('organization brand colours (FR-ADM-07): never below WCAG 2.2 AA', () => {
  const colours = [...EDGE_CASES, ...grid, ...seededColours(300)];
  // Hundreds of full theme contrast checks: well under a second locally, but slower with coverage
  // instrumentation on a busy CI runner. Same assertions, explicit time budget instead of the 5 s default.
  const SWEEP_TIMEOUT_MS = 30_000;

  it(
    `passes every contract pair in light and dark for ${colours.length} colours`,
    () => {
      const failures: string[] = [];
      for (const primary of colours) {
        const brand = deriveOrganizationBrand({ primary });
        for (const c of checkTheme(jadaratTheme, brand.layer)) {
          if (!c.pass) failures.push(`${primary} ${c.mode} ${c.fg}/${c.bg} ${c.ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    },
    SWEEP_TIMEOUT_MS,
  );

  it(
    'passes with a different accent colour too',
    () => {
      const accents = [...seededColours(60, 7)];
      const primaries = [...seededColours(60, 11)];
      for (const [i, primary] of primaries.entries()) {
        const brand = deriveOrganizationBrand({ primary, accent: accents[i] });
        expect(brand.checks.every((c) => c.pass)).toBe(true);
        expect(brand.layer.light.accent).toBeDefined();
      }
    },
    SWEEP_TIMEOUT_MS,
  );

  it('works on top of every theme (including the Jadarat LMS slot)', () => {
    for (const primary of EDGE_CASES) {
      expect(() => deriveOrganizationBrand({ primary }, jadaratLmsTheme)).not.toThrow();
    }
  });
});

describe('organization brand colours: derivation', () => {
  it('keeps a colour that already passes, and reports none adjusted in light mode', () => {
    const brand = deriveOrganizationBrand({ primary: '#0F665F' });
    expect(brand.layer.light.primary).toBe('#0F665F');
    expect(brand.layer.light['on-primary']).toBe('#FFFFFF');
    expect(brand.adjustments.filter((a) => a.mode === 'light')).toEqual([]);
  });

  it('darkens a light colour for buttons in light mode and says so', () => {
    const brand = deriveOrganizationBrand({ primary: '#FFD500' });
    const used = brand.layer.light.primary ?? '#FFFFFF';
    expect(used).not.toBe('#FFD500');
    expect(contrastRatio('#FFFFFF', used)).toBeGreaterThanOrEqual(4.5);
    expect(brand.adjustments).toContainEqual(
      expect.objectContaining({ family: 'primary', mode: 'light', requested: '#FFD500', used }),
    );
    // In dark mode the yellow itself works as a fill, with very dark text.
    expect(brand.layer.dark.primary).toBe('#FFD500');
    expect(relativeLuminance(brand.layer.dark['on-primary'] ?? '#FFFFFF')).toBeLessThan(0.05);
  });

  it('gives hover a visibly different colour, even for black and white', () => {
    for (const primary of ['#000000', '#FFFFFF', '#0F665F']) {
      const { layer } = deriveOrganizationBrand({ primary });
      for (const mode of ['light', 'dark'] as const) {
        const fill = layer[mode].primary ?? '';
        const hover = layer[mode]['primary-hover'] ?? '';
        expect(contrastRatio(fill, hover)).toBeGreaterThanOrEqual(1.15);
      }
    }
  });

  it('sets only brand roles, the selected surface, the focus ring and the navigation', () => {
    const { layer } = deriveOrganizationBrand({ primary: '#7B2CBF' });
    const allowed = new Set<string>([
      ...BRAND_ROLES.primary,
      ...BRAND_ROLES.accent,
      ...NAV_ROLES,
      'surface-selected',
      'focus-ring',
    ]);
    for (const mode of ['light', 'dark'] as const) {
      expect(Object.keys(layer[mode]).filter((role) => !allowed.has(role))).toEqual([]);
      for (const value of Object.values(layer[mode])) expect(normalizeHex(value)).toBe(value);
    }
  });

  it('accepts #RGB and normalizes it; the accent defaults to the primary', () => {
    const brand = deriveOrganizationBrand({ primary: '#fa0' });
    expect(brand.input).toEqual({ primary: '#FFAA00', accent: '#FFAA00' });
    expect(brand.layer.light.accent).toBe(brand.layer.light.primary);
  });

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['red', '#12345', '#GGGGGG', '', 'rgb(0,0,0)', '#000; } body {']) {
      expect(() => deriveOrganizationBrand({ primary: bad })).toThrow(InvalidBrandColorError);
    }
    expect(() => deriveOrganizationBrand({ primary: '#000000', accent: 'blue' })).toThrow(/accent/);
  });

  it('changes nothing else in the theme', () => {
    const { layer } = deriveOrganizationBrand({ primary: '#C1121F' });
    for (const mode of ['light', 'dark'] as const) {
      const before = resolveThemeColors(jadaratTheme, mode);
      const after = resolveThemeColors(jadaratTheme, mode, layer);
      expect(after.danger).toBe(before.danger);
      expect(after.bg).toBe(before.bg);
      expect(after.text).toBe(before.text);
      expect(after.header).toBe(before.header);
      // Accent aliases follow the organization colour; the brand gradient is the organization's. In
      // light mode the navigation panel is that gradient (direction C); in dark mode it stays the
      // theme's dark surfaces and the current entry carries the gradient.
      expect(after.accent).toBe(after.primary);
      expect(after.brand).not.toBe(before.brand);
      if (mode === 'light') {
        expect(after.nav).toBe(after.brand);
        expect(after['nav-item-current']).toBe(before['nav-item-current']);
      } else {
        expect(after.nav).toBe(before.nav);
        expect(after['nav-item-current']).toBe(after.brand);
      }
    }
  });

  it('accepts colours only: no font (or any other) choice reaches the layer', () => {
    // PO, 14 Oct 2026 (BRD v2.9 FR-ADM-07): organizations always use Poppins / IBM Plex Sans Arabic.
    const input = { primary: '#0F6E5A', font: 'Comic Sans MS' } as unknown as { primary: string };
    const { layer } = deriveOrganizationBrand(input);
    for (const mode of ['light', 'dark'] as const) {
      expect(Object.keys(layer[mode]).filter((role) => role.includes('font'))).toEqual([]);
      for (const value of Object.values(layer[mode])) expect(normalizeHex(value)).toBe(value);
    }
  });
});

describe('organization brand colours: the brand gradient and the navigation (direction C)', () => {
  it('replaces the Jadarat gradient with the primary → its hover shade, with white text (light)', () => {
    // A colour that already passes is used as it is (#0F6E5A, the approved organization example).
    const { layer } = deriveOrganizationBrand({ primary: '#0F6E5A' });
    expect(layer.light.brand).toBe('#0F6E5A');
    expect(layer.light['brand-end']).toBe(layer.light['primary-hover']);
    expect(layer.light['on-brand']).toBe('#FFFFFF');
    // The panel is the gradient (aliases of the theme); the current entry stays a white pill with the
    // organization's colour as its text.
    expect(layer.light.nav).toBeUndefined();
    const colors = resolveThemeColors(jadaratTheme, 'light', layer);
    expect([colors.nav, colors['nav-end']]).toEqual(['#0F6E5A', layer.light['primary-hover']]);
    expect(colors['nav-item-current']).toBe('#FFFFFF');
    expect(colors['on-nav-item-current']).toBe('#0F6E5A');
  });

  it('runs from the primary to the accent when the organization has two colours', () => {
    const { layer } = deriveOrganizationBrand({ primary: '#0F6E5A', accent: '#7B2CBF' });
    for (const mode of ['light', 'dark'] as const) {
      expect(layer[mode].brand).toBe(layer[mode].primary);
      expect(layer[mode]['brand-end']).toBe(layer[mode].accent);
    }
  });

  it('keeps the brand gradient (navigation, buttons, view cards) readable and visible at BOTH ends, light and dark', () => {
    const accents = [...seededColours(40, 3)];
    const cases = [
      ...[...EDGE_CASES, ...grid].map((primary) => ({ primary })),
      ...[...seededColours(40, 5)].map((primary, i) => ({ primary, accent: accents[i] })),
    ];
    for (const input of cases) {
      const { layer } = deriveOrganizationBrand(input);
      for (const mode of ['light', 'dark'] as const) {
        const colors = resolveThemeColors(jadaratTheme, mode, layer);
        for (const end of [colors.brand, colors['brand-end']]) {
          expect(contrastRatio(colors['on-brand'], end)).toBeGreaterThanOrEqual(4.5);
          // Primary buttons and the current view card sit on the page background and on cards.
          expect(contrastRatio(end, colors.bg)).toBeGreaterThanOrEqual(3);
          expect(contrastRatio(end, colors.surface)).toBeGreaterThanOrEqual(3);
        }
        for (const panel of [colors.nav, colors['nav-end']]) {
          expect(contrastRatio(colors['on-nav'], panel)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(colors['nav-item-current'], panel)).toBeGreaterThanOrEqual(3);
          expect(contrastRatio(colors['nav-focus-ring'], panel)).toBeGreaterThanOrEqual(3);
        }
        expect(
          contrastRatio(colors['on-nav-item-current'], colors['nav-item-current']),
        ).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors['on-nav'], colors['nav-item-hover'])).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('darkens a light colour for the gradient in light mode, with dark text on it in dark mode', () => {
    const { layer } = deriveOrganizationBrand({ primary: '#FFD500' });
    expect(layer.light.brand).not.toBe('#FFD500');
    expect(contrastRatio('#FFFFFF', layer.light.brand ?? '')).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(layer.dark['on-brand'] ?? '#FFFFFF')).toBeLessThan(0.05);
  });

  it('the navigation focus ring is the entry text on the gradient (light) and the organization ring (dark)', () => {
    const { layer } = deriveOrganizationBrand({ primary: '#3A7CA5' });
    const light = resolveThemeColors(jadaratTheme, 'light', layer);
    expect(light['nav-focus-ring']).toBe(light['on-brand']);
    const dark = resolveThemeColors(jadaratTheme, 'dark', layer);
    expect(dark['nav-focus-ring']).toBe(dark['focus-ring']);
    expect(dark['focus-ring']).toBe(layer.dark['focus-ring']);
  });
});

describe('colour helpers', () => {
  it('mixes in sRGB and computes WCAG ratios', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(() => contrastRatio('nope', '#000000')).toThrow(/Not a hex colour/);
  });
});
