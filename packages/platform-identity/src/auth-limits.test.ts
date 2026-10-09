import { createHash } from 'node:crypto';
import type { RateLimit, RateLimitCounter, RateLimitStore } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_CLIENT_HEADER_ENV,
  AUTH_RATE_LIMIT_WINDOW_ENV,
  LIMIT_BUCKETS,
  NO_SIGN_IN_GUARD,
  PLATFORM_AUTH_LIMITS,
  RateLimiterUnavailableError,
  type SecurityEvent,
  accountSubject,
  authClientHeaders,
  clientSubject,
  createInvitationLimiter,
  createPasswordCheckLimiter,
  createPasswordResetLimiter,
  createSignInGuard,
  limitsFor,
  readAuthLimitWindowOverride,
  securityLogLine,
  unlockSignIn,
  userSubject,
} from './auth-limits';

vi.mock('server-only', () => ({}));

/**
 * An in-memory store with the database's semantics (private.rate_limit_hit/peek/clear, migration
 * 20261013090000): fixed windows; the hit that uses the budget up starts a full window; hits beyond are
 * refused and capped. References are derived from the subject like the database's (opaque here).
 */
function memoryStore(now: () => number = () => 0) {
  const rows = new Map<string, { hits: number; resetAt: number }>();
  const subjects: Buffer[] = [];
  const ref = (subject: Uint8Array) =>
    `rk_${createHash('sha256').update('k').update(subject).digest('hex').slice(0, 24)}`;
  const answer = (
    subject: Uint8Array,
    hits: number,
    resetAt: number,
    max: number,
  ): RateLimitCounter => ({
    allowed: hits <= max,
    remaining: Math.max(max - hits, 0),
    retryAfterSeconds: hits >= max ? Math.max(Math.ceil((resetAt - now()) / 1000), 1) : 0,
    ref: ref(subject),
  });
  const hit = vi.fn((bucket: string, subject: Uint8Array, limit: RateLimit) => {
    subjects.push(Buffer.from(subject));
    const key = `${bucket}|${Buffer.from(subject).toString('hex')}`;
    const row = rows.get(key);
    const windowEnd = now() + limit.windowSeconds * 1000;
    let next: { hits: number; resetAt: number };
    if (!row || row.resetAt <= now()) next = { hits: 1, resetAt: windowEnd };
    else
      next = {
        hits: Math.min(row.hits + 1, limit.max + 1),
        resetAt: row.hits + 1 === limit.max ? windowEnd : row.resetAt,
      };
    if (next.hits === limit.max && limit.max === 1) next.resetAt = windowEnd;
    rows.set(key, next);
    return Promise.resolve(answer(subject, next.hits, next.resetAt, limit.max));
  });
  const store: RateLimitStore = {
    hit,
    peek: vi.fn((bucket: string, subject: Uint8Array, max: number) => {
      const row = rows.get(`${bucket}|${Buffer.from(subject).toString('hex')}`);
      const live = row && row.resetAt > now() ? row : { hits: 0, resetAt: 0 };
      return Promise.resolve({
        ...answer(subject, live.hits, live.resetAt, max),
        allowed: live.hits < max,
      });
    }),
    clear: vi.fn((bucket: string, subject: Uint8Array) => {
      rows.delete(`${bucket}|${Buffer.from(subject).toString('hex')}`);
      return Promise.resolve();
    }),
  };
  return { store, hit, rows, subjects };
}

function failingStore(): RateLimitStore {
  const down = () => Promise.reject(new Error('connection refused for someone@example.test'));
  return { hit: vi.fn(down), peek: vi.fn(down), clear: vi.fn(down) };
}

const EMAIL = 'Someone@Example.test';
const CLIENT = { key: '203.0.113.7' };
const OTHER_CLIENT = { key: '198.51.100.9' };

function guardSetup(client: { key: string | null } = CLIENT, store?: RateLimitStore) {
  let time = 0;
  const memory = memoryStore(() => time);
  const events: SecurityEvent[] = [];
  const deps = {
    store: store ?? memory.store,
    limits: PLATFORM_AUTH_LIMITS,
    log: (event: SecurityEvent) => {
      events.push(event);
    },
  };
  return {
    deps,
    events,
    memory,
    guard: (c: { key: string | null } = client) =>
      createSignInGuard({ ...deps, client: c, action: 'platform.auth.sign_in' }),
    advance: (seconds: number) => {
      time += seconds * 1000;
    },
  };
}

