import { BLACK, type Hex, WHITE, contrastRatio, firstPassing, mix, normalizeHex } from './color';
import {
  BRAND_ROLES,
  type ColorMode,
  type ColorRole,
  type NavRole,
  type ThemeDefinition,
} from './contract';
import { type BrandLayer, type ContrastResult, checkTheme, resolveThemeColors } from './resolve';
import { jadaratTheme } from './themes/jadarat';

/**
 * Organization brand colours (FR-ADM-07, R1): an organization admin picks a primary (and optionally an
 * accent) colour; we derive every brand role for light and dark from it so that the result ALWAYS
 * passes WCAG 2.2 AA with the theme's surfaces and text:
 *   - the filled colour is darkened (light mode) or lightened (dark mode) only as much as needed for
 *     its text (white / a very dark shade) to reach 4.5:1 and for the fill to stand out (3:1);
 *   - brand-coloured text, tinted backgrounds, hover and the focus ring are derived the same way;
 *   - the side navigation becomes a gradient from a darker shade of the primary to the primary (T-M2-21;
 *     it replaces the Jadarat gradient), with light text, hover, current pill and focus ring that pass
 *     on both ends;
 *   - the whole contract is then re-checked; a failure is a bug and throws.
 * Whenever the colour shown differs from the one chosen, `adjustments` says so, for the admin preview
 * ("we use a darker shade of your colour for buttons so that their text stays readable").
 * Colours only: organizations have no font choice (PO, 14 Oct 2026; BRD v2.9 FR-ADM-07) — the layer can
 * neither take nor write anything but colour roles.
 */

export interface OrganizationBrandInput {
  /** `#RRGGBB` or `#RGB`. */
  readonly primary: string;
  /** Second brand colour; defaults to the primary. */
  readonly accent?: string | undefined;
}

export interface BrandAdjustment {
  readonly family: keyof typeof BRAND_ROLES;
  readonly mode: ColorMode;
  readonly requested: Hex;
  readonly used: Hex;
  /** Contrast of the button text on the colour used. */
  readonly ratio: number;
}

export interface OrganizationBrand {
  readonly input: { readonly primary: Hex; readonly accent: Hex };
  readonly layer: BrandLayer;
  readonly adjustments: readonly BrandAdjustment[];
  readonly checks: readonly ContrastResult[];
}

export class InvalidBrandColorError extends Error {
  constructor(readonly field: 'primary' | 'accent') {
    super(`The ${field} brand colour must be a #RRGGBB colour`);
    this.name = 'InvalidBrandColorError';
  }
}

const TEXT_MIN = 4.5;
const UI_MIN = 3;
/** A hover colour must differ visibly from the fill. */
const HOVER_STEP = 1.15;
const passesAll = (color: Hex, others: readonly string[], min: number) =>
  others.every((o) => contrastRatio(color, o) >= min);

interface FamilyColors {
  readonly fill: Hex;
  readonly hover: Hex;
  readonly onFill: Hex;
  readonly subtle: Hex;
  readonly text: Hex;
}

/** Solves `ok` from `start` towards `towards`; the end point is chosen so a solution always exists. */
function solve(start: string, towards: string, ok: (c: Hex) => boolean, what: string): Hex {
  const found = firstPassing(start, towards, ok);
  if (!found) throw new Error(`No accessible ${what} found for ${start}`);
  return found;
}

function deriveFamily(
  input: Hex,
  mode: ColorMode,
  base: Readonly<Record<ColorRole, string>>,
): FamilyColors {
  const pageBackgrounds = [base.bg, base.surface];
  const textOnTint = [base.text, base['text-muted'], base['text-subtle']];
  if (mode === 'light') {
    // Filled: white text at 4.5:1 and the fill at 3:1 on the page → darken.
    const onFill = WHITE;
    const fill = solve(
      input,
      BLACK,
      (c) => contrastRatio(onFill, c) >= TEXT_MIN && passesAll(c, pageBackgrounds, UI_MIN),
      'fill',
    );
    // Hover: visibly darker, still white text (darker only raises contrast); lighter if near black.
    const darker = mix(fill, BLACK, 0.18);
    const hover =
      contrastRatio(darker, fill) >= HOVER_STEP
        ? darker
        : solve(mix(fill, WHITE, 0.25), fill, (c) => contrastRatio(onFill, c) >= TEXT_MIN, 'hover');
    // Tint: a pale wash of the colour that keeps every text colour readable on it → lighten.
    const subtle = solve(
      mix(input, WHITE, 0.9),
      WHITE,
      (c) => passesAll(c, textOnTint, TEXT_MIN),
      'tint',
    );
    // Brand text (links, current item): readable on every light surface and on the tint → darken.
    const textBackgrounds = [
      base.bg,
      base.surface,
      base['surface-sunken'],
      base['surface-hover'],
      subtle,
    ];
    const text = solve(fill, BLACK, (c) => passesAll(c, textBackgrounds, TEXT_MIN), 'text');
    return { fill, hover, onFill, subtle, text };
  }
  // Dark mode: very dark text on a light enough fill → lighten.
  const onFill = solve(
    mix(input, BLACK, 0.82),
    BLACK,
    (c) => contrastRatio(c, WHITE) >= 15,
    'on-fill',
  );
  const fill = solve(
    input,
    WHITE,
    (c) => contrastRatio(onFill, c) >= TEXT_MIN && passesAll(c, pageBackgrounds, UI_MIN),
    'fill',
  );
  const lighter = mix(fill, WHITE, 0.25);
  const hover =
    contrastRatio(lighter, fill) >= HOVER_STEP
      ? lighter
      : solve(mix(fill, BLACK, 0.2), fill, (c) => contrastRatio(onFill, c) >= TEXT_MIN, 'hover');
  // Tint: a little of the colour on the dark surface; less colour until all text reads on it.
  const subtle = solve(
    mix(base.surface, input, 0.3),
    base.surface,
    (c) => passesAll(c, textOnTint, TEXT_MIN),
    'tint',
  );
  const textBackgrounds = [
    base.bg,
    base.surface,
    base['surface-sunken'],
    base['surface-hover'],
    subtle,
  ];
  const text = solve(input, WHITE, (c) => passesAll(c, textBackgrounds, TEXT_MIN), 'text');
  return { fill, hover, onFill, subtle, text };
}

