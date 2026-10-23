import type { RateLimit, RateLimitCounter, RateLimitStore } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { LIMIT_BUCKETS, PLATFORM_AUTH_LIMITS, RateLimiterUnavailableError } from './auth-limits';
import { createSendEmailHookLimiter, createSignInCodeLimiter } from './sign-in-code-limits';

/** An in-memory limiter store with the database's counting rules (fixed window, give back, clear). */
function fakeStore() {
  const counters = new Map<string, number>();
  const key = (bucket: string, subject: Uint8Array) =>
    `${bucket}:${Buffer.from(subject).toString('hex')}`;
  const store = {
    hit: vi.fn(
      (bucket: string, subject: Uint8Array, limit: RateLimit): Promise<RateLimitCounter> => {
        const k = key(bucket, subject);
        const hits = Math.min((counters.get(k) ?? 0) + 1, limit.max + 1);
        counters.set(k, hits);
        return Promise.resolve({
          allowed: hits <= limit.max,
          remaining: Math.max(0, limit.max - hits),
          retryAfterSeconds: hits > limit.max || hits === limit.max ? limit.windowSeconds : 0,
          ref: 'rk_test',
        });
      },
    ),
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

type SignInCodeLimits = typeof PLATFORM_AUTH_LIMITS.signInCode;

function limiterFor(
  store: RateLimitStore,
  client: { key: string | null } = { key: '203.0.113.7' },
  more: {
    signInCode?: Partial<SignInCodeLimits>;
    accountBudget?: (email: string) => Promise<RateLimit>;
  } = {},
) {
  const log = vi.fn();
  return {
    log,
    limiter: createSignInCodeLimiter({
      store,
      limits: {
        ...PLATFORM_AUTH_LIMITS,
        signInCode: {
          ...PLATFORM_AUTH_LIMITS.signInCode,
          // Most tests are about the 15-minute and daily ceilings: the one-a-minute rule is opened.
          requestsPerMinute: { max: 1000, windowSeconds: 60 },
          ...more.signInCode,
        },
      },
      log,
      client,
      requestAction: 'platform.auth.sign_in_code_request',
      checkAction: 'platform.auth.sign_in_code_verify',
      accountBudget: more.accountBudget,
    }),
  };
}

const allowed = { allowed: true };

describe('sign-in code requests', () => {
  it('are counted per client, then per typed address; a client over its budget counts nowhere else', async () => {
    const store = fakeStore();
    const { limiter } = limiterFor(store);
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.signInCode.requestsPerAccount.max; i += 1) {
      expect(await limiter.allowRequest('Someone@Example.test')).toEqual(allowed);
    }
    // The address budget is used up (whatever the case typed); another address is still fine.
    expect(await limiter.allowRequest('someone@example.test')).toEqual({ allowed: false });
    expect(await limiter.allowRequest('other@example.test')).toEqual(allowed);
  });

  it('one code a minute per address: the wait is the same for any address, and tells the seconds', async () => {
    const store = fakeStore();
    const { limiter } = limiterFor(store, undefined, {
      signInCode: { requestsPerMinute: PLATFORM_AUTH_LIMITS.signInCode.requestsPerMinute },
    });
    expect(await limiter.allowRequest('a@example.test')).toEqual(allowed);
    expect(await limiter.allowRequest('A@example.test')).toEqual({
      allowed: false,
      tooSoonSeconds: 60,
    });
    expect(await limiter.allowRequest('b@example.test')).toEqual(allowed);
  });

  it('a limited client never touches an address budget', async () => {
    const store = fakeStore();
    const { limiter } = limiterFor(store);
    const max = PLATFORM_AUTH_LIMITS.signInCode.requestsPerClient.max;
    for (let i = 0; i < max; i += 1) await limiter.allowRequest(`user${String(i)}@example.test`);
    const accountHits = store.hit.mock.calls.filter(
      ([bucket]) => bucket === LIMIT_BUCKETS.signInCodeRequestAccount,
    ).length;
    expect(await limiter.allowRequest('late@example.test')).toEqual({ allowed: false });
    expect(
      store.hit.mock.calls.filter(([bucket]) => bucket === LIMIT_BUCKETS.signInCodeRequestAccount),
    ).toHaveLength(accountHits);
  });

  it('fail closed when the limiter cannot answer', async () => {
    const store = fakeStore();
    store.hit.mockRejectedValueOnce(new Error('db down'));
    const { limiter } = limiterFor(store);
    await expect(limiter.allowRequest('a@example.test')).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });

  it('a daily cap per typed address on top of the 15-minute one', async () => {
    const store = fakeStore();
    const { limiter, log } = limiterFor(store, undefined, {
      signInCode: {
        requestsPerAccount: { max: 100, windowSeconds: 900 },
        requestsPerAccountDaily: { max: 3, windowSeconds: 86_400 },
      },
    });
    for (let i = 0; i < 3; i += 1) {
      expect(await limiter.allowRequest('a@example.test')).toEqual(allowed);
    }
    expect(await limiter.allowRequest('a@example.test')).toEqual({ allowed: false });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.rate_limited',
        limit: LIMIT_BUCKETS.signInCodeRequestAccountDaily,
      }),
    );
    expect(await limiter.allowRequest('b@example.test')).toEqual(allowed);
  });

  it('an IPv6 client is counted by its /48, not its /64', async () => {
    const store = fakeStore();
    const max = PLATFORM_AUTH_LIMITS.signInCode.requestsPerClient.max;
    for (let i = 0; i < max; i += 1) {
      const { limiter } = limiterFor(store, { key: `2001:db8:1:${String(i + 1)}::/64` });
      expect(await limiter.allowRequest(`user${String(i)}@example.test`)).toEqual(allowed);
    }
    // Another /64 of the same /48: the same budget, already used up.
    const { limiter } = limiterFor(store, { key: '2001:db8:1:ffff::/64' });
    expect(await limiter.allowRequest('late@example.test')).toEqual({ allowed: false });
    // Another /48 is another client.
    const other = limiterFor(store, { key: '2001:db8:2:1::/64' });
    expect(await other.limiter.allowRequest('late@example.test')).toEqual(allowed);
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
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.lockout',
        limit: LIMIT_BUCKETS.signInCodeCheckAccount,
      }),
    );
    const sixth = await limiter.checkCode('A@example.test');
    expect(sixth).toEqual({
      allowed: false,
      retryAfterSeconds: PLATFORM_AUTH_LIMITS.signInCode.checkAccountFailures.windowSeconds,
    });
    // Another address is not affected.
    expect((await limiter.checkCode('b@example.test')).allowed).toBe(true);
  });

  it('the pause outlasts the code: longer than the 10 minutes Auth keeps it', () => {
    expect(PLATFORM_AUTH_LIMITS.signInCode.checkAccountFailures.windowSeconds).toBeGreaterThan(
      10 * 60,
    );
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

  it('a check Auth could not answer ("released") costs no try', async () => {
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

  it('wrong codes from all clients together have a ceiling, with an alert line and nobody blamed', async () => {
    const store = fakeStore();
    const signInCode = { checkWrongAllClients: { max: 3, windowSeconds: 900 } };
    for (let i = 0; i < 3; i += 1) {
      const { limiter } = limiterFor(store, { key: `203.0.113.${String(i + 1)}` }, { signInCode });
      const gate = await limiter.checkCode(`user${String(i)}@example.test`);
      if (!gate.allowed) throw new Error('unreachable');
      await gate.attempt.failed();
    }
    const { limiter, log } = limiterFor(store, { key: '203.0.113.99' }, { signInCode });
    expect(await limiter.checkCode('late@example.test')).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
    const alert = log.mock.calls.find(
      ([e]) => (e as { event: string }).event === 'auth.sign_in_codes.global_limit',
    )?.[0] as Record<string, unknown>;
    expect(alert).toMatchObject({ limit: LIMIT_BUCKETS.signInCodeCheckAllClients });
    // No address, no client reference: the ceiling belongs to nobody.
    expect(alert).not.toHaveProperty('clientRef');
    expect(alert).not.toHaveProperty('subjectRef');
    // The refused visitor's own hits were given back: their address and client budgets are untouched.
    const givenBack = store.giveBack.mock.calls.map(([bucket]) => bucket);
    expect(givenBack).toContain(LIMIT_BUCKETS.signInCodeCheckAccount);
    expect(givenBack).toContain(LIMIT_BUCKETS.signInCodeCheckClient);
  });

  it('the alert also fires the moment the ceiling is reached, and right codes give their hit back', async () => {
    const store = fakeStore();
    const signInCode = { checkWrongAllClients: { max: 2, windowSeconds: 900 } };
    const { limiter, log } = limiterFor(store, undefined, { signInCode });
    const first = await limiter.checkCode('a@example.test');
    if (!first.allowed) throw new Error('unreachable');
    await first.attempt.succeeded();
    const second = await limiter.checkCode('b@example.test');
    if (!second.allowed) throw new Error('unreachable');
    await second.attempt.failed();
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.sign_in_codes.global_limit' }),
    );
    const third = await limiter.checkCode('c@example.test');
    if (!third.allowed) throw new Error('unreachable');
    await third.attempt.failed();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.sign_in_codes.global_limit' }),
    );
  });

  it("the typed address follows the organization's lock-out policy where it applies", async () => {
    const store = fakeStore();
    const accountBudget = vi.fn(() => Promise.resolve({ max: 3, windowSeconds: 600 }));
    const { limiter } = limiterFor(store, undefined, { accountBudget });
    const left: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const gate = await limiter.checkCode('a@example.test');
      if (!gate.allowed) throw new Error('unreachable');
      left.push(gate.attempt.triesIfWrong);
      await gate.attempt.failed();
    }
    expect(left).toEqual([2, 1, 0]);
    expect(accountBudget).toHaveBeenCalledWith('a@example.test');
    expect(await limiter.checkCode('a@example.test')).toEqual({
      allowed: false,
      retryAfterSeconds: 600,
    });
  });

  it('an IPv6 client is counted by its /48 for wrong codes too', async () => {
    const store = fakeStore();
    const max = PLATFORM_AUTH_LIMITS.signInCode.checkClientFailures.max;
    for (let i = 0; i < max; i += 1) {
      const { limiter } = limiterFor(store, { key: `2001:db8:1:${String(i + 1)}::/64` });
      const gate = await limiter.checkCode(`user${String(i)}@example.test`);
      if (!gate.allowed) throw new Error(`refused at ${String(i)}`);
      await gate.attempt.failed();
    }
    const { limiter } = limiterFor(store, { key: '2001:db8:1:ffff::/64' });
    expect((await limiter.checkCode('late@example.test')).allowed).toBe(false);
  });
});

