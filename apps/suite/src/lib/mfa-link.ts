/**
 * The links of the authenticator set-up e-mail (FR-IAM-12, T-M2-10; security review H1, TM-0003 T-IAM-11):
 * `/{ar|en}/mfa/confirm#token=…` makes a new app count, `/{ar|en}/mfa/remove#token=…` ("not you?") removes it
 * and ends every session of the account. As for invitations and password resets, the token travels in the
 * URL FRAGMENT (never sent to a server, so in no access log, proxy or Referer header): the page reads it in
 * the browser, removes it from the address bar at once and sends it only in the body of its server action,
 * after a click (a mail scanner that opens the link changes nothing). Framework-free helpers.
 */
import { inviteFragment, inviteTokenFromHash } from './invite-link';

export const MFA_LINK_KINDS = ['confirm', 'remove'] as const;
export type MfaLinkKind = (typeof MFA_LINK_KINDS)[number];

/** What the database answered for a link (single use; the worker's links live 72 hours / 7 days). */
export type MfaLinkOutcome = 'confirmed' | 'removed' | 'expired' | 'invalid';

/** The token of a fragment such as `#token=…`; null when absent. */
export function mfaLinkTokenFromHash(hash: string): string | null {
  return inviteTokenFromHash(hash);
}

/** The fragment that carries a token (the language switch keeps the link working with it). */
export function mfaLinkFragment(token: string | null): string {
  return inviteFragment(token);
}

/** The page of a link kind in a language (fixed paths only: the pages never redirect elsewhere). */
export function mfaLinkPath(locale: string, kind: MfaLinkKind): string {
  return `/${locale}/mfa/${kind}`;
}
