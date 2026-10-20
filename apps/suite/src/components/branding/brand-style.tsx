import { headers } from 'next/headers';
import { type BrandColors, brandCss } from '../../lib/branding-view';
import { NONCE_HEADER } from '../../lib/security-headers';

/**
 * The organization's colours (WP-ADM-02, FR-ADM-07) as the third theme layer: CSS custom properties for
 * light and dark, loaded after the theme in a `<style>` carrying the request's CSP nonce (the policy allows
 * no other inline style). Nothing for the Jadarat look. Only `#RRGGBB` values of known roles can be written.
 */
export async function BrandStyle({ colors }: { readonly colors: BrandColors | null }) {
  const css = brandCss(colors);
  // Generated from fixed selectors and #RRGGBB values only; never markup (a `<` would end the element).
  if (!css || css.includes('<')) return null;
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  // As raw text: React would escape the quotes of the `[data-theme="dark"]` selectors.
  return <style nonce={nonce} data-brand-layer="" dangerouslySetInnerHTML={{ __html: css }} />;
}
