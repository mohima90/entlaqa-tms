import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import { createSignInCodeApi } from './sign-in-codes';

const dialect = new PgDialect();
const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';

/** A database whose transactions record the statements and answer the definer functions with `rows`. */
function fakeDb(rows: Record<string, unknown>[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  interface FakeTx {
    execute(query: SQL): Promise<unknown[]>;
    transaction(fn: (savepoint: FakeTx) => Promise<unknown>): Promise<unknown>;
  }
  const tx: FakeTx = {
    execute: (query) => {
      const q = dialect.sqlToQuery(query);
      executed.push(q);
      return Promise.resolve(q.sql.includes('private.') ? rows : []);
    },
    transaction: (fn) => fn(tx),
  };
  const db = { transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as AppDatabase;
  return { db, executed };
}

describe('sign-in codes on the request path (WP-ADM-05)', () => {
  it('requests a code without claims; a known and an unknown address are the same call', async () => {
    const { db, executed } = fakeDb([{ request_id: ID, outcome: 'queued', retry_after: 0 }]);
    const api = createSignInCodeApi(() => db);
    await expect(api.request('Someone@Example.test')).resolves.toEqual({ outcome: 'queued', requestId: ID });
    expect(executed[0]?.sql).toBe('set local role authenticated');
    expect(executed[1]?.params).toEqual(['']);
    expect(executed.at(-1)?.sql).toBe('select * from private.request_sign_in_code($1, null::bytea)');
    expect(executed.at(-1)?.params).toEqual(['Someone@Example.test']);
  });

  it('sends the remembered browser as a 32-byte hash only', async () => {
    const { db, executed } = fakeDb([{ request_id: ID, outcome: 'remembered', retry_after: 0 }]);
    const api = createSignInCodeApi(() => db);
    await expect(api.request('a@example.test', new Uint8Array(32).fill(1))).resolves.toEqual({
      outcome: 'remembered',
      requestId: ID,
    });
    expect(executed.at(-1)?.params).toEqual(['a@example.test', `\\x${'01'.repeat(32)}`]);
    await expect(api.request('a@example.test', new Uint8Array(5))).rejects.toThrow('32 bytes');
  });

  it('a second request within a minute answers the wait, bounded to a minute', async () => {
    const { db } = fakeDb([{ request_id: null, outcome: 'too_soon', retry_after: 42 }]);
    const api = createSignInCodeApi(() => db);
    await expect(api.request('a@example.test')).resolves.toEqual({ outcome: 'too_soon', retryAfterSeconds: 42 });
    const odd = createSignInCodeApi(() => fakeDb([{ request_id: null, outcome: 'too_soon', retry_after: 9999 }]).db);
    await expect(odd.request('a@example.test')).resolves.toEqual({ outcome: 'too_soon', retryAfterSeconds: 60 });
  });

  it('refuses an answer it does not know (never guesses)', async () => {
    const api = createSignInCodeApi(() => fakeDb([{ request_id: ID, outcome: 'mystery', retry_after: 0 }]).db);
    await expect(api.request('a@example.test')).rejects.toThrow('unexpected answer');
  });

  it('checks a code; the token only comes with ok', async () => {
    const { db, executed } = fakeDb([{ outcome: 'ok', link_token: 'one-time-sign-in-token' }]);
    const api = createSignInCodeApi(() => db);
    await expect(api.verify(ID, 'a@example.test', '482913')).resolves.toEqual({
      outcome: 'ok',
      linkToken: 'one-time-sign-in-token',
    });
    expect(executed.at(-1)?.params).toEqual([ID, 'a@example.test', '482913']);
    for (const outcome of ['wrong', 'locked', 'expired'] as const) {
      const other = createSignInCodeApi(() => fakeDb([{ outcome, link_token: null }]).db);
      await expect(other.verify(ID, 'a@example.test', '482913')).resolves.toEqual({ outcome });
    }
    // Anything unexpected reads as an expired code - never as a success.
    const odd = createSignInCodeApi(() => fakeDb([{ outcome: 'ok', link_token: null }]).db);
    await expect(odd.verify(ID, 'a@example.test', '482913')).resolves.toEqual({ outcome: 'expired' });
  });

  it('does not even ask the database about malformed input', async () => {
    const { db, executed } = fakeDb([]);
    const api = createSignInCodeApi(() => db);
    await expect(api.verify('not-an-id', 'a@example.test', '482913')).resolves.toEqual({ outcome: 'expired' });
    await expect(api.verify(ID, 'a@example.test', '12345')).rejects.toThrow('six-digit');
    await expect(api.takeRemembered('nope', 'a@example.test', new Uint8Array(32))).resolves.toEqual({ outcome: 'gone' });
    expect(executed).toEqual([]);
  });

  it('takes a remembered browser token once it is ready', async () => {
    for (const [outcome, expected] of [
      ['ok', { outcome: 'ok', linkToken: 'tok-tok-tok-tok-tok' }],
      ['pending', { outcome: 'pending' }],
      ['gone', { outcome: 'gone' }],
    ] as const) {
      const api = createSignInCodeApi(
        () => fakeDb([{ outcome, link_token: outcome === 'ok' ? 'tok-tok-tok-tok-tok' : null }]).db,
      );
      await expect(api.takeRemembered(ID, 'a@example.test', new Uint8Array(32))).resolves.toEqual(expected);
    }
  });
});