describe('subjects (keys never leave the process readable)', () => {
  it('normalises the typed e-mail as Auth compares it', () => {
    expect(accountSubject(' Someone@Example.TEST ')).toEqual(
      accountSubject('someone@example.test'),
    );
    expect(accountSubject('someone@example.test')).not.toEqual(
      accountSubject('other@example.test'),
    );
  });

  it('are 32-byte SHA-256 values, separated by kind, never the key itself', () => {
    const subjects = [
      accountSubject('someone@example.test'),
      clientSubject({ key: 'someone@example.test' }),
      userSubject('someone@example.test'),
    ];
    for (const subject of subjects) {
      expect(subject).toHaveLength(32);
      expect(subject.toString('utf8')).not.toContain('example');
    }
    expect(new Set(subjects.map((s) => s.toString('hex'))).size).toBe(3);
    expect(accountSubject('a@b.co')).not.toEqual(createHash('sha256').update('a@b.co').digest());
    // Clients without a trusted address share one key.
    expect(clientSubject({ key: null })).toEqual(clientSubject({ key: null }));
  });
});

describe('limitsFor (platform defaults; per-organization policy joins here with T-M2-10)', () => {
  it('uses the security settings screen defaults for sign-in: 5 failures, 15 minutes', () => {
    const limits = limitsFor({}, {});
    expect(limits).toBe(PLATFORM_AUTH_LIMITS);
    expect(limits.signIn.accountFailures).toEqual({ max: 5, windowSeconds: 900 });
    expect(limitsFor({ tenantId: '22222222-2222-4222-8222-222222222222' }, {})).toBe(
      PLATFORM_AUTH_LIMITS,
    );
  });

  it('keeps the T-M2-08 reset limits', () => {
    expect(PLATFORM_AUTH_LIMITS.passwordReset).toMatchObject({
      requestsPerClient: { max: 10 },
      requestsPerAccount: { max: 3 },
      completionsPerClient: { max: 5 },
      sharedClientRequests: { max: 100 },
    });
  });

  it('shortens every window for tests only (AUTH_RATE_LIMIT_WINDOW_SECONDS), keeping the counts', () => {
    const limits = limitsFor({}, { [AUTH_RATE_LIMIT_WINDOW_ENV]: '20' });
    for (const group of Object.values(limits)) {
      for (const limit of Object.values(group as Record<string, RateLimit>)) {
        expect(limit.windowSeconds).toBe(20);
      }
    }
    expect(limits.signIn.accountFailures.max).toBe(5);
  });

  it('refuses any other value of the test setting (a configuration error)', () => {
    expect(readAuthLimitWindowOverride({})).toBeNull();
    expect(readAuthLimitWindowOverride({ [AUTH_RATE_LIMIT_WINDOW_ENV]: ' ' })).toBeNull();
    expect(readAuthLimitWindowOverride({ [AUTH_RATE_LIMIT_WINDOW_ENV]: '3600' })).toBe(3600);
    for (const value of ['0', '3601', '-5', '1.5', 'soon', '1e3']) {
      expect(() => readAuthLimitWindowOverride({ [AUTH_RATE_LIMIT_WINDOW_ENV]: value })).toThrow(
        AUTH_RATE_LIMIT_WINDOW_ENV,
      );
    }
  });
});

