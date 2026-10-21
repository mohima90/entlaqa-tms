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
 *   - the brand gradient (135°, primary → accent; direction C — it replaces the Jadarat gradient on the
 *     navigation panel, primary buttons, the current view card and the sign-in panel) gets a text
 *     colour that passes on both ends;
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
  /**
   * «Use gradient» (Kawadir Branding page; default on): off, the current navigation entry, primary buttons
   * and brand accents carry the primary colour alone — the gradient's end is its start.
   */
  readonly gradient?: boolean | undefined;
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
  // In dark mode the fill is also the current navigation entry, on the panel's lighter end (raised).
  const pageBackgrounds =
    mode === 'dark' ? [base.bg, base.surface, base['surface-raised']] : [base.bg, base.surface];
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

/** Brand-gradient and navigation roles an organization's colours set. */
type NavGradientRole = Extract<NavRole, 'brand' | 'brand-end' | 'on-brand' | 'nav-item-hover'>;

/**
 * The brand gradient from an organization's colours (direction C, PO 21 Oct 2026; T-M2-43): 135° from
 * the primary's button colour to the accent's — or, without a distinct accent, to the primary's hover
 * shade — with the text of the primary's buttons (white in light mode), darkened until it passes on BOTH
 * ends. Every end is a button fill, so it already stands out from the page (3 : 1, `deriveFamily`). In
 * light mode the gradient is also the navigation panel (the theme's `nav`, `nav-end`, `on-nav` and the
 * current entry's text are aliases of it); its hover fill is a little of the text colour over the
 * gradient's end, only as much as keeps the entry text readable on it. In dark mode the panel stays the
 * theme's dark surfaces and the current entry carries the gradient (aliases too).
 */
function deriveNav(
  mode: ColorMode,
  primary: FamilyColors,
  accent: FamilyColors | null,
  gradient: boolean,
): Partial<Readonly<Record<NavGradientRole, Hex>>> {
  const start = primary.fill;
  const end = !gradient ? start : accent ? accent.fill : primary.hover;
  const onBrand = solve(
    primary.onFill,
    BLACK,
    (c) => passesAll(c, [start, end], TEXT_MIN),
    'brand text',
  );
  const roles: Partial<Record<NavGradientRole, Hex>> = {
    brand: start,
    'brand-end': end,
    'on-brand': onBrand,
  };
  if (mode === 'light') {
    // `end` itself passes (above), so a solution always exists.
    roles['nav-item-hover'] = solve(
      mix(end, onBrand, 0.1),
      end,
      (c) => contrastRatio(onBrand, c) >= TEXT_MIN,
      'navigation hover',
    );
  }
  return roles;
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
    // The selected row uses the primary tint; the focus ring the brand text colour (≥ 4.5:1 on every
    // surface, so ≥ 3:1 as a UI component). The brand gradient runs primary → accent (direction C).
    return {
      ...familyRoles('primary', p),
      ...familyRoles('accent', a),
      'surface-selected': p.subtle,
      'focus-ring': p.text,
      ...deriveNav(mode, p, accent === primary ? null : a, input.gradient !== false),
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
