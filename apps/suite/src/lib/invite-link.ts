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

/** Fills the `{organization}` placeholder of a raw message (the only argument these messages take). */
export function withOrganization(template: string, organization: string): string {
  return template.split('{organization}').join(organization);
}

/** A raw message split around its `<link>…</link>` part (rich text without a client i18n runtime). */
export function splitLinkMessage(template: string): {
  readonly before: string;
  readonly link: string;
  readonly after: string;
} {
  const match = /^([\s\S]*?)<link>([\s\S]*?)<\/link>([\s\S]*)$/.exec(template);
  return match
    ? { before: match[1] ?? '', link: match[2] ?? '', after: match[3] ?? '' }
    : { before: template, link: '', after: '' };
}
