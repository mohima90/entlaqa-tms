import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  claimAccountAccessCheck,
  finishAccountAccessCheck,
  retryAccountAccessCheck,
} from './account-access';

const dialect = new PgDialect();

function fakeTx(...results: unknown[][]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        const q = dialect.sqlToQuery(query);
        executed.push({ sql: q.sql, params: q.params });
        return Promise.resolve(results.shift() ?? []);
      },
    } as never,
  };
}

const USER = '9d000000-0000-4000-8000-000000000001';
// Microseconds: the exact text goes back to the database (a JS Date would lose them).
const AT = '2026-10-11 10:00:00.123456+00';

describe('the Auth ban queue (worker side)', () => {
  it('leases a check: account, action, the exact change it is based on, the attempt', async () => {
    const fake = fakeTx([{ user_id: USER, action: 'ban', requested_at: AT, attempts: 2 }], []);
    expect(await claimAccountAccessCheck(fake.tx)).toEqual({
      userId: USER,
      action: 'ban',
      requestedAt: AT,
      attempt: 2,
    });
    expect(fake.executed[0]?.sql).toContain('c.requested_at::text');
    expect(await claimAccountAccessCheck(fake.tx)).toBeNull();
  });

  it('refuses an action it does not know', async () => {
    const fake = fakeTx([{ user_id: USER, action: 'delete', requested_at: AT, attempts: 1 }]);
    await expect(claimAccountAccessCheck(fake.tx)).rejects.toThrow('unknown action');
  });

  it('finishes with the exact change and the outcome; retries put the check back', async () => {
    const fake = fakeTx([{ done: true }], [{ done: false }], [{ attempts: 3 }], []);
    expect(
      await finishAccountAccessCheck(fake.tx, { userId: USER, requestedAt: AT }, 'banned'),
    ).toBe(true);
    expect(fake.executed[0]?.params).toEqual([USER, AT, 'banned']);
    expect(
      await finishAccountAccessCheck(fake.tx, { userId: USER, requestedAt: AT }, 'unchanged'),
    ).toBe(false);
    expect(await retryAccountAccessCheck(fake.tx, USER)).toBe(3);
    expect(await retryAccountAccessCheck(fake.tx, USER)).toBe(0);
  });
});
