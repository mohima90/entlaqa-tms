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
   * longer trust the browser already has is never shortened. `codeWaitMinutes` (integration review L4):
   * for an account with an authenticator app, a ticked sign-in trusts the browser only once the session's
   * sign-in code passed — the tick waits this long for it (server-side, bound to the Auth session).
   */
  readonly trustedDevice: {
    readonly days: number;
    readonly resetDays: number;
    readonly codeWaitMinutes: number;
  };
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
  /**
   * Invitation links (T-M2-11; integration review M3 with T-M2-12). A bulk import invites many people who
   * may share one address (an office), so each link has its own small budget — keyed on the link's token
   * hash, never the token — and the address only a ceiling that a whole office accepting at once stays
   * under. Lookups and sign-ups of a malformed link count against the address only.
   */
  readonly invitation: {
    readonly lookupsPerInvitation: RateLimit;
    readonly lookupsPerClient: RateLimit;
    readonly signUpsPerInvitation: RateLimit;
    readonly signUpsPerClient: RateLimit;
    readonly sharedClientLookups: RateLimit;
    readonly sharedClientSignUps: RateLimit;
    /**
     * Unknown codes per client (invitation codes, PO 16 Oct 2026: 12 characters, 60 random bits — unlike
     * the 256-bit tokens before them, guessable in principle; security review H1). Every code that reaches
     * the database counts as a miss until it turns out to be a real invitation's (then it is given back):
     * a client trying codes is stopped after a few misses, an office checking its own invitations is not.
     * An IPv6 client is counted by its /48 (a site's whole allocation), not its /64.
     */
    readonly codeMissesPerClient: RateLimit;
    readonly sharedClientCodeMisses: RateLimit;
    /**
     * Unknown codes of ALL clients together (security review H1): the ceiling a distributed guesser —
     * many addresses, each under its own budget — runs into. Fails closed: once it is used up, every code
     * lookup is refused (RATE_LIMITED) until the window ends, and a warning is logged
     * (`auth.invitation_codes.global_limit`). Real invitations give their miss back, so normal use never
     * comes near it.
     */
    readonly codeMissesAllClients: RateLimit;
  };
  /**
   * Authenticator-app codes (T-M2-10 security review, TM-0003 T-IAM-12): wrong codes only, as for
   * passwords — per account (consecutive, a success ends the run) and per client address.
   * `accountFailures` counts the codes of a signed-in session (sign-in, a sensitive action, the e-mailed
   * set-up code): only someone who knows the password reaches them. The password-reset page's code has its
   * own account budget, `resetFailures` (integration review T-M2-11 M1): wrong codes after the password
   * cannot also lock the owner out of resetting it.
   */
  readonly mfaCode: {
    readonly accountFailures: RateLimit;
    readonly resetFailures: RateLimit;
    readonly clientFailures: RateLimit;
    readonly sharedClientFailures: RateLimit;
  };
  /**
   * «Email me a code» (WP-ADM-05, PO 23 Oct 2026). Requests: the database allows one code a minute per
   * address; these are the ceilings per client and per typed address on top. Checks: wrong codes only, per
   * typed address (consecutive; a right code ends the run) and per client — the 5th wrong code pauses code
   * checks for the window (15 minutes), as the database kills the code itself after 5 tries.
   */
  readonly signInCode: {
    readonly requestsPerClient: RateLimit;
    readonly sharedClientRequests: RateLimit;
    readonly requestsPerAccount: RateLimit;
    readonly checkAccountFailures: RateLimit;
    readonly checkClientFailures: RateLimit;
    readonly sharedClientCheckFailures: RateLimit;
    /** On top of `requestsPerAccount`: the most code requests per typed address in a day. */
    readonly requestsPerAccountDaily: RateLimit;
    /**
     * Wrong codes from ALL clients together (security review M2, as the unknown invitation codes): the defence
     * against guessing spread over many addresses. When it is used up, code checks are refused for everybody
     * until the window ends (`auth.sign_in_codes.global_limit` is logged). Right codes give their hit back.
     */
    readonly checkWrongAllClients: RateLimit;
    /** A remembered browser's own budget of wrong codes - it is not stopped by the typed address's pause. */
    readonly checkRememberedBrowserFailures: RateLimit;
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
  trustedDevice: { days: 30, resetDays: 1, codeWaitMinutes: 15 },
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
    lookupsPerInvitation: { max: 30, windowSeconds: WINDOW },
    lookupsPerClient: { max: 600, windowSeconds: WINDOW },
    signUpsPerInvitation: { max: 5, windowSeconds: WINDOW },
    signUpsPerClient: { max: 200, windowSeconds: WINDOW },
    sharedClientLookups: { max: 6000, windowSeconds: WINDOW },
    sharedClientSignUps: { max: 2000, windowSeconds: WINDOW },
    codeMissesPerClient: { max: 20, windowSeconds: WINDOW },
    sharedClientCodeMisses: { max: 500, windowSeconds: WINDOW },
    codeMissesAllClients: { max: 2000, windowSeconds: WINDOW },
  },
  mfaCode: {
    accountFailures: { max: 5, windowSeconds: WINDOW },
    resetFailures: { max: 5, windowSeconds: WINDOW },
    clientFailures: { max: 100, windowSeconds: WINDOW },
    sharedClientFailures: { max: 1000, windowSeconds: WINDOW },
  },
  signInCode: {
    requestsPerClient: { max: 20, windowSeconds: WINDOW },
    sharedClientRequests: { max: 200, windowSeconds: WINDOW },
    requestsPerAccount: { max: 10, windowSeconds: WINDOW },
    checkAccountFailures: { max: 5, windowSeconds: WINDOW },
    checkClientFailures: { max: 100, windowSeconds: WINDOW },
    sharedClientCheckFailures: { max: 1000, windowSeconds: WINDOW },
    requestsPerAccountDaily: { max: 40, windowSeconds: 24 * 60 * 60 },
    checkWrongAllClients: { max: 2000, windowSeconds: WINDOW },
    checkRememberedBrowserFailures: { max: 10, windowSeconds: WINDOW },
  },
};
