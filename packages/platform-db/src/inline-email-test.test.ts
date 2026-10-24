import { createHash } from 'node:crypto';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import { claimInlineEmailTest, createInlineEmailTestApi } from './inline-email-test';

const dialect = new PgDialect();

function fakeDb(rows: Record<string, unknown>[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  interface FakeTx {
    execute(query: SQL): Promise<unknown[]>;
  }
  const tx: FakeTx = {
    execute: (query) => {
      const q = dialect.sqlToQuery(query);
      executed.push(q);
      return Promise.resolve(q.sql.includes('private.') ? rows : []);
    },
  };
  const db = {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as AppDatabase;
  return { db, tx: tx as never, executed };
}

const row = {
  tenant_id: 'a0000000-0000-4000-8000-000000000001',
  recipient: 'it@raya.example',
  version: 4,
  provider: 'smtp',
  options: { host: 'smtp.raya.example' },
  credentials_sealed: 'v1.k3yId0000001.xxxx',
  from_name: 'Al Raya',
  from_address: 'hr@raya.example',
  reply_to: null,
};

describe("claiming the caller's own test e-mail in the action's transaction", () => {
  it("keeps only the secret's SHA-256 in the database and hands the secret to the caller", async () => {
    const { tx, executed } = fakeDb([row]);
    const ticket = await claimInlineEmailTest(tx, 'tenant');
    expect(ticket?.test).toEqual({
      tenantId: row.tenant_id,
      recipient: 'it@raya.example',
      version: 4,
      provider: 'smtp',
      options: { host: 'smtp.raya.example' },
      credentialsSealed: 'v1.k3yId0000001.xxxx',
      fromName: 'Al Raya',
      fromAddress: 'hr@raya.example',
      replyTo: null,
    });
    expect(ticket?.secret).toHaveLength(32);
    expect(executed[0]?.sql).toBe('select * from private.inline_email_test_claim($1, $2::bytea)');
    expect(executed[0]?.params[0]).toBe('tenant');
    const hash = executed[0]?.params[1] as Uint8Array;
    expect(
      Buffer.from(hash).equals(
        createHash('sha256')
          .update(ticket?.secret ?? Buffer.alloc(0))
          .digest(),
      ),
    ).toBe(true);
  });

  it('nothing waiting: no ticket', async () => {
    const { tx } = fakeDb([]);
    expect(await claimInlineEmailTest(tx, 'platform')).toBeNull();
  });
});

describe('recording the outcome', () => {
  const secret = Buffer.alloc(32, 3);

  it("with the request's secret and the version tested, without claims", async () => {
    const { db, executed } = fakeDb([{ verified: true }]);
    const api = createInlineEmailTestApi(() => db);
    expect(await api.finish(secret, 4, { sent: true })).toBe(true);
    expect(executed.at(-1)?.params).toEqual([secret, 4, true, null]);
    expect(executed[0]?.sql).toBe('set local role authenticated');
    expect(executed[1]?.params).toEqual(['']);
    await api.finish(secret, 4, { sent: false, errorCode: 'REJECTED' });
    expect(executed.at(-1)?.params).toEqual([secret, 4, false, 'REJECTED']);
  });

  it('false when nothing was verified or the secret is malformed (nothing is asked)', async () => {
    const { db, executed } = fakeDb([{ verified: false }]);
    const api = createInlineEmailTestApi(() => db);
    expect(await api.finish(secret, 4, { sent: true })).toBe(false);
    const before = executed.length;
    expect(await api.finish(Buffer.alloc(3), 4, { sent: true })).toBe(false);
    expect(executed).toHaveLength(before);
  });
});
