import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { type AppError, type Result, appError, err } from '@jadarat/platform-core';
import type {
  RateLimit,
  RateLimitCounter,
  RateLimitStore,
  SignInBudgets,
  SignInCheck,
} from '@jadarat/platform-db';
import type { LogFields } from '@jadarat/platform-observability';
import { type AuthLimits, PLATFORM_AUTH_LIMITS, type SignInLimits } from './auth-limits-config';

export { type AuthLimits, PLATFORM_AUTH_LIMITS, type SignInLimits } from './auth-limits-config';

/**
 * Sign-in protection (T-M2-11, SCS-16; FR-IAM-13; TM-0003 T-IAM-01/03/25/27/31/32; PO decisions 9 Oct
 * 2026): the application's limits in front of Supabase Auth — whose own per-IP limits see the app server's
 * address, not the visitor's — on the shared PostgreSQL limiter (ADR 0011 §4, platform-db rate-limit.ts).
 * Framework-free; the Next.js adapter (auth-next.ts) binds the store, the request's client, the browser's
 * trusted-device cookie and the logger.
 *
 *   sign-in       counted BEFORE Auth is asked, in one database call (security review T-M2-11): per
 *                 ACCOUNT, 5 consecutive failures lock the typed e-mail for 15 minutes for browsers it
 *                 does not trust, existing account or not (screen 6 defaults; a success ends the run, a
 *                 completed password reset or the Organization Admin unlocks); a browser the account
 *                 TRUSTS — it signed in with «تذكّر هذا المتصفح» / "Remember this browser" ticked (opt-in,
 *                 PO decision 9 Oct 2026; 30 days, renewed by ticked sign-ins only) or completed a password
 *                 reset — is not stopped by that lock but has its own budget (10 per 15 minutes); per
 *                 CLIENT address, 100 wrong passwords per 15 minutes (successes are given back) and 1,000
 *                 attempts (Auth's shared budget). When the account's — or a trusted browser's — budget is
 *                 used up, the "account locked" e-mail is requested (the worker decides whether an account
 *                 exists, and sends at most one a day). Auth's own 429 gives the account's (or browser's)
 *                 failure back: no password was compared. The same guard covers "sign in to accept".
 *   password      My profile's current-password check: per user.
 *   reset         requests per client, then (allowed client only) per account; new-password submissions
 *                 per client (T-M2-08 numbers, now shared by every instance).
 *   invitations   link lookups and new-account sign-ups per client.
 *
 * Keys: the typed e-mail (trimmed, NFC, lower-cased as Auth does — accountSubject), the client's address (IPv6 by its /64; apps/suite
 * lib/client-ip.ts), the user id or the browser's random token — each hashed here with SHA-256 under a
 * fixed domain prefix (the limiter's `subject`) and again in the database with its own HMAC key. Nothing
 * readable is sent to the database, stored or logged: log lines carry the database's keyed references
 * (`rk_…`, from a separate log key) only. Clients without a trusted address (self-hosted without
 * JADARAT_CLIENT_IP_HEADER) share one key with larger budgets — a misconfiguration the app reports at
 * start-up (apps/suite lib/server-settings.ts).
 *
 * Failure policy when the limiter itself fails (docs/engineering/sign-in-protection.md): sign-in, the
 * password check, reset completions and new-account sign-ups FAIL CLOSED (RateLimiterUnavailableError →
 * the generic internal error with a correlation id; nothing reaches Auth); a reset request is treated as
 * limited (same answer, no e-mail); recording a success, giving a failure back after Auth's 429, the
 * lockout e-mail request, the unlock after a reset, forgetting the other browsers after a password change
 * and invitation link lookups fail open (logged) — they decide nothing about a credential.
 */

/** The visitor's rate-limit key: its address (IPv6 /64) when the platform gives a trusted one, else null. */
export interface RequestClient {
  readonly key: string | null;
}

const SUBJECT_DOMAIN = 'jadarat.rate-limit.v1';

function subject(kind: 'account' | 'client' | 'user' | 'device', value: string): Buffer {
  return createHash('sha256').update(`${SUBJECT_DOMAIN}\n${kind}\n${value}`).digest();
}

