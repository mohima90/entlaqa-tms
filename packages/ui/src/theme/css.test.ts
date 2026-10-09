import { describe, expect, it } from 'vitest';
import { brandLayerCss, fontStack, themeCss, tokenCss } from './css';
import { jadaratTheme } from './themes/jadarat';
import { parseTokenCss, resolveTokens } from './resolve-css';

describe('theme CSS generation', () => {
  it('quotes font names like the design tokens (generic and one-word names bare)', () => {
    expect(fontStack(['IBM Plex Sans Arabic', 'Tahoma', 'SFMono-Regular', 'system-ui'])).toBe(
      '"IBM Plex Sans Arabic", Tahoma, "SFMono-Regular", system-ui',
    );
    expect(() => fontStack(['Evil"; } body { x: y'])).toThrow(/not allowed/);
  });

  it('turns aliases into var() references and refuses anything that is not a token value', () => {
    expect(tokenCss('{color.brand.600}')).toBe('var(--color-brand-600)');
    expect(tokenCss('{semantic.surface}')).toBe('var(--color-surface)');
    expect(tokenCss('#0F665F')).toBe('#0F665F');
    expect(tokenCss('rgba(0, 0, 0, 0.65)')).toBe('rgba(0, 0, 0, 0.65)');
    expect(() => tokenCss('red; } body { display: none')).toThrow(/Not a token value/);
  });

  it('writes the light block and both dark switches with the same selectors as every theme', () => {
    const css = themeCss(jadaratTheme);
    expect(css).toContain(':root {');
    expect(css).toContain('@media (prefers-color-scheme: dark) {');
    expect(css).toContain(':root:not([data-theme="light"]) {');
    expect(css).toContain(':root[data-theme="dark"] {');
  });

  it('writes an organization layer that wins over the theme it is loaded after', () => {
    const layer = brandLayerCss({
      light: { primary: '#123456' },
      dark: { primary: '#abcdef' },
    });
    const declarations = parseTokenCss(themeCss(jadaratTheme), layer);
    expect(resolveTokens(declarations, { lang: 'ar' })['--color-primary']).toBe('#123456');
    expect(resolveTokens(declarations, { lang: 'ar', dataTheme: 'dark' })['--color-primary']).toBe(
      '#abcdef',
    );
    expect(resolveTokens(declarations, { lang: 'ar', prefersDark: true })['--color-primary']).toBe(
      '#abcdef',
    );
    // Roles the layer does not set keep the theme's values.
    expect(resolveTokens(declarations, { lang: 'ar' })['--color-danger']).toBe('#b42318');
  });

  it('only ever writes #RRGGBB values (organization input cannot inject CSS)', () => {
    expect(brandLayerCss({ light: {}, dark: {} })).toBe(':root {\n\n}\n');
    expect(() =>
      brandLayerCss({
        light: { primary: '#000; } body { display: none } :root {' },
        dark: {},
      }),
    ).toThrow(/not #RRGGBB/);
  });
});
