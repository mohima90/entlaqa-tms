import { describe, expect, it } from 'vitest';
import { parseTokenCss, resolveTokens } from './resolve-css';

describe('resolveTokens (token CSS resolver used by the tests)', () => {
  const css = `
    /* comment */
    :root { --a: #ABCDEF; --b: var(--a); --c: 1px; color-scheme: light; }
    :root:lang(en), [lang="en"] { --c: 2px; }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --a: #000000; } }
    :root[data-theme="dark"] { --a: #111111; }
    :root { --d: var(--missing, fallback); }
    @media (prefers-reduced-motion: reduce) { :root { --c: 0px; } }
  `;
  const declarations = parseTokenCss(css);

  it('applies the cascade per context and substitutes var()', () => {
    expect(resolveTokens(declarations, { lang: 'ar' })).toEqual({
      '--a': '#abcdef',
      '--b': '#abcdef',
      '--c': '1px',
      '--d': 'fallback',
      'color-scheme': 'light',
    });
    expect(resolveTokens(declarations, { lang: 'en' })['--c']).toBe('2px');
    expect(resolveTokens(declarations, { lang: 'ar', prefersDark: true })['--b']).toBe('#000000');
    expect(
      resolveTokens(declarations, { lang: 'ar', prefersDark: true, dataTheme: 'light' })['--a'],
    ).toBe('#abcdef');
    expect(resolveTokens(declarations, { lang: 'ar', dataTheme: 'dark' })['--a']).toBe('#111111');
    expect(resolveTokens(declarations, { lang: 'ar', prefersReducedMotion: true })['--c']).toBe(
      '0px',
    );
    // A more specific selector still wins over a later media block, as in the browser.
    expect(resolveTokens(declarations, { lang: 'en', prefersReducedMotion: true })['--c']).toBe(
      '2px',
    );
  });

  it('keeps the later declaration when specificity ties (later sheets win)', () => {
    const layered = parseTokenCss(':root { --a: #111111; }', ':root { --a: #222222; }');
    expect(resolveTokens(layered, { lang: 'ar' })['--a']).toBe('#222222');
  });

  it('rejects anything it does not understand instead of skipping it', () => {
    expect(() => parseTokenCss('.x { --a: 1; }')).toThrow(/Unknown selector/);
    expect(() => parseTokenCss('@media print { :root { --a: 1; } }')).toThrow(/media query/);
    expect(() => parseTokenCss('@layer x { :root { --a: 1; } }')).toThrow(/at-rule/);
    expect(() => parseTokenCss(':root { --a 1; }')).toThrow(/Bad declaration/);
    expect(() => parseTokenCss('--a: 1;')).toThrow(/outside a rule/);
    expect(() => parseTokenCss(':root { --a: 1;')).toThrow(/Unbalanced/);
    expect(() =>
      resolveTokens(parseTokenCss(':root { --a: var(--b); --b: var(--a); }'), { lang: 'ar' }),
    ).toThrow(/Cyclic/);
  });
});
