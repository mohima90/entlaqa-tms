/**
 * What the /mfa page shows (FR-IAM-12, T-M2-10; screens 6 and 8 step 2). Framework-free and client-safe.
 *
 *   challenge          a code from the account's app — the organization requires it at sign-in (the
 *                      database refuses the session until then), or a sensitive action asked for it (step-up),
 *                      also when the last code is older than 15 minutes (review L3)
 *   enrol              an app must be set up first (required by the organization, grace over; or a sensitive
 *                      action asked for a code and the account has no app yet)
 *   pending            THIS window set an app up and it waits for the e-mailed code (re-review N1): enter the
 *                      code here; "send the e-mail again"; cancel the set-up
 *   pending-elsewhere  an app was added from ANOTHER sign-in and nobody entered its code: "an app was added
 *                      from another sign-in on … with …" — Remove (main; the account's other sessions end)
 *                      or "it was me" (finish in that window)
 *   prompt-grace       covered by a requirement, grace period running: set one up, or continue for now
 *   prompt-admin       PO decision 2: an Organization Admin without an app is invited; "not now" is asked
 *                      again after 30 days (PO answer, 9 Oct 2026)
 *   done               nothing to do: continue to `next` (or the suite)
 *
 * An app waiting for its code is shown whenever the page is reached (the sign-in sends every session of such
 * an account here), also when nothing requires an app — never a new set-up while one waits.
 */
import type { SessionAccessState } from '@jadarat/platform-db';

export type MfaPageMode =
  | 'challenge'
  | 'enrol'
  | 'pending'
  | 'pending-elsewhere'
  | 'prompt-grace'
  | 'prompt-admin'
  | 'done';

export interface MfaPageFacts {
  readonly state: SessionAccessState;
  /** The account uses a CONFIRMED app (the database). */
  readonly usesApp: boolean;
  /** An app set up by THIS window waits for its e-mailed code (the database). */
  readonly pendingHere: boolean;
  /** An app added from ANOTHER sign-in waits for its code (the database). */
  readonly pendingElsewhere: boolean;
  /**
   * The session passed a code from the confirmed app (the database's AAL2) recently enough for a
   * sensitive action (STEP_UP_MAX_AGE_SECONDS).
   */
  readonly verified: boolean;
  /** A sensitive action sent the member here (`?next=`). */
  readonly stepUp: boolean;
}

export function mfaPageMode(facts: MfaPageFacts): MfaPageMode {
  // Another sign-in's app first: the owner must see it before anything else (re-review N1).
  const waiting: MfaPageMode | null = facts.pendingElsewhere
    ? 'pending-elsewhere'
    : facts.pendingHere
      ? 'pending'
      : null;
  switch (facts.state) {
    case 'mfa_challenge':
      return facts.usesApp ? 'challenge' : (waiting ?? 'enrol');
    case 'mfa_enrol':
      return waiting ?? 'enrol';
    case 'prompt_grace':
      return waiting ?? (facts.stepUp ? 'enrol' : 'prompt-grace');
    case 'prompt_admin':
      return waiting ?? (facts.stepUp ? 'enrol' : 'prompt-admin');
    case 'ok':
      if (facts.usesApp) return facts.stepUp && !facts.verified ? 'challenge' : 'done';
      return waiting ?? (facts.stepUp ? 'enrol' : 'done');
    default:
      return 'done';
  }
}

/**
 * On the pending pages: may the member continue without the app for now — a prompt or no requirement at all,
 * and no sensitive action waiting for a code?
 */
export function mayContinueWithoutApp(state: SessionAccessState, stepUp: boolean): boolean {
  return !stepUp && (state === 'prompt_grace' || state === 'prompt_admin' || state === 'ok');
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
