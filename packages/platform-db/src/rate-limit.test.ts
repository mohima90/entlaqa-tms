import { createHash } from 'node:crypto';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import { RATE_LIMIT_STATEMENT_TIMEOUT_MS, createRateLimitStore } from './rate-limit';

const dialect = new PgDialect();
const SUBJECT = createHash('sha256').update('subject').digest();

/** A database whose transactions record the statements and answer the limiter call with `row`. */
function fakeDb(row: Record<string, unknown> | null, fail?: Error) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      const q = dialect.sqlToQuery(query);
      executed.push(q);
      if (!q.sql.includes('private.rate_limit')) return Promise.resolve([]);
      if (fail) return Promise.reject(fail);
      return Promise.resolve(row ? [row] : []);
    },
  };
  const db = {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as AppDatabase;
  return { db, executed };
}

const answer = { allowed: false, remaining: 0, retry_after_seconds: 42, key_ref: 'rk_00' };

describe('createRateLimitStore (ADR 0011 §4, T-M2-11)', () => {
  it('counts a hit in one transaction as app_server without claims, with a statement timeout', async () => {
    const { db, executed } = fakeDb(answer);
    const counter = await createRateLimitStore(() => db).hit('sign_in.account_failures', SUBJECT, {
      max: 5,
      windowSeconds: 900,
    });
    expect(counter).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 42, ref: 'rk_00' });
    expect(executed[0]?.sql).toBe('set local role authenticated');
    expect(executed[1]?.params).toEqual(['']);
    expect(executed.some((q) => q.params.includes(String(RATE_LIMIT_STATEMENT_TIMEOUT_MS)))).toBe(
      true,
    );
    const call = executed.at(-1);
    expect(call?.sql).toContain('from private.rate_limit_hit($1, $2::bytea, $3::integer');
    expect(call?.params).toEqual(['sign_in.account_failures', SUBJECT, 5, 900]);
  });

  it('peeks and clears with the same checks', async () => {
    const { db, executed } = fakeDb({
      ...answer,
      allowed: true,
      remaining: 3,
      retry_after_seconds: 0,
    });
    const store = createRateLimitStore(() => db);
    expect(await store.peek('sign_in.client_failures', SUBJECT, 3)).toEqual({
      allowed: true,
      remaining: 3,
      retryAfterSeconds: 0,
      ref: 'rk_00',
    });
    expect(executed.at(-1)?.sql).toContain(
      'from private.rate_limit_peek($1, $2::bytea, $3::integer)',
    );
    await store.clear('sign_in.account_failures', SUBJECT);
    expect(executed.at(-1)?.sql).toBe('select private.rate_limit_clear($1, $2::bytea)');
  });

  it('refuses readable keys, bad buckets and bad limits before any round trip', async () => {
    const { db, executed } = fakeDb(answer);
    const store = createRateLimitStore(() => db);
    expect(() =>
      store.hit('x.y', Buffer.from('user@example.test'), { max: 1, windowSeconds: 1 }),
    ).toThrow('32-byte');
    expect(() => store.peek('Sign In', SUBJECT, 1)).toThrow('bucket');
    expect(() => store.hit('x.y', SUBJECT, { max: 1.5, windowSeconds: 1 })).toThrow('max');
    expect(() => store.hit('x.y', SUBJECT, { max: 1, windowSeconds: 0 })).toThrow('window');
    expect(() => store.peek('x.y', SUBJECT, 2_000_000)).toThrow('max');
    await expect(store.clear('x.y', new Uint8Array(31))).rejects.toThrow('32-byte');
    expect(executed).toHaveLength(0);
  });

  it('passes database failures and empty answers to the caller (its failure policy applies)', async () => {
    const failing = fakeDb(null, new Error('connection refused'));
    await expect(
      createRateLimitStore(() => failing.db).hit('x.y', SUBJECT, { max: 1, windowSeconds: 1 }),
    ).rejects.toThrow('connection refused');
    const empty = fakeDb(null);
    await expect(createRateLimitStore(() => empty.db).peek('x.y', SUBJECT, 1)).rejects.toThrow(
      'no answer',
    );
  });
});