/** How much darker the top of the navigation gradient is than its bottom (the primary). */
const NAV_START_SHADE = 0.3;
/** The navigation hover fill: this much white over the lighter (bottom) end of the gradient. */
const NAV_HOVER_WHITE = 0.08;

/**
 * The side navigation from an organization's colour: `end` (bottom of the gradient) is the colour,
 * darkened until light text passes on it AND on its hover fill; `start` (top) is a darker shade of it.
 * Text, the current entry's pill and the focus ring are then checked against both ends.
 */
function deriveNav(
  from: string,
  mode: ColorMode,
  base: Readonly<Record<ColorRole, string>>,
): Readonly<Record<NavRole, Hex>> {
  const hoverOf = (c: string) => mix(c, WHITE, NAV_HOVER_WHITE);
  const end = solve(from, BLACK, (c) => contrastRatio(WHITE, hoverOf(c)) >= TEXT_MIN, 'navigation');
  const start = mix(end, BLACK, NAV_START_SHADE);
  const hover = hoverOf(end);
  const ends = [start, end];
  // Near-white text (a hint of the colour), whiter until it passes on both ends and on the hover.
  const onNav = solve(
    mix(WHITE, end, 0.06),
    WHITE,
    (c) => passesAll(c, [...ends, hover], TEXT_MIN),
    'navigation text',
  );
  const onNavMuted = solve(
    mix(WHITE, end, 0.14),
    WHITE,
    (c) => passesAll(c, ends, TEXT_MIN),
    'navigation muted text',
  );
  // The current entry: a white pill (a pale one in dark mode) with text in the dark shade.
  const current = mode === 'light' ? WHITE : mix(WHITE, end, 0.12);
  const onCurrent = solve(
    start,
    BLACK,
    (c) => contrastRatio(c, current) >= TEXT_MIN,
    'current entry',
  );
  // Focus ring: the theme's (Jadarat amber) when it shows on both ends, else white (which does).
  const themeRing = normalizeHex(base['nav-focus-ring']);
  const ring = themeRing && passesAll(themeRing, ends, UI_MIN) ? themeRing : WHITE;
  return {
    nav: start,
    'nav-end': end,
    'on-nav': onNav,
    'on-nav-muted': onNavMuted,
    'nav-border': start,
    'nav-item-hover': hover,
    'nav-item-current': current,
    'on-nav-item-current': onCurrent,
    'nav-focus-ring': ring,
  };
}

function familyRoles(
  family: keyof typeof BRAND_ROLES,
  colors: FamilyColors,
): Partial<Record<ColorRole, Hex>> {
  const [fill, hover, onFill, subtle, text] = BRAND_ROLES[family];
  return {
    [fill]: colors.fill,
    [hover]: colors.hover,
    [onFill]: colors.onFill,
    [subtle]: colors.subtle,
    [text]: colors.text,
  };
}

/** Derives an organization's brand layer on top of `base` (the shipped theme by default). */
export function deriveOrganizationBrand(
  input: OrganizationBrandInput,
  base: ThemeDefinition = jadaratTheme,
): OrganizationBrand {
  const primary = normalizeHex(input.primary);
  if (!primary) throw new InvalidBrandColorError('primary');
  const accent = input.accent === undefined ? primary : normalizeHex(input.accent);
  if (!accent) throw new InvalidBrandColorError('accent');

  const adjustments: BrandAdjustment[] = [];
  const modeLayer = (mode: ColorMode): Partial<Record<ColorRole, Hex>> => {
    const colors = resolveThemeColors(base, mode);
    const p = deriveFamily(primary, mode, colors);
    const a = accent === primary ? p : deriveFamily(accent, mode, colors);
    for (const [family, requested, derived] of [
      ['primary', primary, p],
      ['accent', accent, a],
    ] as const) {
      if (derived.fill !== requested) {
        adjustments.push({
          family,
          mode,
          requested,
          used: derived.fill,
          ratio: contrastRatio(derived.onFill, derived.fill),
        });
      }
    }
    // The selected row / current navigation item uses the primary tint; the focus ring the brand
    // text colour (≥ 4.5:1 on every surface, so ≥ 3:1 as a UI component).
    // The navigation starts from the button colour in light mode and from a deep shade of the chosen
    // colour in dark mode (so the dark navigation stays dark).
    const navFrom = mode === 'light' ? p.fill : mix(primary, BLACK, 0.45);
    return {
      ...familyRoles('primary', p),
      ...familyRoles('accent', a),
      'surface-selected': p.subtle,
      'focus-ring': p.text,
      ...deriveNav(navFrom, mode, colors),
    };
  };

  const layer: BrandLayer = { light: modeLayer('light'), dark: modeLayer('dark') };
  const checks = checkTheme(base, layer);
  const failures = checks.filter((c) => !c.pass);
  if (failures.length > 0) {
    // By construction this cannot happen; if it does, never ship an unreadable brand.
    throw new Error(
      `Organization brand ${primary} fails contrast: ${failures
        .map((f) => `${f.mode} ${f.fg} on ${f.bg} ${f.ratio.toFixed(2)}`)
        .join('; ')}`,
    );
  }
  return { input: { primary, accent }, layer, adjustments, checks };
}
