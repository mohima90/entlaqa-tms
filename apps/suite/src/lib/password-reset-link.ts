/**
 * The password-reset link on screen 11 (FR-IAM-13, T-M2-08). Auth's e-mail links to
 * `/{ar|en}/reset-password#token_hash=…&type=recovery`: the token is in the URL FRAGMENT, which browsers
 * never send with a request (no access log, proxy or Referer header — as for invitations, review M3).
 * The page reads it in the browser, removes it from the address bar at once and sends it only in the
 * body of its server action. Framework-free helpers (used by the client components and pages).
 */

/** The recovery token of a fragment such as `#token_hash=…&type=recovery`; null when absent. */
export function resetTokenFromHash(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment === '') return null;
  const params = new URLSearchParams(fragment);
  // Only a recovery link: another kind of Auth link (sign-up, e-mail change) is not ours to use.
  if (params.get('type') !== 'recovery') return null;
  const token = params.get('token_hash');
  return token === null || token === '' ? null : token;
}

/** The fragment that carries a token (the language switch keeps the link working with it). */
export function resetFragment(token: string | null): string {
  return token ? `#token_hash=${encodeURIComponent(token)}&type=recovery` : '';
}

/** Seconds before "send again" is offered (Auth sends one link a minute per account). */
export const RESEND_WAIT_SECONDS = 60;

/** `m:ss` for the resend countdown (as in the approved screen: «إعادة الإرسال (بعد 0:45)»). */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Answers after which the link cannot be used again — expired/used/unknown, or Auth refused the new
 * password after the single-use link was spent: the page shows "request a new link" with the reason.
 */
const LINK_SPENT: ReadonlySet<string> = new Set([
  'PASSWORD_RESET_LINK_INVALID',
  'PASSWORD_RESET_SAME_PASSWORD',
  'PASSWORD_RESET_WEAK_PASSWORD',
  'PASSWORD_RESET_BREACHED_PASSWORD',
  'PASSWORD_RESET_PASSWORD_REJECTED',
  // Shorter than the account's organizations ask (T-M2-10): known only once the link was used.
  'PASSWORD_RESET_TOO_SHORT',
]);

export function linkIsSpent(errorCode: string): boolean {
  return LINK_SPENT.has(errorCode);
}

/** The notice the sign-in page shows after a password reset (`?notice=password-reset`). */
export const PASSWORD_RESET_NOTICE = 'password-reset';

/** Where to go once the new password is set: sign in with it. */
export function pathAfterReset(locale: string): string {
  return `/${locale}/sign-in?notice=${PASSWORD_RESET_NOTICE}`;
}

/**
 * The notice after a sign-in session ended (T-M2-10: inactivity, maximum length, device limit, signed out
 * from another device or by a user manager) — the session-ended route signed it out first.
 */
export const SESSION_ENDED_NOTICE = 'session-ended';

/** The known notice in a page's search parameters, if any (anything else is ignored). */
export function noticeFrom(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): typeof PASSWORD_RESET_NOTICE | typeof SESSION_ENDED_NOTICE | null {
  if (searchParams.notice === PASSWORD_RESET_NOTICE) return PASSWORD_RESET_NOTICE;
  return searchParams.notice === SESSION_ENDED_NOTICE ? SESSION_ENDED_NOTICE : null;
}
