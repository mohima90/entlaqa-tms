import {
  type BrandColorSettings,
  BRAND_PRESETS,
  type BrandContrastCheck,
  JADARAT_BRAND,
  SHIPPED_THEME,
  brandFromSettings,
  brandLayerCss,
  checkBrandContrast,
  displayRatio,
  emailBrandColors,
  isJadaratLook,
  parseBrandColor,
  resolveThemeColors,
  storedBrandColors,
} from '@jadarat/ui/theme';

/**
 * The Branding page and where the look applies (WP-ADM-02, FR-ADM-07): pure helpers shared by the server
 * (shell, sign-in page, saving) and the browser (the live preview). No React, no DOM.
 */

export { BRAND_PRESETS, JADARAT_BRAND, displayRatio, isJadaratLook, parseBrandColor };

/** The colours of a saved or chosen look (null colours: the Jadarat look). */
export interface BrandColors {
  readonly primaryColor: string | null;
  readonly secondaryColor: string | null;
  readonly useGradient: boolean;
}

const settingsOf = (colors: BrandColors): BrandColorSettings => ({
  primary: colors.primaryColor,
  secondary: colors.secondaryColor,
  gradient: colors.useGradient,
});

/**
 * The organization's brand layer as CSS (custom properties for light and dark), loaded after the theme by
 * the shell and the sign-in page in a nonce'd <style>; null for the Jadarat look. Only `#RRGGBB` values
 * for known roles can be written (brandLayerCss), so stored values can never inject CSS.
 */
export function brandCss(colors: BrandColors | null): string | null {
  if (!colors) return null;
  try {
    const brand = brandFromSettings(settingsOf(colors));
    return brand ? brandLayerCss(brand.layer) : null;
  } catch {
    // A stored value that is not a colour (never written by the page): the Jadarat look.
    return null;
  }
}

/**
 * Every colour role of one mode (light or dark) as CSS custom properties for an element — the live preview
 * sets them on its own box (CSSOM, allowed by the CSP), so that the UNSAVED colours show — the Jadarat ones
 * after «Reset» too — whatever look the page itself has.
 */
export function brandProperties(
  colors: BrandColors,
  mode: 'light' | 'dark',
): Readonly<Record<string, string>> {
  let layer;
  try {
    layer = brandFromSettings(settingsOf(colors))?.layer;
  } catch {
    layer = undefined;
  }
  const resolved = resolveThemeColors(SHIPPED_THEME, mode, layer);
  return Object.fromEntries(
    Object.entries(resolved).map(([role, value]) => [`--color-${role}`, value]),
  );
}

/** What the server stores for the chosen colours, and the e-mail colours (rbac BrandingColorDeriver). */
export function deriveBrandingColors(settings: BrandColorSettings): {
  readonly stored: { readonly primary: string; readonly secondary: string } | null;
  readonly email: { readonly action: string; readonly link: string } | null;
} {
  return { stored: storedBrandColors(settings), email: emailBrandColors(settings) };
}

/** The contrast check of the chosen colours (a warning only; BR-BRD-c). */
export function contrastChecks(colors: BrandColors): readonly BrandContrastCheck[] {
  return checkBrandContrast(settingsOf(colors));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The same-origin address of a published branding image (/api/brand/<id>), or null. */
export function brandAssetPath(assetId: string | null | undefined): string | null {
  return typeof assetId === 'string' && UUID.test(assetId) ? `/api/brand/${assetId}` : null;
}

export type SniffedImage = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * The image type by its first bytes (the browser checks before uploading, so a wrong file is refused at
 * once; the server's scan decides): PNG, JPEG or WebP only — an SVG, a GIF or anything else is null.
 */
export function sniffImageType(head: Uint8Array): SniffedImage | null {
  const at = (i: number) => head[i] ?? -1;
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) {
    return 'image/png';
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  const ascii = (from: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      if (at(from + i) !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

/** The website as typed: empty, or https with a host (the server checks it strictly again). */
export function websiteLooksValid(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && url.hostname.includes('.') && !/[\s<>"'\\]/.test(trimmed);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------
// The brand layer as a stylesheet file (WP-FIX-02 #1)
// ---------------------------------------------------------------------------------------------------
// The colours used to be an inline <style> carrying the request's CSP nonce. After a client-side navigation
// the next page's nonce no longer matches the document's policy, so the browser dropped the layer and the
// shell fell back to the Jadarat look until a full reload (PO, 27 Oct 2026). A same-origin stylesheet is
// allowed by `style-src 'self'` on every navigation. The colours travel in the URL, so the file is pure and
// cacheable for good: the same colours always give the same bytes.

/** The stylesheet route (apps/suite/src/app/api/brand-css/route.ts). */
export const BRAND_CSS_PATH = '/api/brand-css';

const HEX6 = /^[0-9A-Fa-f]{6}$/;

/** The stylesheet URL of these colours, or null for the Jadarat look (no stylesheet at all). */
export function brandCssHref(colors: BrandColors | null): string | null {
  if (!colors || !brandCss(colors)) return null;
  const params = new URLSearchParams();
  if (colors.primaryColor) params.set('p', colors.primaryColor.replace('#', '').toUpperCase());
  if (colors.secondaryColor) params.set('s', colors.secondaryColor.replace('#', '').toUpperCase());
  params.set('g', colors.useGradient ? '1' : '0');
  return `${BRAND_CSS_PATH}?${params.toString()}`;
}

/** The colours a stylesheet URL names, strictly (#RRGGBB only); null when the URL is not one we write. */
export function brandColorsFromSearch(params: URLSearchParams): BrandColors | null {
  const p = params.get('p');
  const s = params.get('s');
  const g = params.get('g');
  if ((p !== null && !HEX6.test(p)) || (s !== null && !HEX6.test(s))) return null;
  if (g !== '0' && g !== '1') return null;
  if (p === null && s === null) return null;
  return {
    primaryColor: p ? `#${p.toUpperCase()}` : null,
    secondaryColor: s ? `#${s.toUpperCase()}` : null,
    useGradient: g === '1',
  };
}

/**
 * The file's text: the brand layer with its selectors made one step more specific (`html:root`), so that it
 * beats the theme's own `:root` tokens wherever the browser places it among the page's stylesheets.
 */
export function brandStylesheet(colors: BrandColors | null): string | null {
  const css = brandCss(colors);
  return css ? css.replaceAll(':root', 'html:root') : null;
}
