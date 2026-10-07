import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { createAccountMailApi, queueOwnPasswordChangedMail } from './account-mail';
import type { AppDatabase } from './client';

const dialect = new PgDialect();
const USER = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';

/** A database whose transactions record the statements (set role, claims, the call). */
function fakeDb(fail?: Error) {
  const executed: { sql: string; params: unknown[] }[] = [];
  interface FakeTx {
    execute(query: SQL): Promise<unknown[]>;
    transaction(fn: (savepoint: FakeTx) => Promise<unknown>): Promise<unknown>;
  }
  const tx: FakeTx = {
    execute: (query) => {
      const q = dialect.sqlToQuery(query);
      executed.push(q);
      return fail && q.sql.includes('private.') ? Promise.reject(fail) : Promise.resolve([]);
    },
    transaction: (fn) => fn(tx),
  };
  const db = {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as AppDatabase;
  return { db, tx, executed };
}

describe('account e-mail requests on the request path (T-M2-17)', () => {
  it('queues a reset request for the typed address without claims, and returns nothing', async () => {
    const { db, executed } = fakeDb();
    const api = createAccountMailApi(() => db);
    await expect(api.requestPasswordResetMail('Reset.Me@example.test')).resolves.toBeUndefined();
    expect(executed[0]?.sql).toBe('set local role authenticated');
    // Empty claims: the definer function answers the app_server login only.
    expect(executed[1]?.params).toEqual(['']);
    expect(executed.at(-1)).toMatchObject({
      sql: 'select private.request_password_reset_mail($1)',
      params: ['Reset.Me@example.test'],
    });
  });

  it('queues the "password changed" notice after a reset (no claims); refuses a malformed id', async () => {
    const { db, executed } = fakeDb();
    const api = createAccountMailApi(() => db);
    await api.requestPasswordChangedMail(USER);
    expect(executed.at(-1)).toMatchObject({
      sql: 'select private.request_password_changed_mail($1::uuid)',
      params: [USER],
    });
    await expect(api.requestPasswordChangedMail('not-a-uuid')).rejects.toThrow('invalid user id');
  });

  it('passes database failures to the caller (it logs a code and answers the same)', async () => {
    const { db } = fakeDb(new Error('connection refused'));
    await expect(
      createAccountMailApi(() => db).requestPasswordResetMail('a@example.test'),
    ).rejects.toThrow('connection refused');
  });

  it('My profile: the own notice is queued in a savepoint of the caller transaction', async () => {
    const { tx, executed } = fakeDb();
    await queueOwnPasswordChangedMail(tx as never, USER);
    expect(executed).toMatchObject([
      { sql: 'select private.request_password_changed_mail($1::uuid)', params: [USER] },
    ]);
    await expect(queueOwnPasswordChangedMail(tx as never, 'x')).rejects.toThrow('invalid user id');
  });
});
