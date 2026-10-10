import { describe, expect, it } from 'vitest';
import { contrastRatio, mix, normalizeHex, relativeLuminance } from './color';
import { BRAND_ROLES } from './contract';
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

  it('sets only brand roles, the selected surface and the focus ring', () => {
    const { layer } = deriveOrganizationBrand({ primary: '#7B2CBF' });
    const allowed = new Set<string>([
      ...BRAND_ROLES.primary,
      ...BRAND_ROLES.accent,
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
      // Shell and accent aliases follow the organization colour.
      expect(after['nav-item-current']).toBe(after['surface-selected']);
    }
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
