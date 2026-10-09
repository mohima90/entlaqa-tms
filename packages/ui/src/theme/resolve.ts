import { type Hex, contrastRatio, normalizeHex } from './color';
import {
  COLOR_ROLES,
  CONTRAST_PAIRS,
  type ColorMode,
  type ColorRole,
  type ContrastPair,
  type ThemeDefinition,
} from './contract';

/** An organization's brand on top of a theme: plain colours for some roles, per mode. */
export interface BrandLayer {
  readonly light: Readonly<Partial<Record<ColorRole, Hex>>>;
  readonly dark: Readonly<Partial<Record<ColorRole, Hex>>>;
}

/**
 * The colour of every role in one mode, as the browser ends up with it: in dark mode a dark value
 * (layer, then theme) beats a light one (layer, then theme) — the same cascade as the generated CSS,
 * where dark blocks are more specific and layers come after the theme.
 */
export function resolveThemeColors(
  theme: ThemeDefinition,
  mode: ColorMode,
  layer?: BrandLayer,
): Readonly<Record<ColorRole, string>> {
  const specified: Partial<Record<ColorRole, string>> =
    mode === 'light'
      ? { ...theme.color.light, ...layer?.light }
      : { ...theme.color.light, ...layer?.light, ...theme.color.dark, ...layer?.dark };

  const resolve = (role: ColorRole, stack: readonly ColorRole[]): string => {
    if (stack.includes(role)) throw new Error(`Cyclic colour role ${[...stack, role].join(' → ')}`);
    const value = specified[role];
    if (value === undefined) throw new Error(`Theme ${theme.id} has no ${mode} value for ${role}`);
    return resolveValue(theme, value, (ref) => resolve(ref, [...stack, role]));
  };
  return Object.fromEntries(COLOR_ROLES.map((role) => [role, resolve(role, [])])) as Record<
    ColorRole,
    string
  >;
}

function resolveValue(
  theme: ThemeDefinition,
  value: string,
  role: (ref: ColorRole) => string,
): string {
  const palette = /^\{color\.([\w-]+)\.([\w-]+)\}$/.exec(value);
  if (palette) {
    const step = theme.palette[palette[1] ?? '']?.[palette[2] ?? ''];
    if (step === undefined) throw new Error(`Theme ${theme.id}: unknown palette step ${value}`);
    return normalizeHex(step) ?? step;
  }
  const semantic = /^\{semantic\.([\w-]+)\}$/.exec(value);
  if (semantic) {
    const ref = semantic[1] as ColorRole;
    if (!(COLOR_ROLES as readonly string[]).includes(ref)) {
      throw new Error(`Theme ${theme.id}: unknown role ${value}`);
    }
    return role(ref);
  }
  return normalizeHex(value) ?? value;
}

export interface ContrastResult extends ContrastPair {
  readonly mode: ColorMode;
  readonly fgColor: string;
  readonly bgColor: string;
  readonly ratio: number;
  readonly pass: boolean;
}

/** Every contract pair in one mode. A non-hex colour (a scrim) in a pair is a failure. */
export function checkContrast(
  colors: Readonly<Record<ColorRole, string>>,
  mode: ColorMode,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): ContrastResult[] {
  return pairs.map((p) => {
    const fgColor = colors[p.fg];
    const bgColor = colors[p.bg];
    const ratio =
      normalizeHex(fgColor) && normalizeHex(bgColor) ? contrastRatio(fgColor, bgColor) : 0;
    return { ...p, mode, fgColor, bgColor, ratio, pass: ratio >= p.min };
  });
}

/** Contrast of a theme (optionally with an organization's brand on top) in light and dark. */
export function checkTheme(theme: ThemeDefinition, layer?: BrandLayer): ContrastResult[] {
  return (['light', 'dark'] as const).flatMap((mode) =>
    checkContrast(resolveThemeColors(theme, mode, layer), mode),
  );
}
