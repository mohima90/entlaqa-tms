import { createHash } from 'node:crypto';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import { RATE_LIMIT_STATEMENT_TIMEOUT_MS, createRateLimitStore } from './rate-limit';

const dialect = new PgDialect();
const SUBJECT = createHash('sha256').update('subject').digest();
const FRESH = createHash('sha256').update('fresh').digest();
const SESSION = createHash('sha256').update('session').digest();
/** A ticked sign-in: the verified token's user and session; Auth named no app (the database looks too). */
const SIGNED_IN = {
  userId: '11111111-1111-4111-8111-111111111111',
  session: SESSION,
  authNamesApp: false,
  codeWaitMinutes: 15,
};

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

  it('clears and gives back with the same checks', async () => {
    const { db, executed } = fakeDb(answer);
    const store = createRateLimitStore(() => db);
    await store.clear('sign_in.account_failures', SUBJECT);
    expect(executed.at(-1)?.sql).toBe('select private.rate_limit_clear($1, $2::bytea)');
    await store.giveBack('mfa.code_failures', SUBJECT);
    expect(executed.at(-1)?.sql).toBe('select private.rate_limit_give_back($1, $2::bytea)');
  });

  it('refuses readable keys, bad buckets and bad limits before any round trip', async () => {
    const { db, executed } = fakeDb(answer);
    const store = createRateLimitStore(() => db);
    expect(() =>
      store.hit('x.y', Buffer.from('user@example.test'), { max: 1, windowSeconds: 1 }),
    ).toThrow('32-byte');
    expect(() => store.hit('Sign In', SUBJECT, { max: 1, windowSeconds: 1 })).toThrow('bucket');
    expect(() => store.hit('x.y', SUBJECT, { max: 1.5, windowSeconds: 1 })).toThrow('max');
    expect(() => store.hit('x.y', SUBJECT, { max: 1, windowSeconds: 0 })).toThrow('window');
    expect(() => store.hit('x.y', SUBJECT, { max: 2_000_000, windowSeconds: 1 })).toThrow('max');
    await expect(store.clear('x.y', new Uint8Array(31))).rejects.toThrow('32-byte');
    expect(executed).toHaveLength(0);
  });

  it('checks a sign-in in ONE call with every budget, and maps the answer', async () => {
    const { db, executed } = fakeDb({
      allowed: false,
      refused_by: 'sign_in.account_failures',
      retry_after_seconds: 600,
      remaining: 0,
      client_remaining: 99,
      trusted: false,
      subject_ref: 'rk_aa',
      client_ref: 'rk_bb',
    });
    const store = createRateLimitStore(() => db);
    const check = await store.signInCheck(
      { client: SUBJECT, account: SUBJECT, device: null },
      {
        clientAttempts: { max: 1000, windowSeconds: 900 },
        clientFailures: { max: 100, windowSeconds: 900 },
        accountFailures: { max: 5, windowSeconds: 900 },
        deviceFailures: { max: 10, windowSeconds: 900 },
      },
    );
    expect(check).toEqual({
      allowed: false,
      refusedBy: 'sign_in.account_failures',
      retryAfterSeconds: 600,
      remaining: 0,
      clientRemaining: 99,
      trusted: false,
      subjectRef: 'rk_aa',
      clientRef: 'rk_bb',
    });
    const calls = executed.filter((q) => q.sql.includes('private.rate_limit'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('from private.rate_limit_sign_in_check(');
    expect(calls[0]?.params).toEqual([
      SUBJECT,
      SUBJECT,
      null,
      1000,
      900,
      100,
      900,
      5,
      900,
      10,
      900,
    ]);
  });

  it('records a ticked success: the database chooses the token, the app gets its trust', async () => {
    const { db, executed } = fakeDb({ device: 'fresh', trusted_until: '2026-11-08T10:00:00.000Z' });
    const store = createRateLimitStore(() => db);
    const trust = await store.signInSucceeded(
      { client: SUBJECT, account: SUBJECT, device: SUBJECT },
      true,
      { freshDevice: FRESH, trustDays: 30, ...SIGNED_IN },
    );
    expect(trust).toEqual({ device: 'fresh', until: new Date('2026-11-08T10:00:00.000Z') });
    expect(executed.at(-1)?.sql).toContain('from private.rate_limit_sign_in_succeeded(');
    // The token's user, its session and Auth's word on an app go to the database, which decides (L4).
    expect(executed.at(-1)?.params).toEqual([
      SUBJECT,
      SUBJECT,
      SUBJECT,
      FRESH,
      true,
      true,
      30,
      SIGNED_IN.userId,
      SESSION,
      false,
      15,
    ]);
  });

  it('records an unticked success without trust (opt-in)', async () => {
    const { db, executed } = fakeDb({ device: null, trusted_until: null });
    const store = createRateLimitStore(() => db);
    expect(
      await store.signInSucceeded({ client: SUBJECT, account: SUBJECT, device: null }, false, null),
    ).toBeNull();
    expect(executed.at(-1)?.params).toEqual([
      SUBJECT,
      SUBJECT,
      null,
      null,
      false,
      false,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('gives a failure back when Auth did not compare the password', async () => {
    const { db, executed } = fakeDb({});
    await createRateLimitStore(() => db).signInNotChecked(
      { client: SUBJECT, account: SUBJECT, device: SUBJECT },
      true,
    );
    expect(executed.at(-1)?.sql).toContain('private.rate_limit_sign_in_not_checked(');
    expect(executed.at(-1)?.params).toEqual([SUBJECT, SUBJECT, true]);
  });

  it('records a reset (the completing browser trusted) and forgets the other browsers', async () => {
    const { db, executed } = fakeDb({
      revoked: 2,
      device: 'presented',
      trusted_until: new Date('2026-11-08T10:00:00.000Z'),
    });
    const store = createRateLimitStore(() => db);
    expect(
      await store.signInReset(SUBJECT, SUBJECT, { freshDevice: FRESH, trustDays: 30 }),
    ).toEqual({
      revoked: 2,
      device: 'presented',
      until: new Date('2026-11-08T10:00:00.000Z'),
    });
    expect(executed.at(-1)?.sql).toContain('from private.rate_limit_sign_in_reset(');
    expect(executed.at(-1)?.params).toEqual([SUBJECT, SUBJECT, FRESH, 30]);
    const forget = fakeDb({ revoked: 3 });
    expect(await createRateLimitStore(() => forget.db).forgetOtherDevices(SUBJECT, null)).toBe(3);
    expect(forget.executed.at(-1)?.sql).toContain('private.rate_limit_forget_other_devices(');
    expect(forget.executed.at(-1)?.params).toEqual([SUBJECT, null]);
  });

  it('rejects an unknown trusted-browser answer', async () => {
    const { db } = fakeDb({ device: 'someone-else', trusted_until: '2026-11-08T10:00:00.000Z' });
    await expect(
      createRateLimitStore(() => db).signInSucceeded(
        { client: SUBJECT, account: SUBJECT, device: null },
        false,
        { freshDevice: FRESH, trustDays: 30, ...SIGNED_IN },
      ),
    ).rejects.toThrow('unknown trusted-browser answer');
  });

  it('refuses bad sign-in arguments before any round trip', () => {
    const { db, executed } = fakeDb(answer);
    const store = createRateLimitStore(() => db);
    const budget = { max: 5, windowSeconds: 900 };
    const budgets = {
      clientAttempts: budget,
      clientFailures: budget,
      accountFailures: budget,
      deviceFailures: { max: 0, windowSeconds: 900 },
    };
    expect(() =>
      store.signInCheck({ client: SUBJECT, account: SUBJECT, device: null }, budgets),
    ).toThrow('max');
    expect(() =>
      store.signInCheck(
        { client: SUBJECT, account: Buffer.from('user@example.test'), device: null },
        { ...budgets, deviceFailures: budget },
      ),
    ).toThrow('32-byte');
    expect(() =>
      store.signInSucceeded({ client: SUBJECT, account: SUBJECT, device: SUBJECT }, false, {
        freshDevice: FRESH,
        trustDays: 0,
        ...SIGNED_IN,
      }),
    ).toThrow('days');
    expect(() =>
      store.signInSucceeded({ client: SUBJECT, account: SUBJECT, device: null }, false, {
        freshDevice: FRESH,
        trustDays: 30,
        ...SIGNED_IN,
        userId: 'not-a-user',
      }),
    ).toThrow('UUID');
    expect(() =>
      store.signInSucceeded({ client: SUBJECT, account: SUBJECT, device: null }, false, {
        freshDevice: FRESH,
        trustDays: 30,
        ...SIGNED_IN,
        codeWaitMinutes: 61,
      }),
    ).toThrow('minutes');
    expect(() =>
      store.signInSucceeded({ client: SUBJECT, account: SUBJECT, device: null }, false, {
        freshDevice: FRESH,
        trustDays: 30,
        ...SIGNED_IN,
        session: Buffer.from('short'),
      }),
    ).toThrow('32-byte');
    expect(() =>
      store.signInSucceeded({ client: SUBJECT, account: SUBJECT, device: null }, true, null),
    ).toThrow('token');
    expect(() =>
      store.signInReset(SUBJECT, null, { freshDevice: new Uint8Array(8), trustDays: 30 }),
    ).toThrow('32-byte');
    expect(executed).toHaveLength(0);
  });

  it('rejects an unknown refusal from the database', async () => {
    const { db } = fakeDb({ ...answer, refused_by: 'sign_in.other' });
    await expect(
      createRateLimitStore(() => db).signInCheck(
        { client: SUBJECT, account: SUBJECT, device: null },
        {
          clientAttempts: { max: 1, windowSeconds: 1 },
          clientFailures: { max: 1, windowSeconds: 1 },
          accountFailures: { max: 1, windowSeconds: 1 },
          deviceFailures: { max: 1, windowSeconds: 1 },
        },
      ),
    ).rejects.toThrow('unknown sign-in refusal');
  });

  it('passes database failures and empty answers to the caller (its failure policy applies)', async () => {
    const failing = fakeDb(null, new Error('connection refused'));
    await expect(
      createRateLimitStore(() => failing.db).hit('x.y', SUBJECT, { max: 1, windowSeconds: 1 }),
    ).rejects.toThrow('connection refused');
    const empty = fakeDb(null);
    await expect(
      createRateLimitStore(() => empty.db).hit('x.y', SUBJECT, { max: 1, windowSeconds: 1 }),
    ).rejects.toThrow('no answer');
    await expect(
      createRateLimitStore(() => empty.db).forgetOtherDevices(SUBJECT, null),
    ).rejects.toThrow('no answer');
  });
});
