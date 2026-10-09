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

/** A counter's state after a hit or a peek. */
export interface RateLimitCounter {
  /** This hit is within the limit (hit), or the key is not used up (peek). */
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

export interface RateLimitStore {
  /** Counts one hit of the key in `bucket`. */
  hit(bucket: string, subject: Uint8Array, limit: RateLimit): Promise<RateLimitCounter>;
  /** The key's state against `max`, without counting. */
  peek(bucket: string, subject: Uint8Array, max: number): Promise<RateLimitCounter>;
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
   * Auth accepted the password: the client's provisional failure is given back, the account's (or the
   * trusted browser's) run ends, and the browser is trusted for the account for `trustDays`. Returns the
   * end of the trust.
   */
  signInSucceeded(
    subjects: SignInSubjects & { readonly device: Uint8Array },
    trusted: boolean,
    trustDays: number,
  ): Promise<Date>;
  /** A completed password reset: the account's lock ends, its trusted browsers are forgotten. */
  signInReset(account: Uint8Array): Promise<number>;
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
    peek(bucket, subject, max) {
      const key = checkArguments(bucket, subject);
      checkLimit({ max, windowSeconds: 1 });
      return run(
        sql`select allowed, remaining, retry_after_seconds, key_ref
            from private.rate_limit_peek(${bucket}, ${key}::bytea, ${max}::integer)`,
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
    signInSucceeded(subjects, trusted, trustDays) {
      const client = checkSubject(subjects.client);
      const account = checkSubject(subjects.account);
      const device = checkSubject(subjects.device);
      if (!Number.isInteger(trustDays) || trustDays < 1 || trustDays > 400) {
        throw new Error('rate limit: a browser is trusted for 1–400 days');
      }
      return run(
        sql`select private.rate_limit_sign_in_succeeded(${client}::bytea, ${account}::bytea,
                                                        ${device}::bytea, ${trusted}::boolean,
                                                        ${trustDays}::integer) as until`,
        (rows) => {
          const until = rows[0]?.until as Date | string | undefined;
          if (until === undefined) throw new Error('rate limit: no answer from the database');
          return until instanceof Date ? until : new Date(until);
        },
      );
    },
    signInReset(account) {
      const key = checkSubject(account);
      return run(sql`select private.rate_limit_sign_in_reset(${key}::bytea) as revoked`, (rows) =>
        Number(rows[0]?.revoked ?? 0),
      );
    },
  };
}

/** The limiter of this app instance (app_server pool). */
export const rateLimitStore: RateLimitStore = createRateLimitStore(() => getDatabase('app_server'));