describe('createSignInGuard (FR-IAM-13 lockout, TM-0003 T-IAM-01/03)', () => {
  it('locks the typed e-mail after 5 failures from any client, for a full window', async () => {
    const { guard, advance } = guardSetup();
    for (let i = 0; i < 5; i += 1) {
      expect(await guard().check(EMAIL)).toEqual({ allowed: true });
      await guard(i % 2 === 0 ? CLIENT : OTHER_CLIENT).failed(EMAIL);
    }
    const refused = await guard({ key: '192.0.2.44' }).check('someone@example.test');
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 900 });
    advance(899);
    expect((await guard().check(EMAIL)).allowed).toBe(false);
    advance(1);
    expect(await guard().check(EMAIL)).toEqual({ allowed: true });
  });

  it('treats an unknown account exactly like an existing one (counters per typed e-mail)', async () => {
    const { guard } = guardSetup();
    const answers: unknown[] = [];
    for (const email of ['exists@example.test', 'nobody@example.test']) {
      const g = guard({ key: email === 'exists@example.test' ? '203.0.113.1' : '203.0.113.2' });
      for (let i = 0; i < 5; i += 1) await g.failed(email);
      answers.push(await g.check(email));
    }
    expect(answers[0]).toEqual(answers[1]);
  });

  it('ends the run of failures after a success (consecutive failures, screen 6)', async () => {
    const { guard } = guardSetup();
    for (let i = 0; i < 4; i += 1) await guard().failed(EMAIL);
    await guard().succeeded(EMAIL);
    for (let i = 0; i < 4; i += 1) await guard().failed(EMAIL);
    expect(await guard().check(EMAIL)).toEqual({ allowed: true });
  });

  it('limits failures per client across accounts (password spraying), not other clients', async () => {
    const { guard } = guardSetup();
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.signIn.clientFailures.max; i += 1) {
      await guard().failed(`user${String(i)}@example.test`);
    }
    expect((await guard().check('fresh@example.test')).allowed).toBe(false);
    expect((await guard(OTHER_CLIENT).check('fresh@example.test')).allowed).toBe(true);
  });

  it("limits every attempt per client (Auth's shared budget), with larger budgets for the shared key", async () => {
    const { guard } = guardSetup();
    const max = PLATFORM_AUTH_LIMITS.signIn.clientAttempts.max;
    for (let i = 0; i < max; i += 1) expect((await guard().check(EMAIL)).allowed).toBe(true);
    expect((await guard().check(EMAIL)).allowed).toBe(false);
    // No trusted address: one shared key with its own (larger) budget.
    const shared = guardSetup({ key: null });
    for (let i = 0; i < max + 1; i += 1) await shared.guard().check(EMAIL);
    expect((await shared.guard().check(EMAIL)).allowed).toBe(true);
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.signIn.clientFailures.max + 1; i += 1) {
      await shared.guard().failed(`u${String(i)}@example.test`);
    }
    expect((await shared.guard().check('fresh@example.test')).allowed).toBe(true);
  });

  it('records security events with codes and keyed references only', async () => {
    const { guard, events } = guardSetup();
    for (let i = 0; i < 5; i += 1) await guard().failed(EMAIL);
    await guard().check(EMAIL);
    expect(events.map((e) => e.event)).toEqual([
      'auth.sign_in.failed',
      'auth.sign_in.failed',
      'auth.sign_in.failed',
      'auth.sign_in.failed',
      'auth.sign_in.failed',
      'auth.lockout',
      'auth.rate_limited',
    ]);
    expect(events[5]).toMatchObject({
      reason: 'sign_in.account_failures',
      limit: 'sign_in.account_failures',
      retryAfterS: 900,
    });
    expect(events[6]).toMatchObject({ reason: 'sign_in.account_failures', retryAfterS: 900 });
    for (const event of events) {
      expect(event.subjectRef).toMatch(/^rk_[0-9a-f]{24}$/);
      expect(event.clientRef).toMatch(/^rk_[0-9a-f]{24}$/);
    }
    // One account, one reference across events; nothing readable anywhere.
    expect(new Set(events.map((e) => e.subjectRef)).size).toBe(1);
    const logged = JSON.stringify(events).toLowerCase();
    expect(logged).not.toContain('someone');
    expect(logged).not.toContain('203.0.113');
  });

  it('fails closed when the limiter cannot answer: check throws, nothing is decided', async () => {
    const { guard, events } = guardSetup(CLIENT, failingStore());
    await expect(guard().check(EMAIL)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    expect(events).toEqual([
      {
        event: 'auth.limiter.unavailable',
        action: 'platform.auth.sign_in',
        reason: 'fail_closed',
        errorName: 'Error',
      },
    ]);
  });

  it('never throws after Auth answered: an uncounted failure or uncleared run is logged', async () => {
    const { guard, events } = guardSetup(CLIENT, failingStore());
    await expect(guard().failed(EMAIL)).resolves.toBeUndefined();
    await expect(guard().succeeded(EMAIL)).resolves.toBeUndefined();
    expect(events.map((e) => [e.event, e.reason])).toEqual([
      ['auth.limiter.unavailable', 'failure_not_counted'],
      ['auth.limiter.unavailable', 'failures_not_cleared'],
    ]);
    expect(JSON.stringify(events)).not.toContain('example.test');
  });

  it('NO_SIGN_IN_GUARD refuses any check (a sign-in path without a client fails closed)', async () => {
    await expect(NO_SIGN_IN_GUARD.check(EMAIL)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    await expect(NO_SIGN_IN_GUARD.failed(EMAIL)).resolves.toBeUndefined();
    await expect(NO_SIGN_IN_GUARD.succeeded(EMAIL)).resolves.toBeUndefined();
  });

  it('a completed password reset unlocks the account (TM-0003 T-IAM-32)', async () => {
    const { deps, guard } = guardSetup();
    for (let i = 0; i < 5; i += 1) await guard().failed(EMAIL);
    expect((await guard().check(EMAIL)).allowed).toBe(false);
    await unlockSignIn(deps, 'platform.auth.password_reset', 'someone@example.TEST');
    expect((await guard().check(EMAIL)).allowed).toBe(true);
  });

  it('unlockSignIn never throws (logged)', async () => {
    const events: SecurityEvent[] = [];
    await unlockSignIn(
      { store: failingStore(), limits: PLATFORM_AUTH_LIMITS, log: (e) => events.push(e) },
      'platform.auth.password_reset',
      EMAIL,
    );
    expect(events[0]).toMatchObject({
      event: 'auth.limiter.unavailable',
      reason: 'lock_not_cleared',
    });
  });
});

