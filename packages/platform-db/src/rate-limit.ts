import { sql } from 'drizzle-orm';
import { runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';

/**
 * The shared rate limiter (ADR 0011 §4, T-M2-11; migration 20261013090000): counters in PostgreSQL, the
 * same for every app instance and Vercel function. Keys are `subjects` — the caller's SHA-256 of the
 * normalised key (platform-identity auth-limits.ts) — which the database hashes again with its own HMAC
 * key; nothing readable is sent or stored. Each call is one short transaction as app_server without claims
 * (the definer functions check the login role), never nested in another transaction of the same pool (a
 * caller holding a pooled connection while waiting for a second one can starve the pool — security review
 * T-M2-11): run it before or after the request's own transaction, never inside it.
 *
 * Errors (database unreachable, migration missing, timeout) are thrown: each caller decides its failure
 * policy (sign-in fails closed — docs/engineering/sign-in-protection.md).
 */

/** At most this many hits per window. */
export interface RateLimit {
  readonly max: number;
  readonly windowSeconds: number;
}

/** A counter's state after a hit. */
export interface RateLimitCounter {
  /** This hit is within the limit. */
  readonly allowed: boolean;
  /** Hits left in the current window. */
  readonly remaining: number;
  /** Seconds until the window ends, when nothing is left (0 otherwise). */
  readonly retryAfterSeconds: number;
  /** `rk_` + 12 bytes of the subject's HMAC under the LOG key, hex: correlates log lines, reveals nothing. */
  readonly ref: string;
}

/** The sign-in budgets the database applies in one check (platform-identity auth-limits.ts). */
export interface SignInBudgets {
  /** Every attempt of the client (protects Auth's shared budget). */
  readonly clientAttempts: RateLimit;
  /** Wrong passwords of the client, any account (successes are given back). */
  readonly clientFailures: RateLimit;
  /** Consecutive wrong passwords of the typed account, from browsers it does not trust. */
  readonly accountFailures: RateLimit;
  /** Wrong passwords of one browser the account trusts (the account's lock does not apply to it). */
  readonly deviceFailures: RateLimit;
}

/** Who signs in: SHA-256 subjects of the client, the typed account and — when it has one — the browser. */
export interface SignInSubjects {
  readonly client: Uint8Array;
  readonly account: Uint8Array;
  readonly device: Uint8Array | null;
}

/** The budget that refused a sign-in attempt (database bucket names). */
export type SignInRefusal =
  | 'sign_in.client_attempts'
  | 'sign_in.client_failures'
  | 'sign_in.account_failures'
  | 'sign_in.device_failures';

const SIGN_IN_REFUSALS: ReadonlySet<string> = new Set<SignInRefusal>([
  'sign_in.client_attempts',
  'sign_in.client_failures',
  'sign_in.account_failures',
  'sign_in.device_failures',
]);

/** The answer of a sign-in check (counted before Auth is asked). */
export interface SignInCheck {
  readonly allowed: boolean;
  readonly refusedBy: SignInRefusal | null;
  /** Seconds until the refusing budget's window ends (0 when allowed). */
  readonly retryAfterSeconds: number;
  /** The account's — or the trusted browser's — failures left after this attempt (0: this one used it up). */
  readonly remaining: number;
  /** The client's failures left after this attempt. */
  readonly clientRemaining: number;
  /** The browser is trusted by the account (its own budget applied, not the account's). */
  readonly trusted: boolean;
  readonly subjectRef: string;
  readonly clientRef: string;
}

/**
 * Which browser token the database made trusted: the one the browser presented (the server knows it —
 * one cookie per browser, for every account that trusts it) or the fresh one the app minted for the
 * request (the server never starts trusting a token it did not issue). The app writes that token's cookie.
 */
export type TrustedDeviceChoice = 'presented' | 'fresh';

/** A browser trusted (again) for an account. */
export interface DeviceTrust {
  readonly device: TrustedDeviceChoice;
  readonly until: Date;
}

/** «تذكّر هذا المتصفح» ticked: trust the browser for `trustDays`, under `freshDevice` unless it presented a known token. */
export interface RememberDevice {
  /** SHA-256 subject of the fresh random token minted for this request. */
  readonly freshDevice: Uint8Array;
  readonly trustDays: number;
}

export interface RateLimitStore {
  /** Counts one hit of the key in `bucket`. */
  hit(bucket: string, subject: Uint8Array, limit: RateLimit): Promise<RateLimitCounter>;
  /** Forgets the key's counter in `bucket`. */
  clear(bucket: string, subject: Uint8Array): Promise<void>;
  /** Gives one hit of the key back (failures-only counting: the attempt turned out right). */
  giveBack(bucket: string, subject: Uint8Array): Promise<void>;
  /**
   * Before Auth is asked: counts the attempt for the client, then a provisional failure for the client
   * and for the account (or the trusted browser) — one round trip; refused when a budget is used up.
   */
  signInCheck(subjects: SignInSubjects, budgets: SignInBudgets): Promise<SignInCheck>;
  /**
   * Auth accepted the password (`trusted`: what the check answered for `subjects.device`, the presented
   * token): the client's provisional failure is given back, the account's (or the trusted browser's) run
   * ends; with `remember` (opt-in), the browser is trusted for the account. Null without `remember`:
   * nothing about trust changed (a trusted browser's trust is not renewed).
   */
  signInSucceeded(
    subjects: SignInSubjects,
    trusted: boolean,
    remember: RememberDevice | null,
  ): Promise<DeviceTrust | null>;
  /**
   * Auth answered before comparing the password (its own rate limit): the account's (or the trusted
   * browser's) provisional failure is given back; the client's stays.
   */
  signInNotChecked(subjects: SignInSubjects, trusted: boolean): Promise<void>;
  /**
   * A completed password reset: the account's lock ends, the browser that completed it (`device`: its
   * presented token, if any) is trusted, every other browser the account trusted is forgotten.
   */
  signInReset(
    account: Uint8Array,
    device: Uint8Array | null,
    remember: RememberDevice,
  ): Promise<DeviceTrust & { readonly revoked: number }>;
  /** After a password change on My profile: forgets every trusted browser of the account but `device`. */
  forgetOtherDevices(account: Uint8Array, device: Uint8Array | null): Promise<number>;
}

/** Same rules as the database (private.rate_limit_check_call): checked before any round trip. */
export const RATE_LIMIT_BUCKET_PATTERN = /^[a-z][a-z0-9_.]{2,62}$/;
const SUBJECT_BYTES = 32;
/** A limiter call that takes longer is cancelled (and fails: the caller's policy applies). */
export const RATE_LIMIT_STATEMENT_TIMEOUT_MS = 3_000;

function checkSubject(subject: Uint8Array): Buffer {
  if (subject.byteLength !== SUBJECT_BYTES) {
    throw new Error('rate limit: a subject is a 32-byte hash');
  }
  return Buffer.from(subject);
}

function checkArguments(bucket: string, subject: Uint8Array): Buffer {
  if (!RATE_LIMIT_BUCKET_PATTERN.test(bucket)) throw new Error('rate limit: invalid bucket name');
  return checkSubject(subject);
}

function checkTrustDays(trustDays: number): void {
  if (!Number.isInteger(trustDays) || trustDays < 1 || trustDays > 400) {
    throw new Error('rate limit: a browser is trusted for 1–400 days');
  }
}

interface DeviceTrustRow extends Record<string, unknown> {
  readonly device: string | null;
  readonly trusted_until: Date | string | null;
}

function deviceTrustOf(row: DeviceTrustRow): DeviceTrust | null {
  if (row.device === null && row.trusted_until === null) return null;
  if ((row.device !== 'presented' && row.device !== 'fresh') || row.trusted_until === null) {
    throw new Error('rate limit: unknown trusted-browser answer');
  }
  const until = row.trusted_until instanceof Date ? row.trusted_until : new Date(row.trusted_until);
  return { device: row.device, until };
}

function checkLimit(limit: RateLimit): void {
  if (!Number.isInteger(limit.max) || limit.max < 1 || limit.max > 1_000_000) {
    throw new Error('rate limit: max must be 1–1,000,000');
  }
  if (
    !Number.isInteger(limit.windowSeconds) ||
    limit.windowSeconds < 1 ||
    limit.windowSeconds > 86_400
  ) {
    throw new Error('rate limit: window must be 1–86,400 seconds');
  }
}

interface CounterRow extends Record<string, unknown> {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retry_after_seconds: number;
  readonly key_ref: string;
}

function counterOf(rows: readonly Record<string, unknown>[]): RateLimitCounter {
  const row = rows[0] as CounterRow | undefined;
  if (!row) throw new Error('rate limit: no answer from the database');
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    retryAfterSeconds: row.retry_after_seconds,
    ref: row.key_ref,
  };
}

