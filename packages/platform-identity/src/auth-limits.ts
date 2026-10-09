import 'server-only';
import { createHash } from 'node:crypto';
import type { RateLimit, RateLimitCounter, RateLimitStore } from '@jadarat/platform-db';
import type { LogFields } from '@jadarat/platform-observability';

/**
 * Sign-in protection (T-M2-11, SCS-16; FR-IAM-13; TM-0003 T-IAM-01/03/25/27/31/32): the application's
 * limits in front of Supabase Auth — whose own per-IP limits see the app server's address, not the
 * visitor's — on the shared PostgreSQL limiter (ADR 0011 §4, platform-db rate-limit.ts). Framework-free;
 * the Next.js adapter (auth-next.ts) binds the store, the request's client and the logger.
 *
 *   sign-in       per ACCOUNT: 5 consecutive failures lock the typed e-mail for 15 minutes, existing
 *                 account or not (screen 6 defaults; a success clears the run, a completed password reset
 *                 unlocks); per CLIENT: failures and all attempts. Checked before Auth is asked; failures
 *                 counted after Auth refused. The same guard covers "sign in to accept" an invitation.
 *   password      My profile's current-password check: per user.
 *   reset         requests per client, then (allowed client only) per account; new-password submissions
 *                 per client (T-M2-08 numbers, now shared by every instance).
 *   invitations   link lookups and new-account sign-ups per client.
 *
 * Keys: the typed e-mail (trimmed, lower-case), the client's address (IPv6 by its /64; apps/suite
 * lib/client-ip.ts) or the user id — each hashed here with SHA-256 under a fixed domain prefix (the
 * limiter's `subject`) and again in the database with its own HMAC key. Nothing readable is sent to the
 * database, stored or logged: log lines carry the database's keyed references (`rk_…`) only.
 * Clients without a trusted address (self-hosted without JADARAT_CLIENT_IP_HEADER) share one key with
 * larger budgets.
 *
 * Failure policy when the limiter itself fails (docs/engineering/sign-in-protection.md): sign-in, the
 * password check, reset completions and new-account sign-ups FAIL CLOSED (RateLimiterUnavailableError →
 * the generic internal error with a correlation id; nothing reaches Auth); a reset request is treated as
 * limited (same answer, no e-mail); counting a failure Auth already refused, clearing after a success and
 * invitation link lookups fail open (logged) — they decide nothing about a credential.
 */

/** The visitor's rate-limit key: its address (IPv6 /64) when the platform gives a trusted one, else null. */
export interface RequestClient {
  readonly key: string | null;
}

const SUBJECT_DOMAIN = 'jadarat.rate-limit.v1';

function subject(kind: 'account' | 'client' | 'user', value: string): Buffer {
  return createHash('sha256').update(`${SUBJECT_DOMAIN}\n${kind}\n${value}`).digest();
}

/** An e-mail as Auth compares it: trimmed, Unicode NFC, lower-case. */
export function normalizeAccountKey(email: string): string {
  return email.trim().normalize('NFC').toLowerCase();
}

export function accountSubject(email: string): Buffer {
  return subject('account', normalizeAccountKey(email));
}

export function clientSubject(client: RequestClient): Buffer {
  return subject('client', client.key ?? 'unknown');
}

export function userSubject(userId: string): Buffer {
  return subject('user', userId.trim().toLowerCase());
}

/** Limiter buckets (database bucket names; also the `limit` field of security events). */
export const LIMIT_BUCKETS = {
  signInAccountFailures: 'sign_in.account_failures',
  signInClientFailures: 'sign_in.client_failures',
  signInClientAttempts: 'sign_in.client_attempts',
  passwordCheckUser: 'password_check.user',
  resetRequestClient: 'password_reset.request_client',
  resetRequestAccount: 'password_reset.request_account',
  resetCompletionClient: 'password_reset.completion_client',
  invitationLookupClient: 'invitation.lookup_client',
  invitationSignUpClient: 'invitation.sign_up_client',
} as const;

