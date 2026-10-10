/**
 * Shared rate limiter against real PostgreSQL (T-M2-11; scripts/db-test.sh with DB_TEST_INTEGRATION=1):
 * concurrent hits of one key from separate connections never let more than the limit through (the row
 * lock of INSERT … ON CONFLICT) — nor do concurrent sign-in checks of one account (counted BEFORE Auth:
 * at most 5 attempts reach Auth, security review T-M2-11); the stored key is HMAC-SHA-256 under the
 * database's counter key and the log reference under its log key (computed here independently from the
 * secret, read as the owner); an opt-in trusted browser, Auth's own refusal and a password reset;
 * readiness; and the TypeScript checks
 * refuse readable keys before any round trip. The SQL behaviour (windows, purge, grants) is in
 * supabase/tests/70–72.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { checkDatabase } from './health';
import { type SignInBudgets, createRateLimitStore } from './rate-limit';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

const subject = (label: string) => createHash('sha256').update(label).digest();

describe.skipIf(!configured)('rate limiter against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  // A pool of 10 connections: parallel hits really run in separate transactions at the same time.
  const serverDb = createDatabase(appServerUrl ?? '', { max: 10 });
  const store = createRateLimitStore(() => serverDb);
  const tag = randomUUID().slice(0, 8);
  const bucket = `itest.r${tag}`;

  afterAll(async () => {
    await owner`delete from private.rate_limit_counters where bucket like ${'itest.%'}`;
    await owner`delete from private.rate_limit_counters where bucket like ${'sign_in.%'}`;
    await owner`delete from private.sign_in_trusted_devices`;
    await owner.end();
    await serverDb.$client.end();
  });

  it('lets exactly the limit through when 40 hits of one key run at once', async () => {
    const key = subject(`concurrent-${tag}`);
    const answers = await Promise.all(
      Array.from({ length: 40 }, () => store.hit(bucket, key, { max: 7, windowSeconds: 600 })),
    );
    expect(answers.filter((a) => a.allowed)).toHaveLength(7);
    expect(answers.filter((a) => !a.allowed).every((a) => a.retryAfterSeconds > 0)).toBe(true);
    expect(new Set(answers.map((a) => a.ref)).size).toBe(1);
    const [row] = await owner<{ hits: number }[]>`
      select hits from private.rate_limit_counters where bucket = ${bucket}`;
    expect(row?.hits).toBe(8); // capped at max + 1
    expect((await store.hit(bucket, key, { max: 7, windowSeconds: 600 })).allowed).toBe(false);
  });

  it('keeps different keys apart under concurrency', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => subject(`many-${tag}-${String(i)}`));
    const answers = await Promise.all(
      keys.flatMap((key) =>
        [1, 2, 3].map(() => store.hit(`${bucket}.many`, key, { max: 2, windowSeconds: 600 })),
      ),
    );
    expect(answers.filter((a) => a.allowed)).toHaveLength(40);
  });

  it('stores HMAC-SHA-256(database key, subject) — never the subject or a plain hash of it', async () => {
    const key = subject(`hmac-${tag}`);
    const counter = await store.hit(`${bucket}.hmac`, key, { max: 3, windowSeconds: 60 });
    const [secret] = await owner<
      { inner_key: Buffer; log_inner_key: Buffer }[]
    >`select inner_key, log_inner_key from private.rate_limit_secret`;
    // K = inner xor 0x36 (RFC 2104 with a 64-byte key); the log key likewise.
    const k = Buffer.from((secret?.inner_key ?? Buffer.alloc(64)).map((byte) => byte ^ 0x36));
    const logK = Buffer.from(
      (secret?.log_inner_key ?? Buffer.alloc(64)).map((byte) => byte ^ 0x36),
    );
    const expected = createHmac('sha256', k).update(key).digest();
    const [row] = await owner<{ key_hash: Buffer }[]>`
      select key_hash from private.rate_limit_counters where bucket = ${`${bucket}.hmac`}`;
    expect(row?.key_hash.equals(expected)).toBe(true);
    expect(row?.key_hash.equals(key)).toBe(false);
    expect(row?.key_hash.equals(createHash('sha256').update(key).digest())).toBe(false);
    // The log reference comes from the OTHER key: no prefix of the stored key (review LOW 5).
    const ref = createHmac('sha256', logK).update(key).digest().subarray(0, 12).toString('hex');
    expect(counter.ref).toBe(`rk_${ref}`);
    expect(counter.ref).not.toBe(`rk_${expected.subarray(0, 12).toString('hex')}`);
  });

  it('clears a key', async () => {
    const key = subject(`clear-${tag}`);
    await store.hit(`${bucket}.clear`, key, { max: 2, windowSeconds: 60 });
    await store.hit(`${bucket}.clear`, key, { max: 2, windowSeconds: 60 });
    await store.clear(`${bucket}.clear`, key);
    expect(await store.hit(`${bucket}.clear`, key, { max: 2, windowSeconds: 60 })).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  const budgets: SignInBudgets = {
    clientAttempts: { max: 1000, windowSeconds: 600 },
    clientFailures: { max: 100, windowSeconds: 600 },
    accountFailures: { max: 5, windowSeconds: 600 },
    deviceFailures: { max: 10, windowSeconds: 600 },
  };

  it('lets at most 5 sign-in attempts of one account reach Auth when 30 run at once', async () => {
    const account = subject(`account-${tag}`);
    const answers = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        store.signInCheck(
          { client: subject(`client-${tag}-${String(i)}`), account, device: null },
          budgets,
        ),
      ),
    );
    expect(answers.filter((a) => a.allowed)).toHaveLength(5);
    const refused = answers.filter((a) => !a.allowed);
    expect(refused.every((a) => a.refusedBy === 'sign_in.account_failures')).toBe(true);
    expect(refused.every((a) => a.retryAfterSeconds > 0 && a.retryAfterSeconds <= 600)).toBe(true);
    // Refused before Auth: those clients got their provisional failure back.
    expect(refused.every((a) => a.clientRemaining === 100)).toBe(true);
    expect(new Set(answers.map((a) => a.subjectRef)).size).toBe(1);
  });

  it('trusts a browser after a ticked success: it passes the account lock with its own budget; a reset trusts only the browser that completed it', async () => {
    const account = subject(`trusted-${tag}`);
    const browser = subject(`browser-${tag}`);
    const client = subject(`trusted-client-${tag}`);
    const first = await store.signInCheck({ client, account, device: null }, budgets);
    expect(first).toMatchObject({ allowed: true, trusted: false, remaining: 4 });
    const trust = await store.signInSucceeded({ client, account, device: null }, false, {
      freshDevice: browser,
      trustDays: 30,
    });
    expect(trust?.device).toBe('fresh');
    expect(trust?.until.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    // Five failures from unknown browsers lock the account.
    for (let i = 0; i < 6; i += 1) {
      await store.signInCheck(
        { client: subject(`other-${tag}-${String(i)}`), account, device: null },
        budgets,
      );
    }
    expect(await store.signInCheck({ client, account, device: null }, budgets)).toMatchObject({
      allowed: false,
      refusedBy: 'sign_in.account_failures',
    });
    expect(await store.signInCheck({ client, account, device: browser }, budgets)).toMatchObject({
      allowed: true,
      trusted: true,
      remaining: 9,
    });
    // Auth refused to compare (429): the browser's failure is given back.
    await store.signInNotChecked({ client, account, device: browser }, true);
    expect(await store.signInCheck({ client, account, device: browser }, budgets)).toMatchObject({
      trusted: true,
      remaining: 9,
    });
    const other = subject(`reset-browser-${tag}`);
    const reset = await store.signInReset(account, null, { freshDevice: other, trustDays: 30 });
    expect(reset).toMatchObject({ revoked: 1, device: 'fresh' });
    expect(await store.signInCheck({ client, account, device: browser }, budgets)).toMatchObject({
      allowed: true,
      trusted: false,
    });
    expect(await store.signInCheck({ client, account, device: other }, budgets)).toMatchObject({
      allowed: true,
      trusted: true,
    });
    expect(await store.forgetOtherDevices(account, null)).toBe(1);
  });

  it('trusts nothing after an unticked success (opt-in)', async () => {
    const account = subject(`unticked-${tag}`);
    const client = subject(`unticked-client-${tag}`);
    await store.signInCheck({ client, account, device: null }, budgets);
    expect(await store.signInSucceeded({ client, account, device: null }, false, null)).toBeNull();
    expect(await store.forgetOtherDevices(account, null)).toBe(0);
  });

  it('is ready only when the sign-in functions exist (deploy readiness)', async () => {
    await expect(checkDatabase({ getDb: () => serverDb })).resolves.toBe('ok');
  });

  it('refuses readable keys and bad limits before any round trip', () => {
    const readable = Buffer.from('someone@example.test');
    expect(() => store.hit(bucket, readable, { max: 1, windowSeconds: 60 })).toThrow(/32-byte/);
    expect(() => store.hit('Bad Bucket', subject('x'), { max: 1, windowSeconds: 60 })).toThrow(
      /bucket/,
    );
    expect(() => store.hit(bucket, subject('x'), { max: 0, windowSeconds: 60 })).toThrow(/max/);
    expect(() => store.hit(bucket, subject('x'), { max: 1, windowSeconds: 86_401 })).toThrow(
      /window/,
    );
  });
});
