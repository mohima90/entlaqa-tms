/**
 * What the /mfa page shows (FR-IAM-12, T-M2-10; screens 6 and 8 step 2). Framework-free and client-safe.
 *
 *   challenge     a code from the account's app — the organization requires it at sign-in (the database
 *                 refuses the session until then), or a sensitive action asked for it (step-up), also when
 *                 the last code is older than 15 minutes (review L3)
 *   enrol         an app must be set up first (required by the organization, grace over; or a sensitive
 *                 action asked for a code and the account has no app yet)
 *   pending       an app was set up but waits for its e-mailed confirmation (review H1): it counts once the
 *                 link in the e-mail is opened; the page offers to send the e-mail again
 *   prompt-grace  covered by a requirement, grace period running: set one up, or continue for now
 *   prompt-admin  PO decision 2: an Organization Admin without an app is invited; "not now" is asked again
 *                 after 30 days (PO answer, 9 Oct 2026)
 *   done          nothing to do: continue to `next` (or the suite)
 */
import type { SessionAccessState } from '@jadarat/platform-db';

export type MfaPageMode =
  'challenge' | 'enrol' | 'pending' | 'prompt-grace' | 'prompt-admin' | 'done';

export interface MfaPageFacts {
  readonly state: SessionAccessState;
  /** The account uses a CONFIRMED app (the database). */
  readonly usesApp: boolean;
  /** An app waits for its e-mailed confirmation (the database). */
  readonly pending: boolean;
  /**
   * The session passed a code from the confirmed app (the database's AAL2) recently enough for a
   * sensitive action (STEP_UP_MAX_AGE_SECONDS).
   */
  readonly verified: boolean;
  /** A sensitive action sent the member here (`?next=`). */
  readonly stepUp: boolean;
}

export function mfaPageMode(facts: MfaPageFacts): MfaPageMode {
  const needsApp = (): MfaPageMode => (facts.pending ? 'pending' : 'enrol');
  switch (facts.state) {
    case 'mfa_challenge':
      return facts.usesApp ? 'challenge' : needsApp();
    case 'mfa_enrol':
      return needsApp();
    case 'prompt_grace':
      if (facts.pending) return 'pending';
      return facts.stepUp ? 'enrol' : 'prompt-grace';
    case 'prompt_admin':
      if (facts.pending) return 'pending';
      return facts.stepUp ? 'enrol' : 'prompt-admin';
    case 'ok':
      if (!facts.stepUp || facts.verified) return 'done';
      return facts.usesApp ? 'challenge' : needsApp();
    default:
      return 'done';
  }
}

/** On the pending page: may the member continue without the app for now (a prompt, not a requirement)? */
export function mayContinueWithoutApp(state: SessionAccessState, stepUp: boolean): boolean {
  return !stepUp && (state === 'prompt_grace' || state === 'prompt_admin');
}

/**
 * Where to go after the code: only a page of the suite in a known language (never another site or a
 * path the visitor made up). Linear pattern (no nested quantifiers).
 */
const NEXT_PATH = /^\/(ar|en)\/suite(\/[A-Za-z0-9_-]{1,64}){0,6}$/;

export function safeNextPath(value: unknown): string | null {
  return typeof value === 'string' && NEXT_PATH.test(value) ? value : null;
}

/** The /mfa link for a sensitive action on `path` (e.g. `/ar/suite/admin/security`). */
export function stepUpHref(locale: string, path: string): string {
  return `/${locale}/mfa?next=${encodeURIComponent(path)}`;
}