export interface AuthLimits {
  readonly signIn: {
    /** Consecutive failures per typed e-mail (screen 6: lock after 5, for 15 minutes). */
    readonly accountFailures: RateLimit;
    /** Failures per client, any account (password spraying from one address). */
    readonly clientFailures: RateLimit;
    /** Every attempt per client (protects Auth's shared budget, T-IAM-31). */
    readonly clientAttempts: RateLimit;
    /** Clients without a trusted address share one key: larger budgets. */
    readonly sharedClientFailures: RateLimit;
    readonly sharedClientAttempts: RateLimit;
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
}

const WINDOW = 15 * 60;

/**
 * Platform defaults (Tech Lead, T-M2-11). Sign-in per account follows the proposed organization defaults
 * of the security settings screen (5 failures, 15 minutes). Per client the budgets are wide enough for an
 * office behind one address (many people, few typos) and narrow enough to stop one source guessing.
 */
export const PLATFORM_AUTH_LIMITS: AuthLimits = {
  signIn: {
    accountFailures: { max: 5, windowSeconds: WINDOW },
    clientFailures: { max: 30, windowSeconds: WINDOW },
    clientAttempts: { max: 300, windowSeconds: WINDOW },
    sharedClientFailures: { max: 300, windowSeconds: WINDOW },
    sharedClientAttempts: { max: 3000, windowSeconds: WINDOW },
  },
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
};

/**
 * Server setting for TESTS ONLY (the self-hosted smoke test): every window, lock included, lasts this many
 * seconds (1–3600) instead of 15 minutes. Unset in every real deployment; checked at start-up.
 */
export const AUTH_RATE_LIMIT_WINDOW_ENV = 'AUTH_RATE_LIMIT_WINDOW_SECONDS';

export function readAuthLimitWindowOverride(
  env: Readonly<Record<string, string | undefined>>,
): number | null {
  const raw = env[AUTH_RATE_LIMIT_WINDOW_ENV]?.trim() ?? '';
  if (raw === '') return null;
  const seconds = /^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error(
      `${AUTH_RATE_LIMIT_WINDOW_ENV} must be a whole number of seconds from 1 to 3600`,
    );
  }
  return seconds;
}

function withWindow<T>(group: T, windowSeconds: number): T {
  return Object.fromEntries(
    Object.entries(group as Record<string, RateLimit>).map(([name, limit]) => [
      name,
      { ...limit, windowSeconds },
    ]),
  ) as T;
}

/** Who the limits are for, as far as the flow knows it. */
export interface AuthLimitContext {
  /**
   * The organization whose security policy applies, when known (a tenant host, the session's or the
   * invitation's organization). Not used yet: platform defaults apply everywhere.
   */
  readonly tenantId?: string | null;
}

/**
 * The limits for a flow. INTEGRATION POINT for T-M2-10 (per-organization security policy — lockout
 * threshold and duration, FR-IAM-13, screen 6; TM-0003 D-IAM-04: platform default at the shared sign-in
 * host, the host organization's policy on its own host): read the organization's settings here for a
 * known `context.tenantId` and return them within the platform floors (TM-0003 T-IAM-24: lockout cannot
 * be disabled). Keep the result's shape; callers do not change.
 */
