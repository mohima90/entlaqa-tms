import { brandColorsFromSearch, brandStylesheet } from '../../../lib/branding-view';

export const dynamic = 'force-dynamic';

/**
 * An organization's brand colours as a stylesheet (WP-ADM-02, FR-ADM-07; WP-FIX-02 #1): the shell, the
 * focused pages and the sign-in page link it (`style-src 'self'`), so the colours survive client-side
 * navigation, which a nonce'd inline <style> did not. No session and no database: the colours are in the
 * URL, validated strictly, and only `#RRGGBB` values of known roles are ever written (brandLayerCss) — so
 * the answer is immutable and cached for a year by browsers and CDNs. Anything else is 404.
 */
export function GET(request: Request): Response {
  const css = brandStylesheet(brandColorsFromSearch(new URL(request.url).searchParams));
  if (!css) return new Response(null, { status: 404 });
  return new Response(css, {
    status: 200,
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
