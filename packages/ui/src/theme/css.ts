import { normalizeHex } from './color';
import { COLOR_ROLES, type ColorRole, type ThemeDefinition, type TokenValue } from './contract';
import type { BrandLayer } from './resolve';

/**
 * Turns a theme (or an organization's brand layer) into CSS custom properties. Every theme uses the
 * same three blocks, so a layer loaded later replaces exactly what it sets:
 *   :root                                    light values (and anything not mode-specific)
 *   @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }   system dark
 *   :root[data-theme="dark"]                 dark chosen in the app
 */

const DARK_SELECTORS = {
  system: { media: '(prefers-color-scheme: dark)', selector: ':root:not([data-theme="light"])' },
  app: ':root[data-theme="dark"]',
} as const;

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
]);

/** CSS font-family list: generic keywords and single plain words bare, every other name quoted. */
export function fontStack(families: readonly string[]): string {
  return families
    .map((f) => {
      if (/["\\;{}]/.test(f)) throw new Error(`Font family name not allowed: ${f}`);
      return GENERIC_FAMILIES.has(f) || /^[A-Za-z]+$/.test(f) ? f : `"${f}"`;
    })
    .join(', ');
}

/** A token value as CSS: aliases become `var()` references, colours stay as written. */
export function tokenCss(value: TokenValue): string {
  const palette = /^\{color\.([\w-]+)\.([\w-]+)\}$/.exec(value);
  if (palette) return `var(--color-${palette[1]}-${palette[2]})`;
  const semantic = /^\{semantic\.([\w-]+)\}$/.exec(value);
  if (semantic) return `var(--color-${semantic[1]})`;
  if (normalizeHex(value) || /^rgba?\([\d\s.,%]+\)$/.test(value)) return value;
  throw new Error(`Not a token value: ${value}`);
}

type Lines = readonly string[];

function block(selector: string, lines: Lines, indent = ''): string {
  return `${indent}${selector} {\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`;
}

function modeBlocks(light: Lines, dark: Lines): string {
  const parts = [block(':root', light)];
  if (dark.length > 0) {
    parts.push(
      `@media ${DARK_SELECTORS.system.media} {\n${block(DARK_SELECTORS.system.selector, dark, '  ')}\n}`,
      block(DARK_SELECTORS.app, dark),
    );
  }
  return `${parts.join('\n\n')}\n`;
}

function roleLines(values: Readonly<Partial<Record<ColorRole, TokenValue>>>): string[] {
  return COLOR_ROLES.filter((role) => values[role] !== undefined).map(
    (role) => `--color-${role}: ${tokenCss(values[role] ?? '')};`,
  );
}

/** The complete stylesheet of a theme (docs/design/tokens/themes/<id>.css). */
export function themeCss(theme: ThemeDefinition): string {
  const light = [
    '/* palette */',
    ...Object.entries(theme.palette).flatMap(([ramp, steps]) =>
      Object.entries(steps).map(([step, value]) => `--color-${ramp}-${step}: ${tokenCss(value)};`),
    ),
    '/* colour roles (components use these only) */',
    ...roleLines(theme.color.light),
    '/* type: font stacks (sizes and line heights are brand-neutral, in tokens.css) */',
    `--font-family-arabic: ${fontStack(theme.font.arabic)};`,
    `--font-family-latin: ${fontStack(theme.font.latin)};`,
    `--font-family-mono: ${fontStack(theme.font.mono)};`,
    '/* shape */',
    ...(['sm', 'md', 'lg', 'xl'] as const).map((k) => `--radius-${k}: ${theme.radius[k]};`),
    ...([1, 2, 3, 4] as const).map((k) => `--elevation-${k}: ${theme.elevation.light[k]};`),
    'color-scheme: light;',
  ];
  const dark = [
    ...roleLines(theme.color.dark),
    ...([1, 2, 3, 4] as const).map((k) => `--elevation-${k}: ${theme.elevation.dark[k]};`),
    'color-scheme: dark;',
  ];
  const header = [
    '/*',
    ` * Brand theme «${theme.id}» (${theme.status}) — GENERATED from packages/ui/src/theme/themes/${theme.id}.ts.`,
    ' * Do not edit: change the theme file, then `pnpm --filter @jadarat/ui exec vitest run -u`.',
    ` * Source: ${theme.source}.`,
    ' * The swappable brand layer: palette, colour roles (light + dark), fonts, radii, shadows.',
    ' * Brand-neutral tokens (type scale, spacing, motion, z-index, sizes) are in ../tokens.css.',
    ' */',
  ].join('\n');
  return `${header}\n${modeBlocks(light, dark)}`;
}

/**
 * An organization's brand (FR-ADM-07) as CSS, to load after the theme. Only `#RRGGBB` colours for
 * known roles can be written: any other value throws, so tenant input can never inject CSS.
 */
export function brandLayerCss(layer: BrandLayer): string {
  const lines = (values: BrandLayer['light']) =>
    COLOR_ROLES.filter((role) => values[role] !== undefined).map((role) => {
      const hex = normalizeHex(values[role] ?? '');
      if (!hex) throw new Error(`Brand colour for ${role} is not #RRGGBB`);
      return `--color-${role}: ${hex};`;
    });
  return modeBlocks(lines(layer.light), lines(layer.dark));
}
