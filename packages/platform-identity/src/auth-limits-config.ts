import type { RateLimit } from '@jadarat/platform-db';

/**
 * Every sign-in protection budget in one place (PO decision 9 Oct 2026: one config; T-M2-11, FR-IAM-13,
 * SCS-16). Plain data without `server-only`, so the worker (the lockout e-mail's caps) reads the same
 * values as the web app; auth-limits.ts re-exports it. docs/engineering/sign-in-protection.md §1.
 */

export interface SignInLimits {
  /** Consecutive failures per typed e-mail from browsers it does not trust (screen 6: 5, for 15 minutes). */
  readonly accountFailures: RateLimit;
  /** Failures per trusted browser of an account — the account's lock does not apply to it. */
  readonly deviceFailures: RateLimit;
  /** Wrong passwords per client address, any account (password spraying); successes are given back. */
  readonly clientFailures: RateLimit;
  /** Every attempt per client address (protects Auth's shared budget, T-IAM-31). */
  readonly clientAttempts: RateLimit;
  /** Clients without a trusted address share one key: larger budgets. */
  readonly sharedClientFailures: RateLimit;
  readonly sharedClientAttempts: RateLimit;
}

export interface AuthLimits {
  readonly signIn: SignInLimits;
  /**
   * How long a browser stays trusted (PO decision 9 Oct 2026: opt-in). `days`: after a sign-in — or a
   * completed password reset — with «تذكّر هذا المتصفح» / "Remember this browser" ticked (screen 6: 30
   * days); sliding, renewed by ticked sign-ins only — an unticked one leaves the trust to end on its date.
   * `resetDays`: after a completed reset with the box NOT ticked — 1 (24 hours), enough for the owner to
   * ride out a lock attack (security review M2) without remembering the browser unasked (re-review N1). A
   * longer trust the browser already has is never shortened.
   */
  readonly trustedDevice: { readonly days: number; readonly resetDays: number };
  /**
   * The "account locked" e-mail (security review T-M2-11 M3; the worker enforces both): at most one per
   * person in `personQuietHours`, and at most `tenantPerHour` per organization an hour (a spray against a
   * whole organization must not become a mail flood). Beyond them the lock still applies; only the e-mail
   * is left out.
   */
  readonly lockoutMail: {
    readonly personQuietHours: number;
    readonly tenantPerHour: number;
  };
  readonly passwordCheck: {
    /** My profile current-password checks per user. */
    readonly userAttempts: RateLimit;
  };
  readonly passwordReset: {
    readonly requestsPerClient: RateLimit;
    readonly requestsPerAccount: RateLimit;
    readonly completionsPerClient: RateLimit;
    readonly sharedClientRequests: RateLimit;
    readonly sharedClientCompletions: RateLimit;
  };
  readonly invitation: {
    readonly lookupsPerClient: RateLimit;
    readonly signUpsPerClient: RateLimit;
    readonly sharedClientLookups: RateLimit;
    readonly sharedClientSignUps: RateLimit;
  };
  /**
   * Authenticator-app codes (T-M2-10 security review, TM-0003 T-IAM-12): wrong codes only, as for
   * passwords — per account (consecutive, a success ends the run) and per client address.
   */
  readonly mfaCode: {
    readonly accountFailures: RateLimit;
    readonly clientFailures: RateLimit;
    readonly sharedClientFailures: RateLimit;
  };
}

const WINDOW = 15 * 60;

/**
 * Platform defaults (PO decisions 9 Oct 2026; Tech Lead, T-M2-11). Sign-in per account follows the
 * proposed organization defaults of the security settings screen (5 failures, 15 minutes); a trusted
 * browser gets 10 per 15 minutes. Per client: 100 wrong passwords per 15 minutes — wide enough for an
 * office behind one address — and 1,000 attempts (only Auth's shared budget needs it). The Organization
 * Admin's unlock (3 per account a day) is the database's own rule (migration 20261013090100).
 */
export const PLATFORM_AUTH_LIMITS: AuthLimits = {
  signIn: {
    accountFailures: { max: 5, windowSeconds: WINDOW },
    deviceFailures: { max: 10, windowSeconds: WINDOW },
    clientFailures: { max: 100, windowSeconds: WINDOW },
    clientAttempts: { max: 1000, windowSeconds: WINDOW },
    sharedClientFailures: { max: 1000, windowSeconds: WINDOW },
    sharedClientAttempts: { max: 10_000, windowSeconds: WINDOW },
  },
  trustedDevice: { days: 30, resetDays: 1 },
  lockoutMail: { personQuietHours: 24, tenantPerHour: 50 },
  passwordCheck: { userAttempts: { max: 5, windowSeconds: WINDOW } },
  passwordReset: {
    requestsPerClient: { max: 10, windowSeconds: WINDOW },
    requestsPerAccount: { max: 3, windowSeconds: WINDOW },
    completionsPerClient: { max: 5, windowSeconds: WINDOW },
    sharedClientRequests: { max: 100, windowSeconds: WINDOW },
    sharedClientCompletions: { max: 100, windowSeconds: WINDOW },
  },
  invitation: {
    lookupsPerClient: { max: 60, windowSeconds: WINDOW },
    signUpsPerClient: { max: 10, windowSeconds: WINDOW },
    sharedClientLookups: { max: 600, windowSeconds: WINDOW },
    sharedClientSignUps: { max: 100, windowSeconds: WINDOW },
  },
  mfaCode: {
    accountFailures: { max: 5, windowSeconds: WINDOW },
    clientFailures: { max: 100, windowSeconds: WINDOW },
    sharedClientFailures: { max: 1000, windowSeconds: WINDOW },
  },
};
