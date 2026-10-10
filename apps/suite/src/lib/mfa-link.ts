/**
 * The "not you? remove this app" link of the authenticator set-up e-mail (FR-IAM-12, T-M2-10; security review
 * H1, TM-0003 T-IAM-11): `/{ar|en}/mfa/remove#token=…` removes that app and ends every session of the account.
 * (The app itself is confirmed with the e-mailed CODE in the window that set it up — re-review N1 — never with
 * a link.) As for invitations and password resets, the token travels in the URL FRAGMENT (never sent to a
 * server, so in no access log, proxy or Referer header): the page reads it in the browser, removes it from
 * the address bar at once and sends it only in the body of its server action, after a click (a mail
 * scanner that opens the link changes nothing). Framework-free helpers.
 */
import { inviteFragment, inviteTokenFromHash } from './invite-link';

/** What the database answered for the link (single use; it lives 7 days). */
export type MfaLinkOutcome = 'removed' | 'expired' | 'invalid';

/** The token of a fragment such as `#token=…`; null when absent. */
export function mfaLinkTokenFromHash(hash: string): string | null {
  return inviteTokenFromHash(hash);
}

/** The fragment that carries a token (the language switch keeps the link working with it). */
export function mfaLinkFragment(token: string | null): string {
  return inviteFragment(token);
}

/** The link's page in a language (a fixed path: the page never redirects elsewhere). */
export function mfaLinkPath(locale: string): string {
  return `/${locale}/mfa/remove`;
}
