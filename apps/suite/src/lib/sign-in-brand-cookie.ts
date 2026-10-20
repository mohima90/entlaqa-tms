/**
 * The device's remembered organization for the sign-in page's look (WP-ADM-02): its slug, display only
 * (never used for authorization; a tampered value can only show another organization's PUBLIC look).
 */
export const BRAND_COOKIE = 'jadarat_brand';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A cookie value → a slug, or null. */
export function parseBrandCookie(value: string | null | undefined): string | null {
  return typeof value === 'string' && SLUG.test(value) ? value : null;
}

/**
 * Whose look the sign-in page shows: the organization of the address (its subdomain — authoritative, as
 * Kawadir resolves its login page), else the one this device last worked in, else none (Jadarat's).
 */
export function signInBrandSlug(
  hostKind: string | null,
  hostRef: string | null,
  cookie: string | null | undefined,
): string | null {
  if (hostKind === 'subdomain') return parseBrandCookie(hostRef);
  if (hostKind === 'custom') return null;
  return parseBrandCookie(cookie);
}
