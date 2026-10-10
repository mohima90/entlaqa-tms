/**
 * The theme contract (T-M2-04c): what every brand theme must provide, and the contrast every theme —
 * including an organization's own colours (FR-ADM-07) — must pass. Components only ever use these
 * semantic roles (Tailwind utilities such as `bg-surface`, `text-on-primary`), never palette steps or
 * raw values, so swapping the theme swaps the whole look.
 */

export type ColorMode = 'light' | 'dark';

/** Semantic colour roles. CSS: `--color-<role>`; Tailwind: `bg-<role>`, `text-<role>`, `border-<role>`. */
export const COLOR_ROLES = [
  // Surfaces
  'bg',
  'surface',
  'surface-raised',
  'surface-sunken',
  'surface-hover',
  'surface-selected',
  // Text
  'text',
  'text-muted',
  'text-subtle',
  'text-disabled',
  // Lines
  'border',
  'border-strong',
  // Brand: primary
  'primary',
  'primary-hover',
  'on-primary',
  'primary-subtle',
  'primary-text',
  'focus-ring',
  // Brand: accent (second brand colour; defaults to primary)
  'accent',
  'accent-hover',
  'on-accent',
  'accent-subtle',
  'accent-text',
  // Status
  'success',
  'success-subtle',
  'warning',
  'warning-strong',
  'warning-subtle',
  'danger',
  'danger-hover',
  'on-danger',
  'danger-subtle',
  'info',
  'info-subtle',
  // Inverse and scrim
  'inverse-surface',
  'inverse-text',
  'overlay',
  // Suite shell (header and side navigation; default to the surface roles)
  'header',
  'on-header',
  'on-header-muted',
  'header-border',
  'nav',
  'on-nav',
  'on-nav-muted',
  'nav-border',
  'nav-item-hover',
  'nav-item-current',
  'on-nav-item-current',
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Roles an organization's brand colours replace (FR-ADM-07); everything else stays the theme's. */
export const BRAND_ROLES = {
  primary: ['primary', 'primary-hover', 'on-primary', 'primary-subtle', 'primary-text'],
  accent: ['accent', 'accent-hover', 'on-accent', 'accent-subtle', 'accent-text'],
} as const satisfies Record<string, readonly ColorRole[]>;

/**
 * A token value: `#RRGGBB`, an alias to a palette step `{color.<ramp>.<step>}` or to another role
 * `{semantic.<role>}` (W3C DTCG alias syntax, as in docs/design/tokens/tokens.json), or `rgba(…)`
 * (scrims only).
 */
export type TokenValue = string;

export interface ThemeDefinition {
  /** Stable id (`jadarat`, `jadarat-lms`, …). */
  readonly id: string;
  readonly name: { readonly ar: string; readonly en: string };
  /** `active`: shipped today; `pending`: a slot waiting for design material (identical values until then). */
  readonly status: 'active' | 'pending';
  /** One line for people: where the values come from. */
  readonly source: string;
  /** Palette ramps (`neutral`, `brand`, status hues): step → `#RRGGBB`. */
  readonly palette: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly color: {
    /** Every role, light mode. */
    readonly light: Readonly<Record<ColorRole, TokenValue>>;
    /** Dark-mode values; a role left out keeps its light declaration, so it must be a `{semantic.*}` alias. */
    readonly dark: Readonly<Partial<Record<ColorRole, TokenValue>>>;
  };
  /** Font stacks (first family is the brand font; it must be self-hosted — no font CDN, ADR 0007). */
  readonly font: {
    readonly arabic: readonly string[];
    readonly latin: readonly string[];
    readonly mono: readonly string[];
  };
  /** Corner radii (`none` and `full` are fixed). */
  readonly radius: {
    readonly sm: string;
    readonly md: string;
    readonly lg: string;
    readonly xl: string;
  };
  /** Shadows 1–4 per mode (`0` is always none). */
  readonly elevation: Readonly<
    Record<
      ColorMode,
      { readonly 1: string; readonly 2: string; readonly 3: string; readonly 4: string }
    >
  >;
}

export type ContrastUse = 'text' | 'status-text' | 'badge-text' | 'on-fill' | 'ui';

export interface ContrastPair {
  readonly fg: ColorRole;
  readonly bg: ColorRole;
  /** 4.5 for text (SC 1.4.3, all text held to the normal-text bar); 3 for UI components and focus (SC 1.4.11). */
  readonly min: 4.5 | 3;
  readonly use: ContrastUse;
}

export const CONTRAST_USE_LABEL: Readonly<Record<ContrastUse, string>> = {
  text: 'Normal text',
  'status-text': 'Status text on page/card',
  'badge-text': 'Badge / alert text',
  'on-fill': 'Text on filled control',
  ui: 'UI component / focus (SC 1.4.11)',
};

const pair = (fg: ColorRole, bg: ColorRole, use: ContrastUse): ContrastPair => ({
  fg,
  bg,
  min: use === 'ui' ? 3 : 4.5,
  use,
});

/**
 * Every foreground/background combination the components use, checked in light and dark for every
 * theme and every organization brand (docs/design/tokens/contrast-report.md is generated from it).
 * `text-disabled` is exempt (SC 1.4.3); `border` is decorative and never the only boundary of a control.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...(['bg', 'surface', 'surface-sunken', 'surface-hover', 'surface-selected'] as const).flatMap(
    (bg) =>
      (['text', 'text-muted', 'text-subtle', 'primary-text'] as const).map((fg) =>
        pair(fg, bg, 'text'),
      ),
  ),
  ...(['bg', 'surface'] as const).flatMap((bg) =>
    (['success', 'warning', 'danger', 'info'] as const).map((fg) => pair(fg, bg, 'status-text')),
  ),
  pair('success', 'success-subtle', 'badge-text'),
  pair('warning', 'warning-subtle', 'badge-text'),
  pair('danger', 'danger-subtle', 'badge-text'),
  pair('info', 'info-subtle', 'badge-text'),
  pair('primary-text', 'primary-subtle', 'badge-text'),
  pair('text', 'warning-subtle', 'badge-text'),
  pair('text', 'danger-subtle', 'badge-text'),
  pair('text', 'success-subtle', 'badge-text'),
  pair('text', 'info-subtle', 'badge-text'),
  pair('text', 'primary-subtle', 'badge-text'),
  pair('on-primary', 'primary', 'on-fill'),
  pair('on-primary', 'primary-hover', 'on-fill'),
  pair('on-danger', 'danger', 'on-fill'),
  pair('on-danger', 'danger-hover', 'on-fill'),
  pair('inverse-text', 'inverse-surface', 'on-fill'),
  ...(['border-strong', 'primary', 'focus-ring', 'warning-strong', 'danger'] as const).flatMap(
    (fg) => (['bg', 'surface'] as const).map((bg) => pair(fg, bg, 'ui')),
  ),
  // Accent (T-M2-04c slot; same rules as primary)
  pair('accent-text', 'bg', 'text'),
  pair('accent-text', 'surface', 'text'),
  pair('accent-text', 'accent-subtle', 'badge-text'),
  pair('text', 'accent-subtle', 'badge-text'),
  pair('on-accent', 'accent', 'on-fill'),
  pair('on-accent', 'accent-hover', 'on-fill'),
  pair('accent', 'bg', 'ui'),
  pair('accent', 'surface', 'ui'),
  // Suite shell (T-M2-04c slot): header and side navigation may get their own colours
  pair('on-header', 'header', 'text'),
  pair('on-header-muted', 'header', 'text'),
  pair('on-nav', 'nav', 'text'),
  pair('on-nav-muted', 'nav', 'text'),
  pair('on-nav', 'nav-item-hover', 'text'),
  pair('on-nav-item-current', 'nav-item-current', 'text'),
  pair('focus-ring', 'header', 'ui'),
  pair('focus-ring', 'nav', 'ui'),
];
