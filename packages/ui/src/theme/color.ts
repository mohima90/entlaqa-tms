/**
 * Colour arithmetic for themes: strict hex parsing, WCAG 2.x contrast and simple sRGB mixing.
 * Pure functions, no DOM: usable on the server (organization brand), in tests and in Storybook.
 */

/** A colour as `#RRGGBB` (upper case once normalized). */
export type Hex = `#${string}`;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

/**
 * `#RGB` / `#RRGGBB` → `#RRGGBB` (upper case); anything else → null. This is the only way an
 * organization's colour reaches a stylesheet, so nothing but six hex digits can ever be written
 * into CSS (no injection through a colour value).
 */
export function normalizeHex(value: string): Hex | null {
  const trimmed = value.trim();
  if (!HEX.test(trimmed)) return null;
  // Hex digits only (checked above), so per-character handling is safe.
  const digits = trimmed.length === 4 ? trimmed.slice(1).replace(/./g, '$&$&') : trimmed.slice(1);
  return `#${digits.toUpperCase()}`;
}

function rgb(hex: string): Rgb {
  const normalized = normalizeHex(hex);
  if (!normalized) throw new Error(`Not a hex colour: ${hex}`);
  const n = Number.parseInt(normalized.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hex({ r, g, b }: Rgb): Hex {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase() as Hex;
}

/** WCAG 2.x relative luminance (sRGB). */
export function relativeLuminance(color: string): number {
  const { r, g, b } = rgb(color);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio `(L1 + 0.05) / (L2 + 0.05)`, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ratio to 2 decimals, as reports show it. Pass/fail is always decided on the exact ratio. */
export function displayRatio(ratio: number): string {
  return ratio.toFixed(2);
}

/** `a` moved towards `b` by `t` (0 → a, 1 → b), per sRGB channel. */
export function mix(a: string, b: string, t: number): Hex {
  const x = rgb(a);
  const y = rgb(b);
  return hex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
  });
}

export const WHITE: Hex = '#FFFFFF';
export const BLACK: Hex = '#000000';

/**
 * The first colour on the way from `from` to `to` (in 2 % steps) that satisfies `ok`, or null when
 * not even `to` does. Used to darken or lighten a brand colour just enough to pass contrast.
 */
export function firstPassing(from: string, to: string, ok: (c: Hex) => boolean): Hex | null {
  for (let step = 0; step <= 50; step++) {
    const candidate = mix(from, to, step / 50);
    if (ok(candidate)) return candidate;
  }
  return null;
}