interface SignInCheckRow extends Record<string, unknown> {
  readonly allowed: boolean;
  readonly refused_by: string | null;
  readonly retry_after_seconds: number;
  readonly remaining: number;
  readonly client_remaining: number;
  readonly trusted: boolean;
  readonly subject_ref: string;
  readonly client_ref: string;
}

function signInCheckOf(rows: readonly Record<string, unknown>[]): SignInCheck {
  const row = rows[0] as SignInCheckRow | undefined;
  if (!row) throw new Error('rate limit: no answer from the database');
  if (row.refused_by !== null && !SIGN_IN_REFUSALS.has(row.refused_by)) {
    throw new Error('rate limit: unknown sign-in refusal');
  }
  return {
    allowed: row.allowed,
    refusedBy: row.refused_by as SignInRefusal | null,
    retryAfterSeconds: row.retry_after_seconds,
    remaining: row.remaining,
    clientRemaining: row.client_remaining,
    trusted: row.trusted,
    subjectRef: row.subject_ref,
    clientRef: row.client_ref,
  };
}

/** Over a database connected as `app_server` (a pool shared with the request path). */
export function createRateLimitStore(getDb: () => AppDatabase): RateLimitStore {
  // One short transaction per call, as app_server without claims (`set local role authenticated`, empty
  // request.jwt.claims — the pattern of the account e-mail requests), with a statement timeout.
  const run = <T>(
    statement: ReturnType<typeof sql>,
    read: (rows: readonly Record<string, unknown>[]) => T,
  ) =>
    runWithClaims(getDb(), '', async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout', ${String(RATE_LIMIT_STATEMENT_TIMEOUT_MS)}, true)`,
      );
      return read(await tx.execute(statement));
    });
  return {
    hit(bucket, subject, limit) {
      const key = checkArguments(bucket, subject);
      checkLimit(limit);
      return run(
        sql`select allowed, remaining, retry_after_seconds, key_ref
            from private.rate_limit_hit(${bucket}, ${key}::bytea, ${limit.max}::integer,
                                        ${limit.windowSeconds}::integer)`,
        counterOf,
      );
    },
    async clear(bucket, subject) {
      const key = checkArguments(bucket, subject);
      await run(sql`select private.rate_limit_clear(${bucket}, ${key}::bytea)`, () => undefined);
    },
    async giveBack(bucket, subject) {
      const key = checkArguments(bucket, subject);
      await run(
        sql`select private.rate_limit_give_back(${bucket}, ${key}::bytea)`,
        () => undefined,
      );
    },
    signInCheck(subjects, budgets) {
      const client = checkSubject(subjects.client);
      const account = checkSubject(subjects.account);
      const device = subjects.device === null ? null : checkSubject(subjects.device);
      const { clientAttempts, clientFailures, accountFailures, deviceFailures } = budgets;
      for (const limit of [clientAttempts, clientFailures, accountFailures, deviceFailures]) {
        checkLimit(limit);
      }
      return run(
        sql`select allowed, refused_by, retry_after_seconds, remaining, client_remaining, trusted,
                   subject_ref, client_ref
            from private.rate_limit_sign_in_check(
              ${client}::bytea, ${account}::bytea, ${device}::bytea,
              ${clientAttempts.max}::integer, ${clientAttempts.windowSeconds}::integer,
              ${clientFailures.max}::integer, ${clientFailures.windowSeconds}::integer,
              ${accountFailures.max}::integer, ${accountFailures.windowSeconds}::integer,
              ${deviceFailures.max}::integer, ${deviceFailures.windowSeconds}::integer)`,
        signInCheckOf,
      );
    },
    signInSucceeded(subjects, trusted, remember) {
      const client = checkSubject(subjects.client);
      const account = checkSubject(subjects.account);
      const device = subjects.device === null ? null : checkSubject(subjects.device);
      if (trusted && device === null) throw new Error('rate limit: a trusted browser has a token');
      const fresh = remember === null ? null : checkSubject(remember.freshDevice);
      if (remember !== null) checkTrustDays(remember.trustDays);
      return run(
        sql`select device, trusted_until
            from private.rate_limit_sign_in_succeeded(
              ${client}::bytea, ${account}::bytea, ${device}::bytea, ${fresh}::bytea,
              ${trusted}::boolean, ${remember !== null}::boolean,
              ${remember?.trustDays ?? null}::integer)`,
        (rows) => {
          const row = rows[0] as DeviceTrustRow | undefined;
          if (!row) throw new Error('rate limit: no answer from the database');
          return deviceTrustOf(row);
        },
      );
    },
    async signInNotChecked(subjects, trusted) {
      const account = checkSubject(subjects.account);
      const device = subjects.device === null ? null : checkSubject(subjects.device);
      if (trusted && device === null) throw new Error('rate limit: a trusted browser has a token');
      await run(
        sql`select private.rate_limit_sign_in_not_checked(${account}::bytea, ${device}::bytea,
                                                          ${trusted}::boolean)`,
        () => undefined,
      );
    },
    signInReset(account, device, remember) {
      const accountKey = checkSubject(account);
      const deviceKey = device === null ? null : checkSubject(device);
      const fresh = checkSubject(remember.freshDevice);
      checkTrustDays(remember.trustDays);
      return run(
        sql`select revoked, device, trusted_until
            from private.rate_limit_sign_in_reset(${accountKey}::bytea, ${deviceKey}::bytea,
                                                  ${fresh}::bytea, ${remember.trustDays}::integer)`,
        (rows) => {
          const row = rows[0] as (DeviceTrustRow & { readonly revoked: number }) | undefined;
          const trust = row ? deviceTrustOf(row) : null;
          if (!row || !trust) throw new Error('rate limit: no answer from the database');
          return { ...trust, revoked: row.revoked };
        },
      );
    },
    forgetOtherDevices(account, device) {
      const accountKey = checkSubject(account);
      const deviceKey = device === null ? null : checkSubject(device);
      return run(
        sql`select private.rate_limit_forget_other_devices(${accountKey}::bytea, ${deviceKey}::bytea)
                   as revoked`,
        (rows) => {
          const revoked = rows[0]?.revoked;
          if (typeof revoked !== 'number')
            throw new Error('rate limit: no answer from the database');
          return revoked;
        },
      );
    },
  };
}

/** The limiter of this app instance (app_server pool). */
export const rateLimitStore: RateLimitStore = createRateLimitStore(() => getDatabase('app_server'));
