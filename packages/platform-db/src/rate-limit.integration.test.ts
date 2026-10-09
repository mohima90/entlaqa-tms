/**
 * Shared rate limiter against real PostgreSQL (T-M2-11; scripts/db-test.sh with DB_TEST_INTEGRATION=1):
 * concurrent hits of one key from separate connections never let more than the limit through (the row
 * lock of INSERT … ON CONFLICT), the stored key is HMAC-SHA-256 under the database's own key (computed
 * here independently from the secret, read as the owner), and the TypeScript checks refuse readable keys
 * before any round trip. The SQL behaviour (windows, purge, grants) is in supabase/tests/70–72.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { createRateLimitStore } from './rate-limit';

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
    expect((await store.peek(bucket, key, 7)).allowed).toBe(false);
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
      { inner_key: Buffer }[]
    >`select inner_key from private.rate_limit_secret`;
    // K = inner xor 0x36 (RFC 2104 with a 64-byte key).
    const k = Buffer.from((secret?.inner_key ?? Buffer.alloc(64)).map((byte) => byte ^ 0x36));
    const expected = createHmac('sha256', k).update(key).digest();
    const [row] = await owner<{ key_hash: Buffer }[]>`
      select key_hash from private.rate_limit_counters where bucket = ${`${bucket}.hmac`}`;
    expect(row?.key_hash.equals(expected)).toBe(true);
    expect(row?.key_hash.equals(key)).toBe(false);
    expect(row?.key_hash.equals(createHash('sha256').update(key).digest())).toBe(false);
    expect(counter.ref).toBe(`rk_${expected.subarray(0, 12).toString('hex')}`);
  });

  it('peeks without counting and clears a key', async () => {
    const key = subject(`clear-${tag}`);
    await store.hit(`${bucket}.clear`, key, { max: 2, windowSeconds: 60 });
    await store.hit(`${bucket}.clear`, key, { max: 2, windowSeconds: 60 });
    expect(await store.peek(`${bucket}.clear`, key, 2)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(await store.peek(`${bucket}.clear`, key, 2)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    await store.clear(`${bucket}.clear`, key);
    expect(await store.peek(`${bucket}.clear`, key, 2)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
  });

  it('refuses readable keys and bad limits before any round trip', () => {
    const readable = Buffer.from('someone@example.test');
    expect(() => store.hit(bucket, readable, { max: 1, windowSeconds: 60 })).toThrow(/32-byte/);
    expect(() => store.peek('Bad Bucket', subject('x'), 1)).toThrow(/bucket/);
    expect(() => store.hit(bucket, subject('x'), { max: 0, windowSeconds: 60 })).toThrow(/max/);
    expect(() => store.hit(bucket, subject('x'), { max: 1, windowSeconds: 86_401 })).toThrow(
      /window/,
    );
  });
});
