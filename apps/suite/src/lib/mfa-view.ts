/**
 * What the /mfa page shows (FR-IAM-12, T-M2-10; screens 6 and 8 step 2). Framework-free and client-safe.
 *
 *   challenge     a code from the account's app — the organization requires it at sign-in (the database
 *                 refuses the session until then), or a sensitive action asked for it (step-up)
 *   enrol         an app must be set up first (required by the organization, grace over; or a sensitive
 *                 action asked for a code and the account has no app yet)
 *   prompt-grace  covered by a requirement, grace period running: set one up, or continue for now
 *   prompt-admin  PO decision 2: an Organization Admin without an app is invited; "not now" is remembered
 *   done          nothing to do: continue to `next` (or the suite)
 */
import type { SessionAccessState } from '@jadarat/platform-db';

export type MfaPageMode = 'challenge' | 'enrol' | 'prompt-grace' | 'prompt-admin' | 'done';

export interface MfaPageFacts {
  readonly state: SessionAccessState;
  readonly usesApp: boolean;
  readonly sessionVerified: boolean;
  /** A sensitive action sent the member here (`?next=`). */
  readonly stepUp: boolean;
}

export function mfaPageMode(facts: MfaPageFacts): MfaPageMode {
  switch (facts.state) {
    case 'mfa_challenge':
      return facts.usesApp ? 'challenge' : 'enrol';
    case 'mfa_enrol':
      return 'enrol';
    case 'prompt_grace':
      return facts.stepUp ? 'enrol' : 'prompt-grace';
    case 'prompt_admin':
      return facts.stepUp ? 'enrol' : 'prompt-admin';
    case 'ok':
      if (!facts.stepUp || facts.sessionVerified) return 'done';
      return facts.usesApp ? 'challenge' : 'enrol';
    default:
      return 'done';
  }
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