/**
 * An e-mail as Auth compares it: trimmed, Unicode NFC, lower-case — with Go's simple case mapping of İ
 * (U+0130) → i and Σ (U+03A3) → σ, where JavaScript's full mapping gives i + U+0307 and, at the end of a
 * word, ς (GoTrue lower-cases with strings.ToLower). Without them, typing İ for an i would reach the same
 * account at Auth but count against another subject — a fresh failure budget (security review T-M2-11).
 * The database normalises the same way (private.rate_limit_normalize_email).
 */
export function normalizeAccountKey(email: string): string {
  return email
    .trim()
    .normalize('NFC')
    .replaceAll('\u0130', 'i')
    .replaceAll('\u03A3', '\u03C3')
    .toLowerCase();
}

/** Printable ASCII only (space to tilde). */
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

/**
 * The key every address that is not printable ASCII after normalisation shares (a newline first: no
 * printable address can equal it).
 */
const NON_ASCII_ACCOUNT_KEY = '\nnon-ascii';

/**
 * The typed account's subject. Guard (security review T-M2-11): an address that is still not printable
 * ASCII after normalisation gets ONE shared subject. Auth accepts ASCII addresses only (GoTrue validates
 * sign-ups against an ASCII pattern, and the app's forms use z.email()), so no account is affected — and
 * any case-mapping difference left between JavaScript and Go (another Unicode version, a character not
 * mapped above) cannot give an attacker a fresh account budget per spelling: all of them share one.
 * The database derives the same from an Auth address for the Organization Admin's unlock
 * (private.rate_limit_account_subject; shared test vectors in auth-limits.test.ts and supabase/tests/72).
 */
export function accountSubject(email: string): Buffer {
  const key = normalizeAccountKey(email);
  return subject('account', PRINTABLE_ASCII.test(key) ? key : NON_ASCII_ACCOUNT_KEY);
}

export function clientSubject(client: RequestClient): Buffer {
  return subject('client', client.key ?? 'unknown');
}

export function userSubject(userId: string): Buffer {
  return subject('user', userId.trim().toLowerCase());
}

// ----- Trusted browsers (PO decision 9 Oct 2026; screen 6 «تذكّر الجهاز الموثوق»; TM-0003 IA-02) -----

/** A browser's trusted-device token: 32 random bytes, base64url without padding (43 characters). */
export const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new random token for a browser that has none (sent only in the HttpOnly cookie). */
export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function deviceSubject(token: string): Buffer {
  return subject('device', token);
}

/**
 * The browser's trusted-device cookie (auth-next.ts: HttpOnly, Secure, SameSite=Lax, `__Host-` prefix).
 * It holds a random token only — never the account; the database knows which accounts trust it (keyed
 * hashes). One cookie per browser serves every account that signed in with it.
 */
export interface TrustedDeviceCookie {
  /** The browser's token when it sent a well-formed one, else null. */
  read(): string | null;
  /** Sets (or renews) the cookie for `maxAgeSeconds`. */
  write(token: string, maxAgeSeconds: number): void;
}

/** Limiter buckets (database bucket names; also the `limit` field of security events). */
export const LIMIT_BUCKETS = {
  signInAccountFailures: 'sign_in.account_failures',
  signInDeviceFailures: 'sign_in.device_failures',
  signInClientFailures: 'sign_in.client_failures',
  signInClientAttempts: 'sign_in.client_attempts',
  passwordCheckUser: 'password_check.user',
  resetRequestClient: 'password_reset.request_client',
  resetRequestAccount: 'password_reset.request_account',
  resetCompletionClient: 'password_reset.completion_client',
  invitationLookupClient: 'invitation.lookup_client',
  invitationSignUpClient: 'invitation.sign_up_client',
  mfaCodeAccount: 'mfa_code.account_failures',
  mfaCodeClient: 'mfa_code.client_failures',
} as const;

/**
 * Server setting for the self-hosted SMOKE TEST ONLY: every window, lock included, lasts this many seconds
 * (1–3600) instead of 15 minutes. Refused in production (NODE_ENV or VERCEL_ENV `production`) unless
 * AUTH_RATE_LIMIT_WINDOW_SMOKE_ONLY=1 is set as well (infra/docker/compose.smoke.yaml, used by smoke.sh
 * only); on a Vercel production deployment it is refused regardless (security review T-M2-11).
 */
