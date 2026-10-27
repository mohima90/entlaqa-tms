import { type BrandColors, brandCssHref } from '../../lib/branding-view';

/**
 * The organization's colours (WP-ADM-02, FR-ADM-07) as the third theme layer: a same-origin stylesheet
 * (/api/brand-css?…) loaded after the theme — allowed by `style-src 'self'` on every page and after every
 * client-side navigation (an inline <style> with the request's nonce was dropped after navigating, WP-FIX-02
 * #1). React keeps one copy in <head> by its `precedence`. Nothing for the Jadarat look.
 */
export function BrandStyle({ colors }: { readonly colors: BrandColors | null }) {
  const href = brandCssHref(colors);
  if (!href) return null;
  return <link rel="stylesheet" precedence="brand" href={href} data-brand-layer="" />;
}
