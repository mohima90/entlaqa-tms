import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SHIPPED_THEME } from './index';

const require = createRequire(import.meta.url);
const fontsCss = readFileSync(new URL('../fonts.css', import.meta.url), 'utf8');
const imports = [...fontsCss.matchAll(/@import\s+'([^']+)'/g)].map((m) => m[1] ?? '');
const declared = imports.map((specifier) => readFileSync(require.resolve(specifier), 'utf8'));

/**
 * Self-hosted fonts (ADR 0007 §4, T-M2-21): only npm font packages, no font CDN, woff2 first, and the
 * families the theme's stacks start with are the ones we actually ship.
 */
describe('fonts', () => {
  it('imports only @fontsource packages, never a URL', () => {
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((specifier) => !specifier.startsWith('@fontsource/'))).toEqual([]);
    expect(fontsCss).not.toMatch(/https?:|googleapis|gstatic/);
    for (const css of declared) expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//);
  });

  it('ships the first family of every font stack of the theme, in regular, medium and semibold', () => {
    const faces = declared.flatMap((css) =>
      [...css.matchAll(/font-family:\s*'([^']+)';[\s\S]*?font-weight:\s*(\d+);/g)].map(
        (m) => `${m[1]} ${m[2]}`,
      ),
    );
    for (const family of [SHIPPED_THEME.font.latin[0], SHIPPED_THEME.font.arabic[0]]) {
      for (const weight of ['400', '500', '600']) expect(faces).toContain(`${family} ${weight}`);
    }
    expect(faces).toContain(`${SHIPPED_THEME.font.mono[0]} 400`);
  });

  it('uses Poppins for English and IBM Plex Sans Arabic for Arabic (PO, 14 Oct 2026)', () => {
    expect(SHIPPED_THEME.font.latin[0]).toBe('Poppins');
    expect(SHIPPED_THEME.font.arabic[0]).toBe('IBM Plex Sans Arabic');
    // Arabic words inside English text fall back to the Arabic font, not to a system font.
    expect(SHIPPED_THEME.font.latin[1]).toBe('IBM Plex Sans Arabic');
  });
});
