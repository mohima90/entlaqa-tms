import type { RateLimit, RateLimitCounter, RateLimitStore } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { LIMIT_BUCKETS, PLATFORM_AUTH_LIMITS, RateLimiterUnavailableError } from './auth-limits';
import { createSignInCodeLimiter, rememberedBrowserHash } from './sign-in-code-limits';

/** An in-memory limiter store with the database's counting rules (fixed window, give back, clear). */
function fakeStore() {
  const counters = new Map<string, number>();
  const key = (bucket: string, subject: Uint8Array) => `${bucket}:${Buffer.from(subject).toString('hex')}`;
  const store = {
    hit: vi.fn((bucket: string, subject: Uint8Array, limit: RateLimit): Promise<RateLimitCounter> => {
      const k = key(bucket, subject);
      const hits = Math.min((counters.get(k) ?? 0) + 1, limit.max + 1);
      counters.set(k, hits);
      return Promise.resolve({
        allowed: hits <= limit.max,
        remaining: Math.max(0, limit.max - hits),
        retryAfterSeconds: hits > limit.max || hits === limit.max ? limit.windowSeconds : 0,
        ref: 'rk_test',
      });
    }),
    clear: vi.fn((bucket: string, subject: Uint8Array) => {
      counters.delete(key(bucket, subject));
      return Promise.resolve();
    }),
    giveBack: vi.fn((bucket: string, subject: Uint8Array) => {
      const k = key(bucket, subject);
      const hits = counters.get(k) ?? 0;
      if (hits > 1) counters.set(k, hits - 1);
      else counters.delete(k);
      return Promise.resolve();
    }),
  };
  return store as unknown as RateLimitStore & typeof store;
}

function limiterFor(store: RateLimitStore, client: { key: string | null } = { key: '203.0.113.7' }) {
  const log = vi.fn();
  return {
    log,
    limiter: createSignInCodeLimiter({
      store,
      limits: PLATFORM_AUTH_LIMITS,
      log,
      client,
      requestAction: 'platform.auth.sign_in_code_request',
      checkAction: 'platform.auth.sign_in_code_verify',
    }),
  };
}

describe('sign-in code requests', () => {
  it('are counted per client, then per typed address; a client over its budget counts nowhere else', async () => {
    const store = fakeStore();
    const { limiter } = limiterFor(store);
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.signInCode.requestsPerAccount.max; i += 1) {
      expect(await limiter.allowRequest('Someone@Example.test')).toBe(true);
    }
    // The address budget is used up (whatever the case typed); another address is still fine.
    expect(await limiter.allowRequest('someone@example.test')).toBe(false);
    expect(await limiter.allowRequest('other@example.test')).toBe(true);
  });

  it('a limited client never touches an address budget', async () => {
    const store = fakeStore();
    const { limiter } = limiterFor(store);
    const max = PLATFORM_AUTH_LIMITS.signInCode.requestsPerClient.max;
    for (let i = 0; i < max; i += 1) await limiter.allowRequest(`user${String(i)}@example.test`);
    const accountHits = store.hit.mock.calls.filter(([bucket]) => bucket === LIMIT_BUCKETS.signInCodeRequestAccount).length;
    expect(await limiter.allowRequest('late@example.test')).toBe(false);
    expect(store.hit.mock.calls.filter(([bucket]) => bucket === LIMIT_BUCKETS.signInCodeRequestAccount)).toHaveLength(accountHits);
  });

  it('fail closed when the limiter cannot answer', async () => {
    const store = fakeStore();
    store.hit.mockRejectedValueOnce(new Error('db down'));
    const { limiter } = limiterFor(store);
    await expect(limiter.allowRequest('a@example.test')).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });
});

describe('sign-in code checks', () => {
  it('count wrong codes only: 5 in a row pause checks, the tries left count down', async () => {
    const store = fakeStore();
    const { limiter, log } = limiterFor(store);
    const left: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const gate = await limiter.checkCode('a@example.test');
      expect(gate.allowed).toBe(true);
      if (!gate.allowed) throw new Error('unreachable');
      left.push(gate.attempt.triesIfWrong);
      await gate.attempt.failed();
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    // The 5th used the budget up: a lockout event (codes and keyed references only).
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'auth.lockout', limit: LIMIT_BUCKETS.signInCodeCheckAccount }));
    const sixth = await limiter.checkCode('A@example.test');
    expect(sixth).toEqual({ allowed: false, retryAfterSeconds: PLATFORM_AUTH_LIMITS.signInCode.checkAccountFailures.windowSeconds });
    // Another address is not affected.
    expect((await limiter.checkCode('b@example.test')).allowed).toBe(true);
  });

  it('a right code ends the run and gives the client its failure back', async () => {
    const store = fakeStore();
    const { limiter } = limiterFor(store);
    for (let i = 0; i < 3; i += 1) {
      const gate = await limiter.checkCode('a@example.test');
      if (gate.allowed) await gate.attempt.failed();
    }
    const gate = await limiter.checkCode('a@example.test');
    if (!gate.allowed) throw new Error('unreachable');
    await gate.attempt.succeeded();
    const next = await limiter.checkCode('a@example.test');
    expect(next.allowed && next.attempt.triesIfWrong).toBe(4);
  });

  it('an expired or used request ("released") costs no try', async () => {
    const store = fakeStore();
    const { limiter } = limiterFor(store);
    for (let i = 0; i < 10; i += 1) {
      const gate = await limiter.checkCode('a@example.test');
      if (!gate.allowed) throw new Error(`refused at ${String(i)}`);
      await gate.attempt.released();
    }
    const gate = await limiter.checkCode('a@example.test');
    expect(gate.allowed && gate.attempt.triesIfWrong).toBe(4);
  });

  it('log lines carry keyed references only - never the address', async () => {
    const store = fakeStore();
    const { limiter, log } = limiterFor(store);
    const gate = await limiter.checkCode('secret.person@example.test');
    if (gate.allowed) await gate.attempt.failed();
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret.person');
  });
});

describe('rememberedBrowserHash', () => {
  it('is a 32-byte SHA-256 of the token under a domain prefix', () => {
    const hash = rememberedBrowserHash('T'.repeat(43));
    expect(hash).toHaveLength(32);
    expect(hash.equals(rememberedBrowserHash('T'.repeat(43)))).toBe(true);
    expect(hash.equals(rememberedBrowserHash('U'.repeat(43)))).toBe(false);
  });
});