describe('createPasswordCheckLimiter (My profile, T-M2-15a security review)', () => {
  it('allows 5 current-password checks per user per window, then refuses with an event', async () => {
    const { store, hit } = memoryStore();
    const events: SecurityEvent[] = [];
    const allow = createPasswordCheckLimiter({
      store,
      limits: PLATFORM_AUTH_LIMITS,
      log: (e) => events.push(e),
      action: 'platform.auth.change_password',
    });
    const USER = '11111111-1111-4111-8111-111111111111';
    for (let i = 0; i < 5; i += 1) expect(await allow(USER)).toBe(true);
    expect(await allow(USER)).toBe(false);
    expect(await allow('22222222-2222-4222-8222-222222222222')).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({
        event: 'auth.rate_limited',
        reason: 'password_check.user',
        entityType: 'auth_user',
        entityId: USER,
      }),
    ]);
    expect(hit).toHaveBeenCalledWith(LIMIT_BUCKETS.passwordCheckUser, userSubject(USER), {
      max: 5,
      windowSeconds: 900,
    });
  });

  it('fails closed', async () => {
    const allow = createPasswordCheckLimiter({
      store: failingStore(),
      limits: PLATFORM_AUTH_LIMITS,
      log: () => undefined,
      action: 'platform.auth.change_password',
    });
    await expect(allow('11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });
});

describe('createPasswordResetLimiter (T-M2-08 limits on the shared limiter)', () => {
  const setup = (client: { key: string | null } = CLIENT, store?: RateLimitStore) => {
    const memory = memoryStore();
    const events: SecurityEvent[] = [];
    const limiter = createPasswordResetLimiter({
      store: store ?? memory.store,
      limits: PLATFORM_AUTH_LIMITS,
      log: (e) => events.push(e),
      client,
      requestAction: 'platform.auth.request_password_reset',
      completeAction: 'platform.auth.password_reset',
    });
    return { limiter, events, memory };
  };

  it('limits requests per account across clients (3), whatever the spelling', async () => {
    const { memory, events } = setup();
    const at = (key: string) =>
      createPasswordResetLimiter({
        store: memory.store,
        limits: PLATFORM_AUTH_LIMITS,
        log: (e) => events.push(e),
        client: { key },
        requestAction: 'r',
        completeAction: 'c',
      });
    for (let i = 0; i < 3; i += 1) {
      expect(await at(`198.51.100.${String(i)}`).allowRequest(' Target@Example.test ')).toBe(true);
    }
    expect(await at('198.51.100.99').allowRequest('target@example.test')).toBe(false);
    expect(await at('198.51.100.99').allowRequest('other@example.test')).toBe(true);
    expect(events.at(0)).toMatchObject({ reason: 'password_reset.request_account' });
  });

  it('limits requests per client (10) and counts the account only for an allowed client', async () => {
    const { limiter, memory } = setup();
    for (let i = 0; i < 10; i += 1) {
      expect(await limiter.allowRequest(`warm-up${String(i)}@example.test`)).toBe(true);
    }
    for (let i = 0; i < 20; i += 1)
      expect(await limiter.allowRequest('victim@example.test')).toBe(false);
    // The refused client's attempts against the victim counted nowhere: another client still may.
    const other = createPasswordResetLimiter({
      store: memory.store,
      limits: PLATFORM_AUTH_LIMITS,
      log: () => undefined,
      client: OTHER_CLIENT,
      requestAction: 'r',
      completeAction: 'c',
    });
    expect(await other.allowRequest('victim@example.test')).toBe(true);
  });

  it('limits new-password submissions per client (5); shared key 100', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i += 1) expect(await limiter.allowCompletion()).toBe(true);
    expect(await limiter.allowCompletion()).toBe(false);
    const shared = setup({ key: null }).limiter;
    for (let i = 0; i < 100; i += 1) expect(await shared.allowCompletion()).toBe(true);
    expect(await shared.allowCompletion()).toBe(false);
  });

  it('fails closed (the caller decides: same answer for requests, generic error for completions)', async () => {
    const { limiter, events } = setup(CLIENT, failingStore());
    await expect(limiter.allowRequest(EMAIL)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    await expect(limiter.allowCompletion()).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    expect(events.map((e) => e.reason)).toEqual(['fail_closed', 'fail_closed']);
  });
});

describe('createInvitationLimiter', () => {
  const setup = (store?: RateLimitStore) => {
    const memory = memoryStore();
    const events: SecurityEvent[] = [];
    const limiter = createInvitationLimiter({
      store: store ?? memory.store,
      limits: PLATFORM_AUTH_LIMITS,
      log: (e) => events.push(e),
      client: CLIENT,
      lookupAction: 'platform.invitation.lookup',
      signUpAction: 'platform.invitation.accept',
    });
    return { limiter, events };
  };

  it('limits link lookups (60) and new-account sign-ups (10) per client', async () => {
    const { limiter, events } = setup();
    for (let i = 0; i < 60; i += 1) expect(await limiter.allowLookup()).toBe(true);
    expect(await limiter.allowLookup()).toBe(false);
    for (let i = 0; i < 10; i += 1) expect(await limiter.allowSignUp()).toBe(true);
    expect(await limiter.allowSignUp()).toBe(false);
    expect(events.map((e) => e.reason)).toEqual([
      'invitation.lookup_client',
      'invitation.sign_up_client',
    ]);
  });

  it('lookups fail open (no credential is checked), sign-ups fail closed', async () => {
    const { limiter, events } = setup(failingStore());
    expect(await limiter.allowLookup()).toBe(true);
    await expect(limiter.allowSignUp()).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    expect(events.map((e) => [e.event, e.reason])).toEqual([
      ['auth.limiter.unavailable', 'fail_open'],
      ['auth.limiter.unavailable', 'fail_closed'],
    ]);
  });
});

describe('securityLogLine (ADR 0009 §2)', () => {
  it('writes the closed logger fields; the limiter failing is an error, the rest warnings', () => {
    expect(
      securityLogLine({
        event: 'auth.sign_in.failed',
        action: 'platform.auth.sign_in',
        reason: 'invalid_credentials',
        subjectRef: 'rk_aa',
        clientRef: 'rk_bb',
      }),
    ).toEqual({
      level: 'warn',
      message: 'sign-in refused',
      fields: {
        action: 'platform.auth.sign_in',
        securityEvent: 'auth.sign_in.failed',
        reason: 'invalid_credentials',
        outcome: 'denied',
        subjectRef: 'rk_aa',
        clientRef: 'rk_bb',
      },
    });
    expect(
      securityLogLine({
        event: 'auth.limiter.unavailable',
        action: 'platform.auth.sign_in',
        reason: 'fail_closed',
        errorName: 'Error',
      }),
    ).toMatchObject({ level: 'error', fields: { outcome: 'failure', errorName: 'Error' } });
  });
});

describe("authClientHeaders (self-hosted: the visitor's key for Auth's own limits)", () => {
  it('sends the trusted key under the configured header only', () => {
    const env = { [AUTH_CLIENT_HEADER_ENV]: 'X-Jadarat-Client' };
    expect(authClientHeaders({ key: '2001:db8:1:2::/64' }, env)).toEqual({
      'X-Jadarat-Client': '2001:db8:1:2::/64',
    });
    // No trusted address: nothing is sent (the gateway then leaves Auth's per-IP limit off for the app).
    expect(authClientHeaders({ key: null }, env)).toBeNull();
    // Hosted (unset): the visitor's address never reaches Auth.
    expect(authClientHeaders({ key: '203.0.113.7' }, {})).toBeNull();
    expect(authClientHeaders({ key: '203.0.113.7' }, { [AUTH_CLIENT_HEADER_ENV]: ' ' })).toBeNull();
  });

  it('refuses anything but a header name (a configuration error)', () => {
    for (const value of ['X Jadarat', 'X-Jadarat:1', '1-header', 'x'.repeat(65)]) {
      expect(() =>
        authClientHeaders({ key: '203.0.113.7' }, { [AUTH_CLIENT_HEADER_ENV]: value }),
      ).toThrow(AUTH_CLIENT_HEADER_ENV);
    }
  });
});
