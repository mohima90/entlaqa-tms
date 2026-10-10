import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { memberSignInLock, unlockMemberSignIn } from './sign-in-lock';
import type { UserTx } from './with-user-tx';

vi.mock('server-only', () => ({}));

const dialect = new PgDialect();
const PERSON = '8e3b0f6c-9a7f-4a69-8a3d-4c3a4a9f3b44';

function fakeTx(answer: Record<string, unknown>[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      return Promise.resolve(answer);
    },
  } as unknown as UserTx;
  return { tx, executed };
}

describe('member sign-in lock (T-M2-11, in the Organization Admin transaction)', () => {
  it('asks the database whether the member is locked against the account budget', async () => {
    const { tx, executed } = fakeTx([{ locked: true, retry_after_seconds: 420 }]);
    expect(await memberSignInLock(tx, PERSON, 5)).toEqual({ locked: true, retryAfterSeconds: 420 });
    expect(executed[0]?.sql).toContain('from private.member_sign_in_lock($1::uuid, $2::integer)');
    expect(executed[0]?.params).toEqual([PERSON, 5]);
    expect(await memberSignInLock(fakeTx([]).tx, PERSON, 5)).toEqual({
      locked: false,
      retryAfterSeconds: 0,
    });
  });

  it('ends the lock against the account budget; passes the database outcome on', async () => {
    const { tx, executed } = fakeTx([{ outcome: 'unlocked' }]);
    expect(await unlockMemberSignIn(tx, PERSON, 5)).toBe('unlocked');
    expect(executed[0]?.sql).toBe(
      'select private.unlock_member_sign_in($1::uuid, $2::integer) as outcome',
    );
    expect(executed[0]?.params).toEqual([PERSON, 5]);
    for (const outcome of ['not_locked', 'limited', 'no_account'] as const) {
      expect(await unlockMemberSignIn(fakeTx([{ outcome }]).tx, PERSON, 5)).toBe(outcome);
    }
  });

  it('refuses an unknown or missing answer', async () => {
    await expect(unlockMemberSignIn(fakeTx([{ outcome: 'maybe' }]).tx, PERSON, 5)).rejects.toThrow(
      'no answer',
    );
    await expect(unlockMemberSignIn(fakeTx([]).tx, PERSON, 5)).rejects.toThrow('no answer');
  });

  it('refuses malformed arguments before any round trip', async () => {
    const { tx, executed } = fakeTx([]);
    await expect(memberSignInLock(tx, 'not-a-uuid', 5)).rejects.toThrow('invalid person id');
    await expect(memberSignInLock(tx, PERSON, 0)).rejects.toThrow('invalid budget');
    await expect(unlockMemberSignIn(tx, 'x', 5)).rejects.toThrow('invalid person id');
    await expect(unlockMemberSignIn(tx, PERSON, 1.5)).rejects.toThrow('invalid budget');
    expect(executed).toHaveLength(0);
  });
});
