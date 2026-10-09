import { sql } from 'drizzle-orm';
import { runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';

/**
 * The shared rate limiter (ADR 0011 §4, T-M2-11; migration 20261013090000): counters in PostgreSQL, the
 * same for every app instance and Vercel function. Keys are `subjects` — the caller's SHA-256 of the
 * normalised key (platform-identity auth-limits.ts) — which the database hashes again with its own HMAC
 * key; nothing readable is sent or stored. Each call is one short transaction as app_server without claims
 * (the definer functions check the login role), with one counting operation at most: the database's purge
 * of expired counters then never waits, and no two calls can deadlock.
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
  /** `rk_` + the first 12 bytes of the keyed hash, hex: correlates log lines, reveals nothing. */
  readonly ref: string;
}

export interface RateLimitStore {
  /** Counts one hit of the key in `bucket`. */
  hit(bucket: string, subject: Uint8Array, limit: RateLimit): Promise<RateLimitCounter>;
  /** The key's state against `max`, without counting. */
  peek(bucket: string, subject: Uint8Array, max: number): Promise<RateLimitCounter>;
  /** Forgets the key's counter in `bucket`. */
  clear(bucket: string, subject: Uint8Array): Promise<void>;
}

/** Same rules as the database (private.rate_limit_check_call): checked before any round trip. */
export const RATE_LIMIT_BUCKET_PATTERN = /^[a-z][a-z0-9_.]{2,62}$/;
const SUBJECT_BYTES = 32;
/** A limiter call that takes longer is cancelled (and fails: the caller's policy applies). */
export const RATE_LIMIT_STATEMENT_TIMEOUT_MS = 3_000;

function checkArguments(bucket: string, subject: Uint8Array): Buffer {
  if (!RATE_LIMIT_BUCKET_PATTERN.test(bucket)) throw new Error('rate limit: invalid bucket name');
  if (subject.byteLength !== SUBJECT_BYTES) {
    throw new Error('rate limit: a subject is a 32-byte hash');
  }
  return Buffer.from(subject);
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

function counterOf(rows: readonly CounterRow[]): RateLimitCounter {
  const row = rows[0];
  if (!row) throw new Error('rate limit: no answer from the database');
  return {
    allowed: row.allowed,
    remaining: Number(row.remaining),
    retryAfterSeconds: Number(row.retry_after_seconds),
    ref: row.key_ref,
  };
}

/** Over a database connected as `app_server` (a pool shared with the request path). */
export function createRateLimitStore(getDb: () => AppDatabase): RateLimitStore {
  // One short transaction per call, as app_server without claims (`set local role authenticated`, empty
  // request.jwt.claims — the pattern of the account e-mail requests), with a statement timeout.
  const run = <T>(statement: ReturnType<typeof sql>, read: (rows: readonly CounterRow[]) => T) =>
    runWithClaims(getDb(), '', async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout', ${String(RATE_LIMIT_STATEMENT_TIMEOUT_MS)}, true)`,
      );
      return read(await tx.execute<CounterRow>(statement));
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
  };
}

/** The limiter of this app instance (app_server pool). */
export const rateLimitStore: RateLimitStore = createRateLimitStore(() => getDatabase('app_server'));
