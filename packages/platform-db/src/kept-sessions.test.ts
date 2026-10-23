import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { forgetKeptSessions, keepSession, listMyKeptSessions } from './kept-sessions';

const dialect = new PgDialect();

function fakeTx(...results: unknown[][]) {
  const executed: string[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        executed.push(dialect.sqlToQuery(query).sql);
        return Promise.resolve(results[Math.min(executed.length, results.length) - 1] ?? []);
      },
    } as never,
  };
}

describe('sessions kept signed in (WP-ADM-05)', () => {
  it('keeps the current session and says for how many days (0: nothing kept)', async () => {
    const fake = fakeTx([{ days: 14 }]);
    expect(await keepSession(fake.tx)).toBe(14);
    expect(fake.executed[0]).toBe('select private.keep_session() as days');
    expect(await keepSession(fakeTx([{ days: 0 }]).tx)).toBe(0);
    expect(await keepSession(fakeTx([]).tx)).toBe(0);
  });

  it("lists the account's own kept sessions with dates and the one asking", async () => {
    const fake = fakeTx([
      {
        session_id: '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11',
        kept_until: '2026-11-06T10:00:00Z',
        started_at: new Date('2026-10-23T10:00:00Z'),
        user_agent: 'Mozilla/5.0',
        is_current: true,
      },
    ]);
    expect(await listMyKeptSessions(fake.tx)).toEqual([
      {
        sessionId: '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11',
        keptUntil: new Date('2026-11-06T10:00:00Z'),
        startedAt: new Date('2026-10-23T10:00:00Z'),
        userAgent: 'Mozilla/5.0',
        current: true,
      },
    ]);
    expect(fake.executed[0]).toBe('select * from private.my_kept_sessions()');
  });

  it('«Forget all» counts the sessions it stopped keeping', async () => {
    expect(await forgetKeptSessions(fakeTx([{ count: 2 }]).tx)).toBe(2);
    expect(await forgetKeptSessions(fakeTx([]).tx)).toBe(0);
  });
});
