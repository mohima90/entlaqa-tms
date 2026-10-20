import { type Hex, WHITE, contrastRatio, normalizeHex } from './color';
import { type OrganizationBrand, deriveOrganizationBrand } from './organization-brand';

/**
 * The Branding page's colours (WP-ADM-02, FR-ADM-07; business flow EP-BRAND, Kawadir /org/branding): a
 * primary and a secondary colour with a «Use gradient» switch (135°, primary → secondary), preset swatches
 * with the Jadarat colours first, a real WCAG 2.2 AA contrast check (a warning — the admin may still save,
 * BR-BRD-c), and the colours the e-mails use. Pure TypeScript: the server (shell, sign-in page, saving) and
 * the browser (the live preview with unsaved values) compute exactly the same thing.
 */

/** The Jadarat look (slate → steel; docs/design/kawadir-alignment.md §2). */
export const JADARAT_BRAND = { primary: '#2F4858', secondary: '#33658A' } as const satisfies {
  primary: Hex;
  secondary: Hex;
};

export interface BrandPreset {
  /** Message key of its name (namespace `branding.presets`). */
  readonly id: 'jadarat' | 'teal' | 'navy' | 'burgundy' | 'plum' | 'forest' | 'charcoal';
  readonly primary: Hex;
  readonly secondary: Hex;
}

/**
 * Preset colour pairs: the Jadarat colours first, then a few single-hue pairs (a deep shade → a lighter shade
 * of the SAME hue — no mixed hues by default, PO 16 Oct 2026). Every pair keeps white text ≥ 4.5 : 1 on both
 * ends (unit test), so a preset never raises the contrast warning.
 */
export const BRAND_PRESETS: readonly BrandPreset[] = [
  { id: 'jadarat', primary: JADARAT_BRAND.primary, secondary: JADARAT_BRAND.secondary },
  { id: 'teal', primary: '#0F5E4E', secondary: '#13806A' },
  { id: 'navy', primary: '#1E3A5F', secondary: '#2C5282' },
  { id: 'burgundy', primary: '#7A1F2B', secondary: '#9B2C3A' },
  { id: 'plum', primary: '#4B2C5E', secondary: '#6B3F86' },
  { id: 'forest', primary: '#2D5A27', secondary: '#3B7333' },
  { id: 'charcoal', primary: '#2B2F33', secondary: '#4A5056' },
];

export interface BrandColorSettings {
  /** `#RRGGBB`; null with the Jadarat look. */
  readonly primary: string | null;
  readonly secondary: string | null;
  readonly gradient: boolean;
}

/** Strict colour input of the page: `#RRGGBB` or `#RGB` (case-insensitive) → `#RRGGBB`; else null. */
export function parseBrandColor(value: string): Hex | null {
  return normalizeHex(value);
}

/** True when the settings are the Jadarat look (no colours, or exactly the Jadarat pair with the gradient). */
export function isJadaratLook(settings: BrandColorSettings): boolean {
  if (settings.primary === null) return true;
  return (
    normalizeHex(settings.primary) === JADARAT_BRAND.primary &&
    normalizeHex(settings.secondary ?? '') === JADARAT_BRAND.secondary &&
    settings.gradient
  );
}

/**
 * The colours to store: null (both) for the Jadarat look — the shipped theme exactly, so «Reset to the
 * Jadarat look» and the Jadarat preset are the default and nothing else — otherwise both colours, the
 * secondary one equal to the primary when the gradient is off (Kawadir stores it so too).
 */
export function storedBrandColors(
  settings: BrandColorSettings,
): { readonly primary: Hex; readonly secondary: Hex } | null {
  if (isJadaratLook(settings)) return null;
  const primary = normalizeHex(settings.primary ?? '');
  const secondary = normalizeHex(settings.secondary ?? '') ?? primary;
  if (!primary || !secondary) return null;
  return { primary, secondary: settings.gradient ? secondary : primary };
}

/**
 * The organization's brand layer (light + dark) from its settings, or null for the Jadarat look (the
 * shipped theme applies, no layer). Shades are adjusted so that text always stays readable (WCAG 2.2 AA).
 */
export function brandFromSettings(settings: BrandColorSettings): OrganizationBrand | null {
  const stored = storedBrandColors(settings);
  if (!stored) return null;
  return deriveOrganizationBrand({
    primary: stored.primary,
    accent: stored.secondary,
    gradient: settings.gradient,
  });
}

/** Minimum contrast for text (WCAG 2.2 SC 1.4.3, AA). */
export const TEXT_CONTRAST_MIN = 4.5;

export type ContrastCheckId = 'textOnPrimary' | 'textOnSecondary' | 'primaryOnWhite';

export interface BrandContrastCheck {
  readonly id: ContrastCheckId;
  /** The ratio of the colours as CHOSEN (before the product adjusts any shade). */
  readonly ratio: number;
  readonly pass: boolean;
}

/**
 * The page's contrast check of the colours as chosen (BR-BRD-c): white text on the primary colour (main
 * buttons, the current menu item) and — with the gradient — on the secondary colour (the gradient's other
 * end), and the primary colour as text on white (links, brand text). A failing check is a warning: the admin
 * may still save; the product then uses a darker shade where text sits on the colour.
 */
export function checkBrandContrast(settings: BrandColorSettings): readonly BrandContrastCheck[] {
  const stored = storedBrandColors(settings);
  const primary = stored?.primary ?? JADARAT_BRAND.primary;
  const secondary = stored?.secondary ?? JADARAT_BRAND.secondary;
  const check = (id: ContrastCheckId, a: string, b: string): BrandContrastCheck => {
    const ratio = contrastRatio(a, b);
    return { id, ratio, pass: ratio >= TEXT_CONTRAST_MIN };
  };
  return [
    check('textOnPrimary', WHITE, primary),
    ...(settings.gradient ? [check('textOnSecondary', WHITE, secondary)] : []),
    check('primaryOnWhite', primary, WHITE),
  ];
}

/** The e-mail colours (FR-NTF-02): the button (white text ≥ 4.5 : 1) and links (≥ 4.5 : 1 on white). */
export interface EmailBrandColors {
  readonly action: Hex;
  readonly link: Hex;
}

/**
 * Derived from the primary colour exactly like the product's light mode (its button fill and brand text), so
 * e-mails match the product and stay readable; stored with the branding (the worker renders e-mails without
 * theme code — docs/design/theming.md §6 point 1). Null for the Jadarat look (the e-mail layout's own).
 */
export function emailBrandColors(settings: BrandColorSettings): EmailBrandColors | null {
  const brand = brandFromSettings(settings);
  if (!brand) return null;
  const action = brand.layer.light.primary;
  const link = brand.layer.light['primary-text'];
  if (!action || !link) return null;
  return { action, link };
}
