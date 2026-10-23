/**
 * The two-step sign-in (Kawadir ATS, PO 16 Oct 2026): the e-mail first, then the way in. Client-safe
 * helpers of components/auth/sign-in-form.tsx.
 */

/**
 * The ways in after the e-mail. Only the password today; the e-mailed sign-in code joins with the
 * platform's own e-mail sender (FR-ADM-17) — then the method step offers both and the last one used opens
 * directly (Kawadir: remembering "code" never sends a code by itself).
 */
export const SIGN_IN_METHODS = ['password'] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/** Browser storage key of the last method used (no account data: only the method's name). */
export const SIGN_IN_METHOD_KEY = 'jadarat.sign-in.method';

/** A plausible e-mail before the password step (the server validates again; this only catches typos). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254;
}

function isMethod(value: unknown): value is SignInMethod {
  return typeof value === 'string' && (SIGN_IN_METHODS as readonly string[]).includes(value);
}

/** The method used last on this browser, else the first one. Storage errors are ignored. */
export function readPreferredMethod(
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): SignInMethod {
  try {
    const stored = storage?.getItem(SIGN_IN_METHOD_KEY);
    return isMethod(stored) ? stored : SIGN_IN_METHODS[0];
  } catch {
    return SIGN_IN_METHODS[0];
  }
}

/** Remembers the method for this browser. Storage errors are ignored. */
export function rememberMethod(
  method: SignInMethod,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(SIGN_IN_METHOD_KEY, method);
  } catch {
    // Private mode or storage disabled: nothing to remember.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** What the sign-in outcome (`next`) opens: the page for each. Shared by the password and the e-mailed-code ways. */
const DESTINATIONS = {
  home: '/suite',
  // The organization asks for an authenticator code or app first (T-M2-10) - after BOTH ways in alike.
  mfa: '/mfa',
  'choose-organization': '/select-organization',
  // A Platform Super Admin without organizations (FR-ADM-17).
  platform: '/platform',
} as const;

export function signInDestination(
  locale: string,
  next: 'home' | 'mfa' | 'choose-organization' | 'platform',
): string {
  return `/${locale}${DESTINATIONS[next]}`;
}