export function limitsFor(
  _context: AuthLimitContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthLimits {
  const window = readAuthLimitWindowOverride(env);
  if (window === null) return PLATFORM_AUTH_LIMITS;
  return {
    signIn: withWindow(PLATFORM_AUTH_LIMITS.signIn, window),
    passwordCheck: withWindow(PLATFORM_AUTH_LIMITS.passwordCheck, window),
    passwordReset: withWindow(PLATFORM_AUTH_LIMITS.passwordReset, window),
    invitation: withWindow(PLATFORM_AUTH_LIMITS.invitation, window),
  };
}

// ----- Security events (TM-0003 T-IAM-25; ADR 0009 §2: codes and keyed references only) -----

export type SecurityEventName =
  | 'auth.sign_in.failed'
  | 'auth.lockout'
  | 'auth.rate_limited'
  | 'auth.limiter.unavailable'
  | 'auth.password_change.failed';

export interface SecurityEvent {
  readonly event: SecurityEventName;
  /** The flow, e.g. `platform.auth.sign_in`. */
  readonly action: string;
  /** Stable code, e.g. `invalid_credentials`, a limit bucket, `fail_closed`. */
  readonly reason: string;
  readonly subjectRef?: string | undefined;
  readonly clientRef?: string | undefined;
  readonly limit?: string | undefined;
  readonly retryAfterS?: number | undefined;
  readonly errorName?: string | undefined;
  /** `auth_user` + the user id for events about a signed-in user (an allowed identifier). */
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly tenantId?: string | undefined;
}

export type SecurityLog = (event: SecurityEvent) => void;

const EVENT_MESSAGES: Readonly<Record<SecurityEventName, string>> = {
  'auth.sign_in.failed': 'sign-in refused',
  'auth.lockout': 'limit reached: further attempts are refused for a while',
  'auth.rate_limited': 'attempt refused by a rate limit',
  'auth.limiter.unavailable': 'rate limiter unavailable',
  'auth.password_change.failed': 'password change refused: current password',
};

/** The log line of a security event: its message, level and the closed logger fields. */
export function securityLogLine(event: SecurityEvent): {
  readonly level: 'warn' | 'error';
  readonly message: string;
  readonly fields: LogFields;
} {
  const optional = <K extends keyof SecurityEvent>(key: K) =>
    event[key] === undefined ? {} : { [key]: event[key] };
  const fields: LogFields = {
    action: event.action,
    securityEvent: event.event,
    reason: event.reason,
    outcome: event.event === 'auth.limiter.unavailable' ? 'failure' : 'denied',
    ...optional('subjectRef'),
    ...optional('clientRef'),
    ...optional('limit'),
    ...optional('retryAfterS'),
    ...optional('errorName'),
    ...optional('entityType'),
    ...optional('entityId'),
    ...optional('tenantId'),
  };
  return {
    level: event.event === 'auth.limiter.unavailable' ? 'error' : 'warn',
    message: EVENT_MESSAGES[event.event],
    fields,
  };
}

/**
 * The limiter could not answer and the flow fails closed. Thrown (not returned): the public action answers
 * the generic internal error with a correlation id, like an Auth outage; nothing reaches Auth.
 */
export class RateLimiterUnavailableError extends Error {
  override readonly name = 'RateLimiterUnavailableError';
  constructor() {
    super('the rate limiter could not answer');
  }
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/** What every limiter of a request is bound to. */
export interface LimiterDeps {
  readonly store: RateLimitStore;
  readonly limits: AuthLimits;
  readonly log: SecurityLog;
}

async function failClosed<T>(
  deps: LimiterDeps,
  action: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    deps.log({
      event: 'auth.limiter.unavailable',
      action,
      reason: 'fail_closed',
      errorName: errorNameOf(error),
    });
    throw new RateLimiterUnavailableError();
  }
}

// ----- Sign-in -----

export type SignInGate =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface SignInGuard {
  /**
   * Before Auth is asked: counts the attempt for the client and checks the failure counters of the client
   * and the typed account. Throws RateLimiterUnavailableError when the limiter cannot answer.
   */
  check(email: string): Promise<SignInGate>;
  /** Auth refused the credentials: one failure for the account and the client (never throws). */
  failed(email: string): Promise<void>;
  /** Auth accepted them: the account's run of consecutive failures ends (never throws). */
  succeeded(email: string): Promise<void>;
}

/** Records the security events of a hit that used a budget up (the lock starts now). */
function noteLockout(
  deps: LimiterDeps,
  action: string,
  limit: string,
  counter: RateLimitCounter,
  refs: { readonly subjectRef?: string; readonly clientRef?: string },
): void {
  if (counter.allowed && counter.remaining === 0) {
    deps.log({
      event: 'auth.lockout',
      action,
      reason: limit,
      limit,
      retryAfterS: counter.retryAfterSeconds,
      ...refs,
    });
  }
}

export function createSignInGuard(
  deps: LimiterDeps & { readonly client: RequestClient; readonly action: string },
): SignInGuard {
  const { store, client, action } = deps;
  const shared = client.key === null;
  const limits = deps.limits.signIn;
  const clientFailures = shared ? limits.sharedClientFailures : limits.clientFailures;
  const clientAttempts = shared ? limits.sharedClientAttempts : limits.clientAttempts;
  const clientKey = clientSubject(client);
  const B = LIMIT_BUCKETS;
  return {
    async check(email) {
      const [attempts, clientState, accountState] = await failClosed(deps, action, () =>
        Promise.all([
          store.hit(B.signInClientAttempts, clientKey, clientAttempts),
          store.peek(B.signInClientFailures, clientKey, clientFailures.max),
          store.peek(B.signInAccountFailures, accountSubject(email), limits.accountFailures.max),
        ]),
      );
      const refusals: [string, RateLimitCounter][] = [];
      if (!accountState.allowed) refusals.push([B.signInAccountFailures, accountState]);
      if (!clientState.allowed) refusals.push([B.signInClientFailures, clientState]);
      if (!attempts.allowed) refusals.push([B.signInClientAttempts, attempts]);
      const [first] = refusals;
      if (!first) return { allowed: true };
      const retryAfterSeconds = Math.max(...refusals.map(([, c]) => c.retryAfterSeconds));
      deps.log({
        event: 'auth.rate_limited',
        action,
        reason: first[0],
        limit: first[0],
        retryAfterS: retryAfterSeconds,
        subjectRef: accountState.ref,
        clientRef: attempts.ref,
      });
      return { allowed: false, retryAfterSeconds };
    },
    async failed(email) {
      try {
        const [account, fromClient] = await Promise.all([
          store.hit(B.signInAccountFailures, accountSubject(email), limits.accountFailures),
          store.hit(B.signInClientFailures, clientKey, clientFailures),
        ]);
        const refs = { subjectRef: account.ref, clientRef: fromClient.ref };
        deps.log({ event: 'auth.sign_in.failed', action, reason: 'invalid_credentials', ...refs });
        noteLockout(deps, action, B.signInAccountFailures, account, refs);
        noteLockout(deps, action, B.signInClientFailures, fromClient, refs);
      } catch (error) {
        // Auth has refused already; the answer stays "wrong e-mail or password". This failure is not
        // counted — the next attempt's check fails closed while the limiter is down.
        deps.log({
          event: 'auth.limiter.unavailable',
          action,
          reason: 'failure_not_counted',
          errorName: errorNameOf(error),
        });
      }
    },
    async succeeded(email) {
      try {
        await store.clear(B.signInAccountFailures, accountSubject(email));
      } catch (error) {
        deps.log({
          event: 'auth.limiter.unavailable',
          action,
          reason: 'failures_not_cleared',
          errorName: errorNameOf(error),
        });
      }
    },
  };
}

/**
 * A guard for flows that never check a password: any use is a programming error and fails closed (a new
 * sign-in path must bind the request's client).
 */
export const NO_SIGN_IN_GUARD: SignInGuard = {
  check: () => Promise.reject(new RateLimiterUnavailableError()),
  failed: () => Promise.resolve(),
  succeeded: () => Promise.resolve(),
};

/**
 * Ends an account's sign-in lock (a completed password reset: the owner proved control of the mailbox —
 * TM-0003 T-IAM-32 self-unlock). Never throws.
 */
export async function unlockSignIn(
  deps: LimiterDeps,
  action: string,
  email: string,
): Promise<void> {
  try {
    await deps.store.clear(LIMIT_BUCKETS.signInAccountFailures, accountSubject(email));
  } catch (error) {
    deps.log({
      event: 'auth.limiter.unavailable',
      action,
      reason: 'lock_not_cleared',
      errorName: errorNameOf(error),
    });
  }
}

// ----- My profile: current-password check -----

/** Counts a current-password check for the user; false = limited. Throws when the limiter fails. */
export function createPasswordCheckLimiter(
  deps: LimiterDeps & { readonly action: string },
): (userId: string) => Promise<boolean> {
  return async (userId) => {
    const counter = await failClosed(deps, deps.action, () =>
      deps.store.hit(
        LIMIT_BUCKETS.passwordCheckUser,
        userSubject(userId),
        deps.limits.passwordCheck.userAttempts,
      ),
    );
    if (counter.allowed) return true;
    deps.log({
      event: 'auth.rate_limited',
      action: deps.action,
      reason: LIMIT_BUCKETS.passwordCheckUser,
      limit: LIMIT_BUCKETS.passwordCheckUser,
      retryAfterS: counter.retryAfterSeconds,
      subjectRef: counter.ref,
      entityType: 'auth_user',
      entityId: userId,
    });
    return false;
  };
}

// ----- Password reset -----

export interface PasswordResetLimiter {
  /** Per client first, then — only for an allowed client — per account. Throws when the limiter fails. */
  allowRequest(email: string): Promise<boolean>;
  /** Per client. Throws when the limiter fails. */
  allowCompletion(): Promise<boolean>;
}

export function createPasswordResetLimiter(
  deps: LimiterDeps & {
    readonly client: RequestClient;
    readonly requestAction: string;
    readonly completeAction: string;
  },
): PasswordResetLimiter {
  const shared = deps.client.key === null;
  const limits = deps.limits.passwordReset;
  const clientKey = clientSubject(deps.client);
  const B = LIMIT_BUCKETS;
  const refused = (
    action: string,
    limit: string,
    counter: RateLimitCounter,
    clientRef?: string,
  ) => {
    deps.log({
      event: 'auth.rate_limited',
      action,
      reason: limit,
      limit,
      retryAfterS: counter.retryAfterSeconds,
      ...(limit === B.resetRequestAccount ? { subjectRef: counter.ref } : {}),
      clientRef: clientRef ?? counter.ref,
    });
    return false;
  };
  return {
    async allowRequest(email) {
      const action = deps.requestAction;
      return failClosed(deps, action, async () => {
        const fromClient = await deps.store.hit(
          B.resetRequestClient,
          clientKey,
          shared ? limits.sharedClientRequests : limits.requestsPerClient,
        );
        // A refused client counts nowhere else: it cannot use up (or fill up) other accounts' budgets.
        if (!fromClient.allowed) return refused(action, B.resetRequestClient, fromClient);
        const account = await deps.store.hit(
          B.resetRequestAccount,
          accountSubject(email),
          limits.requestsPerAccount,
        );
        return account.allowed || refused(action, B.resetRequestAccount, account, fromClient.ref);
      });
    },
    async allowCompletion() {
      const action = deps.completeAction;
      const counter = await failClosed(deps, action, () =>
        deps.store.hit(
          B.resetCompletionClient,
          clientKey,
          shared ? limits.sharedClientCompletions : limits.completionsPerClient,
        ),
      );
      return counter.allowed || refused(action, B.resetCompletionClient, counter);
    },
  };
}

// ----- Invitation links -----

export interface InvitationLimiter {
  /** Link lookups per client. Fails OPEN when the limiter fails (logged): a lookup checks no credential. */
  allowLookup(): Promise<boolean>;
  /** New-account sign-ups per client (each one is an Auth call). Throws when the limiter fails. */
  allowSignUp(): Promise<boolean>;
}

export function createInvitationLimiter(
  deps: LimiterDeps & {
    readonly client: RequestClient;
    readonly lookupAction: string;
    readonly signUpAction: string;
  },
): InvitationLimiter {
  const shared = deps.client.key === null;
  const limits = deps.limits.invitation;
  const clientKey = clientSubject(deps.client);
  const B = LIMIT_BUCKETS;
  const verdict = (action: string, limit: string, counter: RateLimitCounter) => {
    if (counter.allowed) return true;
    deps.log({
      event: 'auth.rate_limited',
      action,
      reason: limit,
      limit,
      retryAfterS: counter.retryAfterSeconds,
      clientRef: counter.ref,
    });
    return false;
  };
  return {
    async allowLookup() {
      let counter: RateLimitCounter;
      try {
        counter = await deps.store.hit(
          B.invitationLookupClient,
          clientKey,
          shared ? limits.sharedClientLookups : limits.lookupsPerClient,
        );
      } catch (error) {
        deps.log({
          event: 'auth.limiter.unavailable',
          action: deps.lookupAction,
          reason: 'fail_open',
          errorName: errorNameOf(error),
        });
        return true;
      }
      return verdict(deps.lookupAction, B.invitationLookupClient, counter);
    },
    async allowSignUp() {
      const counter = await failClosed(deps, deps.signUpAction, () =>
        deps.store.hit(
          B.invitationSignUpClient,
          clientKey,
          shared ? limits.sharedClientSignUps : limits.signUpsPerClient,
        ),
      );
      return verdict(deps.signUpAction, B.invitationSignUpClient, counter);
    },
  };
}