describe("the Send Email hook's own limits (re-review M-A and L1)", () => {
  const USER = '9d406f51-7e80-4192-9dae-2f3a4b5c6d7e';
  const hookLimiter = (store: RateLimitStore) => {
    const log = vi.fn();
    return {
      log,
      limiter: createSendEmailHookLimiter({
        store,
        limits: PLATFORM_AUTH_LIMITS,
        log,
        action: 'platform.auth.send_email_hook',
      }),
    };
  };

  it('e-mails an account at most 10 codes in 15 minutes; the skip is logged without the account', async () => {
    const store = fakeStore();
    const { limiter, log } = hookLimiter(store);
    const max = PLATFORM_AUTH_LIMITS.signInCode.hookSendsPerAccount.max;
    expect(max).toBe(10);
    for (let i = 0; i < max; i += 1) expect(await limiter.allowSend(USER)).toBe(true);
    expect(await limiter.allowSend(USER)).toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.rate_limited',
        limit: LIMIT_BUCKETS.signInCodeHookSend,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(USER);
    // Another account is not affected.
    expect(await limiter.allowSend('11111111-2222-4333-8444-555555555555')).toBe(true);
  });

  it('and at most 40 a day', async () => {
    const store = fakeStore();
    const { limiter, log } = hookLimiter(store);
    const daily = PLATFORM_AUTH_LIMITS.signInCode.hookSendsPerAccountDaily;
    expect(daily).toEqual({ max: 40, windowSeconds: 86_400 });
    // The 15-minute window of the fake never rolls over: reset it between rounds like time would.
    let allowedCount = 0;
    for (let i = 0; i < 60; i += 1) {
      // Forget the short window's hits only (its bucket), as a new quarter of an hour does.
      for (const call of store.hit.mock.calls) {
        if (call[0] === LIMIT_BUCKETS.signInCodeHookSend) {
          await store.clear(call[0], call[1]);
        }
      }
      if (await limiter.allowSend(USER)) allowedCount += 1;
    }
    expect(allowedCount).toBe(40);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ limit: LIMIT_BUCKETS.signInCodeHookSendDaily }),
    );
  });

  it('acts on a webhook id once within the window; a failed call gives its id back', async () => {
    const store = fakeStore();
    const { limiter } = hookLimiter(store);
    expect(await limiter.claimWebhook('msg_1')).toBe(true);
    expect(await limiter.claimWebhook('msg_1')).toBe(false);
    expect(await limiter.claimWebhook('msg_2')).toBe(true);
    // A call that failed gives its id back, so Auth's retry of it is handled.
    await limiter.releaseWebhook('msg_2');
    expect(await limiter.claimWebhook('msg_2')).toBe(true);
    expect(PLATFORM_AUTH_LIMITS.signInCode.hookReplay).toEqual({ max: 1, windowSeconds: 300 });
  });

  it('fails closed when the limiter cannot answer; giving back never throws', async () => {
    const store = fakeStore();
    store.hit.mockRejectedValue(new Error('down'));
    const { limiter } = hookLimiter(store);
    await expect(limiter.allowSend(USER)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    await expect(limiter.claimWebhook('msg_1')).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    store.giveBack.mockRejectedValue(new Error('down'));
    await expect(limiter.releaseWebhook('msg_1')).resolves.toBeUndefined();
  });
});
