/**
 * The invitation link on the accept page (FR-IAM-03, T-M2-07; security review M3). The e-mailed link
 * carries its token in the URL FRAGMENT (`/[locale]/invite/accept#token=…`): browsers never send the
 * fragment with a request, so the token stays out of access logs, proxies, analytics and Referer
 * headers. The page reads it in the browser, removes it from the address bar at once and sends it only
 * in the body of its server actions. Framework-free helpers (used by the client component).
 */

/** The token in a URL fragment such as `#token=…` (the `hash` of `location`); null when absent. */
export function inviteTokenFromHash(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment === '') return null;
  const token = new URLSearchParams(fragment).get('token');
  return token === null || token === '' ? null : token;
}

/** The fragment that carries a token (the language switch keeps the link working with it). */
export function inviteFragment(token: string | null): string {
  return token ? `#token=${encodeURIComponent(token)}` : '';
}

/**
 * The invitation code in the sign-up link's fragment (`#code=K7M2PQ9X`, Kawadir's link, PO 16 Oct 2026),
 * or the token of an older `/invite/accept#token=…` link; null when absent. Never sent to the server with
 * a page request (review M3): the page reads it, removes it from the address bar and sends it only in the
 * body of its server actions.
 */
export function inviteCodeFromHash(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment === '') return null;
  const params = new URLSearchParams(fragment);
  const code = params.get('code') ?? params.get('token');
  return code === null || code.trim() === '' ? null : code.trim();
}

/** The fragment that carries a code (the language switch and the forwarder keep the link working). */
export function signUpFragment(code: string | null): string {
  return code ? `#code=${encodeURIComponent(code)}` : '';
}

/**
 * The link an administrator copies (Kawadir's «نسخ الرابط»): the app's own origin, the invitation's
 * language, the sign-up page and the code in the fragment.
 */
export function inviteLink(origin: string, locale: 'ar' | 'en', code: string): string {
  let base = origin;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}/${locale}/sign-up${signUpFragment(code)}`;
}

/** Fills the `{organization}` placeholder of a raw message (the only argument these messages take). */
export function withOrganization(template: string, organization: string): string {
  return template.split('{organization}').join(organization);
}

/** A raw message split around its first `<tag>…</tag>` part (rich text without a client i18n runtime). */
export function splitTaggedMessage(
  template: string,
  tag: 'link' | 'b',
): { readonly before: string; readonly inner: string; readonly after: string } {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = template.indexOf(open);
  const end = start === -1 ? -1 : template.indexOf(close, start + open.length);
  if (end === -1) return { before: template, inner: '', after: '' };
  return {
    before: template.slice(0, start),
    inner: template.slice(start + open.length, end),
    after: template.slice(end + close.length),
  };
}

/** A raw message split around its `<link>…</link>` part (rich text without a client i18n runtime). */
export function splitLinkMessage(template: string): {
  readonly before: string;
  readonly link: string;
  readonly after: string;
} {
  const { before, inner, after } = splitTaggedMessage(template, 'link');
  return { before, link: inner, after };
}