export const AUTH_RATE_LIMIT_WINDOW_ENV = 'AUTH_RATE_LIMIT_WINDOW_SECONDS';
export const AUTH_RATE_LIMIT_WINDOW_SMOKE_ENV = 'AUTH_RATE_LIMIT_WINDOW_SMOKE_ONLY';

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
  if (env.VERCEL_ENV === 'production') {
    throw new Error(`${AUTH_RATE_LIMIT_WINDOW_ENV} is refused on a production deployment`);
  }
  if (env.NODE_ENV === 'production' && env[AUTH_RATE_LIMIT_WINDOW_SMOKE_ENV]?.trim() !== '1') {
    throw new Error(
      `${AUTH_RATE_LIMIT_WINDOW_ENV} is refused in production (smoke test only: ${AUTH_RATE_LIMIT_WINDOW_SMOKE_ENV}=1)`,
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
 * threshold and duration, trusted-browser days, FR-IAM-13, screen 6; TM-0003 D-IAM-04: platform default at
 * the shared sign-in host, the host organization's policy on its own host): read the organization's
 * settings here for a known `context.tenantId` and return them within the platform floors (TM-0003
 * T-IAM-24: lockout cannot be disabled). Keep the result's shape; callers do not change.
 */
export function limitsFor(
  _context: AuthLimitContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthLimits {
  const window = readAuthLimitWindowOverride(env);
  if (window === null) return PLATFORM_AUTH_LIMITS;
  return {
    signIn: withWindow(PLATFORM_AUTH_LIMITS.signIn, window),
    trustedDevice: PLATFORM_AUTH_LIMITS.trustedDevice,
    lockoutMail: PLATFORM_AUTH_LIMITS.lockoutMail,
    passwordCheck: withWindow(PLATFORM_AUTH_LIMITS.passwordCheck, window),
    passwordReset: withWindow(PLATFORM_AUTH_LIMITS.passwordReset, window),
    invitation: withWindow(PLATFORM_AUTH_LIMITS.invitation, window),
    mfaCode: withWindow(PLATFORM_AUTH_LIMITS.mfaCode, window),
  };
}

/** An organization's lockout settings (T-M2-10 platform-db `getLockoutPolicy`). */
export interface LockoutPolicy {
  /** Consecutive failures that lock the account. */
  readonly threshold: number;
  /** How long the lock lasts. */
  readonly minutes: number;
}

export interface OrganizationLockoutDeps {
  /** The organization of the host the visitor signs in on (a tenant host); null on the platform host. */
  readonly hostTenantId: string | null;
  /** The organization's lockout settings, or null for the platform default (T-M2-10 getLockoutPolicy). */
  readonly lockoutPolicyFor: (tenantId: string) => Promise<LockoutPolicy | null>;
  /** Whether the typed address is an active member there (platform-db signInAccountInTenant). */
  readonly accountInTenant: (email: string, tenantId: string) => Promise<boolean>;
}

/**
 * The account budget of a typed address (INTEGRATION POINT with T-M2-10; T-M2-10 security review): the
 * host organization's lockout policy when — and only when — the address belongs to an active member of
 * that organization; the platform default (`fallback`: 5 failures, 15 minutes) for everyone else, so an
 * attacker cannot pick the laxest organization's host to try more passwords on another organization's
 * accounts. The policy is CLAMPED to the default or stricter (security review T-M2-11 L5): never more
 * failures than `fallback.max`, never a shorter lock than `fallback.windowSeconds` (T-M2-10's settings
 * allow 3–5 failures and 15–60 minutes). A policy that is not whole numbers within 1–1,000 failures and
 * 1–1,440 minutes is ignored (the default applies). The smoke test's shortened window
 * (AUTH_RATE_LIMIT_WINDOW_SECONDS) still applies. Lookup failures throw (the caller fails closed).
 * Residual (TM-0003 T-IAM-27): a stricter policy makes the number of attempts before the lock depend on
 * membership of the host's organization — observable only by locking the account, which e-mails its
 * owner (docs/engineering/sign-in-protection.md §6).
 */
export function organizationAccountLockout(
  deps: OrganizationLockoutDeps,
  fallback: RateLimit,
  env: Readonly<Record<string, string | undefined>> = process.env,
): (email: string) => Promise<RateLimit> {
  const windowOverride = readAuthLimitWindowOverride(env);
  return async (email) => {
    const tenantId = deps.hostTenantId;
    if (tenantId === null || !(await deps.accountInTenant(email, tenantId))) return fallback;
    const policy = await deps.lockoutPolicyFor(tenantId);
    if (
      policy === null ||
      !Number.isInteger(policy.threshold) ||
      policy.threshold < 1 ||
      policy.threshold > 1_000 ||
      !Number.isInteger(policy.minutes) ||
      policy.minutes < 1 ||
      policy.minutes > 1_440
    ) {
      return fallback;
    }
    return {
      max: Math.min(policy.threshold, fallback.max),
      windowSeconds: windowOverride ?? Math.max(policy.minutes * 60, fallback.windowSeconds),
    };
  };
}

/**
 * The budgets one sign-in attempt is checked against. INTEGRATION POINT (later; PO decision 9 Oct 2026):
 * per-organization trusted office address ranges would give a client inside such a range wider client
 * budgets here (the account and browser budgets stay). Not built: every client gets the platform budgets
 * (the shared ones without a trusted address) — docs/engineering/sign-in-protection.md §7.
 */
export function signInBudgets(limits: SignInLimits, client: RequestClient): SignInBudgets {
  const shared = client.key === null;
  return {
    clientAttempts: shared ? limits.sharedClientAttempts : limits.clientAttempts,
    clientFailures: shared ? limits.sharedClientFailures : limits.clientFailures,
    accountFailures: limits.accountFailures,
    deviceFailures: limits.deviceFailures,
  };
}

// ----- The visitor's key for Auth's own limits (self-hosted only) -----

/**
 * Server setting, SELF-HOSTED ONLY (T-M2-11; docs/engineering/sign-in-protection.md §9): the name of the
 * header in which the app sends the visitor's rate-limit key with its Auth calls. The installation's
 * gateway trusts it from the app's network only and passes it to Auth as GOTRUE_RATE_LIMIT_HEADER, so
 * Auth's own per-IP limits count visitors instead of the app. Unset on hosted Supabase: there the trusted
 * forwarded-IP header (Sb-Forwarded-For) needs the Auth secret key, which the web app never holds (ADR 0002
 * §7) — and the visitor's address would reach a sub-processor for nothing. Refused on Vercel (VERCEL=1):
 * set there by mistake, it would send every visitor's address to hosted Auth (security review T-M2-11).
 */
export const AUTH_CLIENT_HEADER_ENV = 'JADARAT_AUTH_CLIENT_HEADER';

export function readAuthClientHeader(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const raw = env[AUTH_CLIENT_HEADER_ENV]?.trim() ?? '';
  if (raw === '') return null;
  if (env.VERCEL === '1') {
    throw new Error(
      `${AUTH_CLIENT_HEADER_ENV} is for self-hosted installations only (refused on Vercel)`,
    );
  }
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(raw)) {
    throw new Error(`${AUTH_CLIENT_HEADER_ENV} must be an HTTP header name`);
  }
  return raw;
}

/** The header carrying the visitor's key to Auth, when configured and the visitor has a trusted address. */
export function authClientHeaders(
  client: RequestClient,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, string>> | null {
  const name = readAuthClientHeader(env);
  return name === null || client.key === null ? null : { [name]: client.key };
}

// ----- Security events (TM-0003 T-IAM-25; ADR 0009 §2: codes and keyed references only) -----

export type SecurityEventName =
  | 'auth.sign_in.failed'
  | 'auth.lockout'
  | 'auth.rate_limited'
  | 'auth.limiter.unavailable'
  | 'auth.password_change.failed'
  | 'auth.mfa_code.failed';

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
  'auth.mfa_code.failed': 'authenticator code refused',
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

/** A limited attempt that reached Auth: report Auth's verdict. No method throws. */
export interface LimitedAttempt {
  /** Auth refused (the failure was counted already): security events. */
  failed(): Promise<void>;
  /** Auth accepted: the provisional failure is given back and the run ends. */
  succeeded(): Promise<void>;
}

/** What a sign-in that Auth accepted asks of its browser (PO decision 9 Oct 2026: trust is opt-in). */
export interface SignInSuccessOptions {
  /** «تذكّر هذا المتصفح» / "Remember this browser" was ticked: trust (or renew) this browser for 30 days. */
  readonly remember: boolean;
}

/** One sign-in attempt that reached Auth. No method throws. */
export interface SignInAttempt extends LimitedAttempt {
  /** Auth refused the credentials: events, and — when this failure used a budget up — the lockout e-mail. */
  failed(): Promise<void>;
  /**
   * Auth accepted them: the client's provisional failure is given back and the run ends; only with
   * `remember` is the browser trusted (or its trust renewed). Without options: not remembered.
   */
  succeeded(options?: SignInSuccessOptions): Promise<void>;
  /**
   * Auth answered before comparing the password (its own rate limit, HTTP 429 — security review T-M2-11
   * L6): the account's (or the trusted browser's) provisional failure is given back; the client's stays.
   */
  notChecked(): Promise<void>;
}

/** A limiter's answer before Auth is asked. */
export type LimitGate<A> =
  | { readonly allowed: true; readonly attempt: A }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export type SignInGate = LimitGate<SignInAttempt>;

export interface SignInGuard {
  /**
   * Before Auth is asked: counts the attempt and its provisional failures (one database call) and says
   * whether it may proceed. Throws RateLimiterUnavailableError when the limiter cannot answer.
   */
  check(email: string): Promise<SignInGate>;
}

export interface SignInGuardDeps extends LimiterDeps {
  readonly client: RequestClient;
  readonly action: string;
  /** The browser's trusted-device cookie of this request. */
  readonly device: TrustedDeviceCookie;
  /**
   * Requests the "account locked" e-mail for the typed address (platform-db requestAccountLockedMail):
   * the worker decides whether an account exists, and sends at most one a day. Called when this attempt's
   * failure used the account's — or a trusted browser's — budget up.
   */
  readonly requestLockedMail: (email: string, lockMinutes: number) => Promise<void>;
  /**
   * The account budget of the typed address (organizationAccountLockout: the host organization's policy
   * for its own members — T-M2-10); the platform's `limits.signIn.accountFailures` when absent.
   */
  readonly accountLockout?: ((email: string) => Promise<RateLimit>) | undefined;
}

export function createSignInGuard(deps: SignInGuardDeps): SignInGuard {
  const { store, client, action, device, log, accountLockout } = deps;
  const platformBudgets = signInBudgets(deps.limits.signIn, client);
  const trustDays = deps.limits.trustedDevice.days;
  const B = LIMIT_BUCKETS;
  return {
    async check(email) {
      const token = device.read();
      const subjects = {
        client: clientSubject(client),
        account: accountSubject(email),
        device: token === null ? null : deviceSubject(token),
      };
      const budgets: SignInBudgets = accountLockout
        ? {
            ...platformBudgets,
            accountFailures: await failClosed(deps, action, () => accountLockout(email)),
          }
        : platformBudgets;
      const result: SignInCheck = await failClosed(deps, action, () =>
        store.signInCheck(subjects, budgets),
      );
      const refs = { subjectRef: result.subjectRef, clientRef: result.clientRef };
      if (!result.allowed) {
        const limit = result.refusedBy ?? 'unknown';
        log({
          event: 'auth.rate_limited',
          action,
          reason: limit,
          limit,
          retryAfterS: result.retryAfterSeconds,
          ...refs,
        });
        return { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
      }
      const unavailable = (reason: string, error: unknown) => {
        log({ event: 'auth.limiter.unavailable', action, reason, errorName: errorNameOf(error) });
      };
      const attempt: SignInAttempt = {
        async failed() {
          log({ event: 'auth.sign_in.failed', action, reason: 'invalid_credentials', ...refs });
          if (result.clientRemaining === 0) {
            log({
              event: 'auth.lockout',
              action,
              reason: B.signInClientFailures,
              limit: B.signInClientFailures,
              ...refs,
            });
          }
          if (result.remaining !== 0) return;
          // This failure used the account's (or the trusted browser's) budget up: the lock starts now.
          const limit = result.trusted ? budgets.deviceFailures : budgets.accountFailures;
          const bucket = result.trusted ? B.signInDeviceFailures : B.signInAccountFailures;
          log({
            event: 'auth.lockout',
            action,
            reason: bucket,
            limit: bucket,
            retryAfterS: limit.windowSeconds,
            ...refs,
          });
          // The owner hears of it in both cases — a trusted browser's budget too (security review T-M2-11,
          // from L1: a stolen trusted-device cookie must not guess unnoticed). The worker's quiet window and
          // caps apply to both alike.
          try {
            await deps.requestLockedMail(email, Math.max(1, Math.ceil(limit.windowSeconds / 60)));
          } catch (error) {
            unavailable('lock_mail_not_requested', error);
          }
        },
        async succeeded(options) {
          // Opt-in (PO decision 9 Oct 2026): a fresh token is minted only to be offered for trust; the
          // database keeps the browser's own token when it already knows it.
          const fresh = options?.remember === true ? newDeviceToken() : null;
          try {
            const trust = await store.signInSucceeded(
              subjects,
              result.trusted,
              fresh === null ? null : { freshDevice: deviceSubject(fresh), trustDays },
            );
            const value = trust === null ? null : trust.device === 'presented' ? token : fresh;
            if (value !== null) device.write(value, trustDays * 86_400);
          } catch (error) {
            // Auth said yes: the sign-in continues. The provisional failure stays counted and the
            // browser is not (newly) trusted — both only tighten the limits.
            unavailable('success_not_recorded', error);
          }
        },
        async notChecked() {
          try {
            await store.signInNotChecked(subjects, result.trusted);
          } catch (error) {
            // The provisional failure stays counted: it only tightens the limit.
            unavailable('failure_not_given_back', error);
          }
        },
      };
      return { allowed: true, attempt };
    },
  };
}

/**
 * A guard for flows that never check a password: any use is a programming error and fails closed (a new
 * sign-in path must bind the request's client).
 */
export const NO_SIGN_IN_GUARD: SignInGuard = {
  check: () => Promise.reject(new RateLimiterUnavailableError()),
};

/**
 * After a completed password reset (the owner proved control of the mailbox — TM-0003 T-IAM-32
 * self-unlock; PO decision 9 Oct 2026; security review T-M2-11 M2): the account's sign-in lock ends, the
 * browser that completed the reset is TRUSTED for the account — its own token when the server knows it,
 * else a fresh one — and its cookie is set, so an attacker who keeps the account locked cannot keep its
 * owner out; every OTHER browser the account trusted is forgotten. Never throws (logged).
 */
export async function resetAccountSignIn(
  deps: LimiterDeps,
  action: string,
  email: string,
  device: TrustedDeviceCookie,
): Promise<void> {
  const token = device.read();
  const fresh = newDeviceToken();
  const trustDays = deps.limits.trustedDevice.days;
  try {
    const trust = await deps.store.signInReset(
      accountSubject(email),
      token === null ? null : deviceSubject(token),
      { freshDevice: deviceSubject(fresh), trustDays },
    );
    device.write(
      trust.device === 'presented' && token !== null ? token : fresh,
      trustDays * 86_400,
    );
  } catch (error) {
    deps.log({
      event: 'auth.limiter.unavailable',
      action,
      reason: 'lock_not_cleared',
      errorName: errorNameOf(error),
    });
  }
}

/**
 * After a password change on My profile (security review T-M2-11 L2): every browser the account trusted
 * is forgotten except this one (`deviceToken`: its cookie's token, null when it has none). Runs AFTER the
 * action's transaction (the limiter's own transaction must never wait for a pooled connection while the
 * action holds one). Never throws (logged).
 */
export async function forgetOtherTrustedBrowsers(
  deps: LimiterDeps,
  action: string,
  email: string,
  deviceToken: string | null,
): Promise<void> {
  try {
    await deps.store.forgetOtherDevices(
      accountSubject(email),
      deviceToken === null ? null : deviceSubject(deviceToken),
    );
  } catch (error) {
    deps.log({
      event: 'auth.limiter.unavailable',
      action,
      reason: 'devices_not_forgotten',
      errorName: errorNameOf(error),
    });
  }
}

// ----- Authenticator-app codes (T-M2-10 security review; TM-0003 T-IAM-12) -----

/** Auth's per-IP limit sees only the app server: codes are limited here, per account and per client. */
export interface CodeAttemptLimiter {
  /**
   * Before Auth is asked: counts a provisional wrong code for the account (the signed-in user) and the
   * client; refused when either budget is used up. Throws RateLimiterUnavailableError when the limiter
   * cannot answer (fail closed). Report Auth's verdict to the returned attempt.
   */
  check(userId: string): Promise<LimitGate<LimitedAttempt>>;
}

export function createCodeAttemptLimiter(
  deps: LimiterDeps & { readonly client: RequestClient; readonly action: string },
): CodeAttemptLimiter {
  const { store, client, action, log } = deps;
  const limits = deps.limits.mfaCode;
  const clientFailures = client.key === null ? limits.sharedClientFailures : limits.clientFailures;
  const B = LIMIT_BUCKETS;
  const giveBack = async (bucket: string, subject: Uint8Array) => {
    try {
      await store.giveBack(bucket, subject);
    } catch (error) {
      log({
        event: 'auth.limiter.unavailable',
        action,
        reason: 'failure_not_given_back',
        errorName: errorNameOf(error),
      });
    }
  };
  return {
    async check(userId) {
      const account = userSubject(userId);
      const clientKey = clientSubject(client);
      const [byAccount, byClient] = await failClosed(deps, action, () =>
        Promise.all([
          store.hit(B.mfaCodeAccount, account, limits.accountFailures),
          store.hit(B.mfaCodeClient, clientKey, clientFailures),
        ]),
      );
      const refs = {
        subjectRef: byAccount.ref,
        clientRef: byClient.ref,
        entityType: 'auth_user',
        entityId: userId,
      };
      if (!byAccount.allowed || !byClient.allowed) {
        // Refused before Auth: no wrong code — the other budget gets its provisional failure back.
        if (byAccount.allowed) await giveBack(B.mfaCodeAccount, account);
        if (byClient.allowed) await giveBack(B.mfaCodeClient, clientKey);
        const limit = byAccount.allowed ? B.mfaCodeClient : B.mfaCodeAccount;
        const retryAfterSeconds = Math.max(
          byAccount.allowed ? 0 : byAccount.retryAfterSeconds,
          byClient.allowed ? 0 : byClient.retryAfterSeconds,
        );
        log({
          event: 'auth.rate_limited',
          action,
          reason: limit,
          limit,
          retryAfterS: retryAfterSeconds,
          ...refs,
        });
        return { allowed: false, retryAfterSeconds };
      }
      const attempt: LimitedAttempt = {
        failed() {
          log({ event: 'auth.mfa_code.failed', action, reason: 'invalid_code', ...refs });
          for (const [bucket, counter] of [
            [B.mfaCodeAccount, byAccount],
            [B.mfaCodeClient, byClient],
          ] as const) {
            if (counter.remaining === 0) {
              log({
                event: 'auth.lockout',
                action,
                reason: bucket,
                limit: bucket,
                retryAfterS: counter.retryAfterSeconds,
                ...refs,
              });
            }
          }
          return Promise.resolve();
        },
        async succeeded() {
          // The run of wrong codes ends for the account; the client's provisional failure is given back.
          try {
            await store.clear(B.mfaCodeAccount, account);
          } catch (error) {
            log({
              event: 'auth.limiter.unavailable',
              action,
              reason: 'success_not_recorded',
              errorName: errorNameOf(error),
            });
          }
          await giveBack(B.mfaCodeClient, clientKey);
        },
      };
      return { allowed: true, attempt };
    },
  };
}

/**
 * The hook for the code check (T-M2-10 `verifyTotpCode`): limits it per account and per client, counting
 * wrong codes only. `verify` asks Auth; `isWrongCode` tells a wrong or expired code from other refusals.
 * A limited check answers RATE_LIMITED without asking Auth; a wrong code stays counted; a right one gives
 * its provisional failure back; any other refusal, or an Auth outage (thrown), keeps it counted.
 */
export async function withCodeAttemptLimit<T>(
  limiter: CodeAttemptLimiter,
  userId: string,
  verify: () => Promise<Result<T, AppError>>,
  isWrongCode: (error: AppError) => boolean,
): Promise<Result<T, AppError>> {
  const gate = await limiter.check(userId);
  if (!gate.allowed) return err(appError('RATE_LIMITED'));
  const result = await verify();
  if (result.ok) await gate.attempt.succeeded();
  else if (isWrongCode(result.error)) await gate.attempt.failed();
  return result;
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
