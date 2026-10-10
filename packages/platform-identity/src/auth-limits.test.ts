import { createHash } from 'node:crypto';
import type {
  DeviceTrust,
  RateLimit,
  RateLimitCounter,
  RateLimitStore,
  RememberDevice,
  SignInBudgets,
  SignInCheck,
  SignInSubjects,
} from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { type AuthFlowDeps, startPasswordSession } from './auth-flow';
import {
  AUTH_CLIENT_HEADER_ENV,
  AUTH_RATE_LIMIT_WINDOW_ENV,
  AUTH_RATE_LIMIT_WINDOW_SMOKE_ENV,
  DEVICE_TOKEN_PATTERN,
  LIMIT_BUCKETS,
  NO_SIGN_IN_GUARD,
  PLATFORM_AUTH_LIMITS,
  RateLimiterUnavailableError,
  type SecurityEvent,
  type SignInGate,
  type TrustedDeviceCookie,
  accountSubject,
  authClientHeaders,
  clientSubject,
  createCodeAttemptLimiter,
  createInvitationLimiter,
  createPasswordCheckLimiter,
  createPasswordResetLimiter,
  createSignInGuard,
  deviceSubject,
  forgetOtherTrustedBrowsers,
  limitsFor,
  organizationAccountLockout,
  readAuthLimitWindowOverride,
  resetAccountSignIn,
  securityLogLine,
  signInBudgets,
  userSubject,
  withCodeAttemptLimit,
} from './auth-limits';
import { appError, err, ok } from '@jadarat/platform-core';

vi.mock('server-only', () => ({}));

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/**
 * An in-memory store with the database's semantics (migration 20261013090000): fixed windows; with `lock`
 * the hit that uses the budget up starts a full window; hits beyond are refused and capped; the sign-in
 * check counts the client's attempt, then provisional failures of the client and of the account — or of a
 * browser the account trusts — and gives the client's failure back when the account refuses; a success
 * gives it back too and ends the run, and — only when remembered — trusts the browser under its presented
 * token if known (for any account), else the fresh one; Auth's 429 gives the account's (or browser's)
 * failure back; a reset ends the lock, trusts its browser and forgets the others. References are derived
 * from the subject like the database's (opaque here).
 */
function memoryStore(now: () => number = () => 0) {
  const rows = new Map<string, { hits: number; resetAt: number }>();
  const trusted = new Map<string, number>();
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
  const count = (key: string, limit: RateLimit, lock: boolean) => {
    const row = rows.get(key);
    const windowEnd = now() + limit.windowSeconds * 1000;
    const next =
      !row || row.resetAt <= now()
        ? { hits: 1, resetAt: windowEnd }
        : {
            hits: Math.min(row.hits + 1, limit.max + 1),
            resetAt: lock && row.hits + 1 === limit.max ? windowEnd : row.resetAt,
          };
    rows.set(key, next);
    return next;
  };
  const refund = (key: string) => {
    const row = rows.get(key);
    if (row && row.hits > 1 && row.resetAt > now()) row.hits -= 1;
    else if (row && row.hits <= 1) rows.delete(key);
  };
  const hit = vi.fn((bucket: string, subject: Uint8Array, limit: RateLimit) => {
    subjects.push(Buffer.from(subject));
    const next = count(`${bucket}|${hex(subject)}`, limit, true);
    return Promise.resolve(answer(subject, next.hits, next.resetAt, limit.max));
  });
  const signInCheck = vi.fn((s: SignInSubjects, budgets: SignInBudgets): Promise<SignInCheck> => {
    for (const subject of [s.client, s.account, s.device])
      if (subject) subjects.push(Buffer.from(subject));
    const client = hex(s.client);
    const account = hex(s.account);
    const B = LIMIT_BUCKETS;
    let refusedBy: SignInCheck['refusedBy'] = null;
    let resetAt = 0;
    let failures: number | null = null;
    let accountHits: number | null = null;
    let max = budgets.accountFailures.max;
    let isTrusted = false;
    const attempts = count(`${B.signInClientAttempts}|${client}`, budgets.clientAttempts, false);
    if (attempts.hits > budgets.clientAttempts.max) {
      refusedBy = 'sign_in.client_attempts';
      resetAt = attempts.resetAt;
    } else {
      const f = count(`${B.signInClientFailures}|${client}`, budgets.clientFailures, false);
      failures = f.hits;
      if (f.hits > budgets.clientFailures.max) {
        refusedBy = 'sign_in.client_failures';
        resetAt = f.resetAt;
      } else {
        isTrusted = s.device !== null && (trusted.get(`${account}|${hex(s.device)}`) ?? 0) > now();
        const a =
          isTrusted && s.device
            ? count(
                `${B.signInDeviceFailures}|${account}${hex(s.device)}`,
                budgets.deviceFailures,
                true,
              )
            : count(`${B.signInAccountFailures}|${account}`, budgets.accountFailures, true);
        max = isTrusted ? budgets.deviceFailures.max : budgets.accountFailures.max;
        accountHits = a.hits;
        if (a.hits > max) {
          refusedBy = isTrusted ? 'sign_in.device_failures' : 'sign_in.account_failures';
          resetAt = a.resetAt;
          refund(`${B.signInClientFailures}|${client}`);
          failures -= 1;
        }
      }
    }
    return Promise.resolve({
      allowed: refusedBy === null,
      refusedBy,
      retryAfterSeconds: refusedBy === null ? 0 : Math.max(Math.ceil((resetAt - now()) / 1000), 1),
      remaining: accountHits === null ? 0 : Math.max(max - accountHits, 0),
      clientRemaining: failures === null ? 0 : Math.max(budgets.clientFailures.max - failures, 0),
      trusted: isTrusted,
      subjectRef: ref(s.account),
      clientRef: ref(s.client),
    });
  });
  const DAY = 86_400_000;
  /** The token the database trusts: the presented one when known (any account, unexpired), else the fresh. */
  const choose = (device: Uint8Array | null) =>
    device !== null &&
    [...trusted].some(([key, until]) => key.endsWith(`|${hex(device)}`) && until > now())
      ? ('presented' as const)
      : ('fresh' as const);
  const trust = (account: string, device: Uint8Array, days: number) => {
    const until = now() + days * DAY;
    trusted.set(`${account}|${hex(device)}`, until);
    return until;
  };
  const signInSucceeded = vi.fn(
    (s: SignInSubjects, wasTrusted: boolean, remember: RememberDevice | null) => {
      const account = hex(s.account);
      refund(`${LIMIT_BUCKETS.signInClientFailures}|${hex(s.client)}`);
      if (wasTrusted && s.device)
        rows.delete(`${LIMIT_BUCKETS.signInDeviceFailures}|${account}${hex(s.device)}`);
      else rows.delete(`${LIMIT_BUCKETS.signInAccountFailures}|${account}`);
      if (remember === null) return Promise.resolve(null);
      const device = choose(s.device);
      const until = trust(
        account,
        device === 'presented' && s.device ? s.device : remember.freshDevice,
        remember.trustDays,
      );
      return Promise.resolve<DeviceTrust>({ device, until: new Date(until) });
    },
  );
  const signInNotChecked = vi.fn((s: SignInSubjects, wasTrusted: boolean) => {
    const account = hex(s.account);
    if (wasTrusted && s.device)
      refund(`${LIMIT_BUCKETS.signInDeviceFailures}|${account}${hex(s.device)}`);
    else refund(`${LIMIT_BUCKETS.signInAccountFailures}|${account}`);
    return Promise.resolve();
  });
  const forget = (account: string, keep: string | null) => {
    let revoked = 0;
    for (const key of [...trusted.keys()]) {
      if (key.startsWith(`${account}|`) && key !== `${account}|${keep ?? ''}`) {
        trusted.delete(key);
        revoked += 1;
      }
    }
    return revoked;
  };
  const signInReset = vi.fn(
    (accountSubject: Uint8Array, device: Uint8Array | null, remember: RememberDevice) => {
      const account = hex(accountSubject);
      rows.delete(`${LIMIT_BUCKETS.signInAccountFailures}|${account}`);
      const chosen = choose(device);
      const kept = chosen === 'presented' && device ? device : remember.freshDevice;
      rows.delete(`${LIMIT_BUCKETS.signInDeviceFailures}|${account}${hex(kept)}`);
      const revoked = forget(account, hex(kept));
      const until = trust(account, kept, remember.trustDays);
      return Promise.resolve({ revoked, device: chosen, until: new Date(until) });
    },
  );
  const forgetOtherDevices = vi.fn((accountSubject: Uint8Array, device: Uint8Array | null) =>
    Promise.resolve(forget(hex(accountSubject), device === null ? null : hex(device))),
  );
  const store: RateLimitStore = {
    hit,
    clear: vi.fn((bucket: string, subject: Uint8Array) => {
      rows.delete(`${bucket}|${hex(subject)}`);
      return Promise.resolve();
    }),
    giveBack: vi.fn((bucket: string, subject: Uint8Array) => {
      refund(`${bucket}|${hex(subject)}`);
      return Promise.resolve();
    }),
    signInCheck,
    signInSucceeded,
    signInNotChecked,
    signInReset,
    forgetOtherDevices,
  };
  return {
    store,
    hit,
    signInCheck,
    signInSucceeded,
    signInNotChecked,
    signInReset,
    forgetOtherDevices,
    rows,
    trusted,
    subjects,
  };
}

function failingStore(): RateLimitStore {
  const down = () => Promise.reject(new Error('connection refused for someone@example.test'));
  return {
    hit: vi.fn(down),
    clear: vi.fn(down),
    giveBack: vi.fn(down),
    signInCheck: vi.fn(down),
    signInSucceeded: vi.fn(down),
    signInNotChecked: vi.fn(down),
    signInReset: vi.fn(down),
    forgetOtherDevices: vi.fn(down),
  };
}

/** A browser's cookie jar for the trusted-device cookie. */
function browser(token: string | null = null) {
  const jar = { token, maxAge: 0 };
  const cookie: TrustedDeviceCookie = {
    read: () => jar.token,
    write: (value, maxAgeSeconds) => {
      jar.token = value;
      jar.maxAge = maxAgeSeconds;
    },
  };
  return { jar, cookie };
}

const EMAIL = 'Someone@Example.test';
const CLIENT = { key: '203.0.113.7' };
const OTHER_CLIENT = { key: '198.51.100.9' };

function guardSetup(client: { key: string | null } = CLIENT, store?: RateLimitStore) {
  let time = 0;
  const memory = memoryStore(() => time);
  const events: SecurityEvent[] = [];
  const lockMails: { email: string; minutes: number }[] = [];
  const deps = {
    store: store ?? memory.store,
    limits: PLATFORM_AUTH_LIMITS,
    log: (event: SecurityEvent) => {
      events.push(event);
    },
  };
  const unknownBrowser = browser();
  return {
    deps,
    events,
    memory,
    lockMails,
    guard: (c: { key: string | null } = client, device = unknownBrowser.cookie) =>
      createSignInGuard({
        ...deps,
        client: c,
        action: 'platform.auth.sign_in',
        device,
        requestLockedMail: (email, minutes) => {
          lockMails.push({ email, minutes });
          return Promise.resolve();
        },
      }),
    advance: (seconds: number) => {
      time += seconds * 1000;
    },
  };
}

/**
 * Checks, then reports Auth's verdict the way startPasswordSession does: wrong password, right password
 * (unticked), right password with «تذكّر هذا المتصفح» ticked, or Auth's own 429.
 */
async function attempt(
  gate: Promise<SignInGate>,
  verdict: 'wrong' | 'right' | 'remember' | 'auth_429',
): Promise<SignInGate> {
  const answer = await gate;
  if (answer.allowed) {
    if (verdict === 'wrong') await answer.attempt.failed();
    else if (verdict === 'auth_429') await answer.attempt.notChecked();
    else await answer.attempt.succeeded({ remember: verdict === 'remember' });
  }
  return answer;
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

  it('matches the database derivation of an Auth address (shared vector, supabase/tests/72)', () => {
    expect(accountSubject(' UAB@ab.test ').toString('hex')).toBe(
      '9bab03365a6941124a7dbf7a28cc5eecec8ca5be63308d0317659ce517831db4',
    );
  });

  it('lower-cases İ and Σ as GoTrue does (Go simple case mapping), and the Kelvin sign as K', () => {
    // JavaScript alone gives i + U+0307 for İ: a different subject for the same Auth account.
    expect('\u0130'.toLowerCase()).not.toBe('i');
    expect(accountSubject('ADM\u0130N@x.test')).toEqual(accountSubject('admin@x.test'));
    expect(accountSubject('\u212Aate@x.test')).toEqual(accountSubject('kate@x.test'));
  });

  it('guard: every address that is not printable ASCII shares ONE subject (security review T-M2-11)', () => {
    const shared = accountSubject('\u0131@x.test'); // dotless ı: Go does not map it to i either
    // The same vector as supabase/tests/72 (private.rate_limit_account_subject).
    expect(shared.toString('hex')).toBe(
      '4644ee3cbaf840b60dad525e47034dcf9c671f09a383121efc87556f94acf4cc',
    );
    for (const address of ['\u03A3@x.test', 'sa\u0301ra@x.test', '\u0661@x.test', 'a\tb@x.test']) {
      expect(accountSubject(address), JSON.stringify(address)).toEqual(shared);
    }
    // No spelling of a real (ASCII) account falls into it, nor does the shared one become a real one.
    expect(accountSubject('i@x.test')).not.toEqual(shared);
    expect(accountSubject('non-ascii')).not.toEqual(shared);
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
  it('uses the PO decisions of 9 Oct 2026: account 5 / 15 min, trusted browser 10, client 100 failures', () => {
    const limits = limitsFor({}, {});
    expect(limits).toBe(PLATFORM_AUTH_LIMITS);
    expect(limits.signIn).toEqual({
      accountFailures: { max: 5, windowSeconds: 900 },
      deviceFailures: { max: 10, windowSeconds: 900 },
      clientFailures: { max: 100, windowSeconds: 900 },
      clientAttempts: { max: 1000, windowSeconds: 900 },
      sharedClientFailures: { max: 1000, windowSeconds: 900 },
      sharedClientAttempts: { max: 10_000, windowSeconds: 900 },
    });
    expect(limits.trustedDevice).toEqual({ days: 30 });
    // The lockout e-mail (security review M3): one per person a day, a ceiling per organization an hour.
    expect(limits.lockoutMail).toEqual({ personQuietHours: 24, tenantPerHour: 50 });
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

  it('shortens every window for the smoke test only, keeping the counts and the trust period', () => {
    const limits = limitsFor({}, { [AUTH_RATE_LIMIT_WINDOW_ENV]: '20' });
    for (const group of [
      limits.signIn,
      limits.passwordCheck,
      limits.passwordReset,
      limits.invitation,
    ]) {
      for (const limit of Object.values(group as Record<string, RateLimit>)) {
        expect(limit.windowSeconds).toBe(20);
      }
    }
    expect(limits.signIn.accountFailures.max).toBe(5);
    expect(limits.trustedDevice.days).toBe(30);
    expect(limits.lockoutMail).toBe(PLATFORM_AUTH_LIMITS.lockoutMail);
  });

  it('refuses any other value of the setting, and refuses it in production (review LOW 6)', () => {
    expect(readAuthLimitWindowOverride({})).toBeNull();
    expect(readAuthLimitWindowOverride({ [AUTH_RATE_LIMIT_WINDOW_ENV]: ' ' })).toBeNull();
    expect(readAuthLimitWindowOverride({ [AUTH_RATE_LIMIT_WINDOW_ENV]: '3600' })).toBe(3600);
    for (const value of ['0', '3601', '-5', '1.5', 'soon', '1e3']) {
      expect(() => readAuthLimitWindowOverride({ [AUTH_RATE_LIMIT_WINDOW_ENV]: value })).toThrow(
        AUTH_RATE_LIMIT_WINDOW_ENV,
      );
    }
    const set = { [AUTH_RATE_LIMIT_WINDOW_ENV]: '40' };
    expect(() => readAuthLimitWindowOverride({ ...set, NODE_ENV: 'production' })).toThrow(
      'refused in production',
    );
    // The smoke test's own compose file (compose.smoke.yaml) says so explicitly.
    expect(
      readAuthLimitWindowOverride({
        ...set,
        NODE_ENV: 'production',
        [AUTH_RATE_LIMIT_WINDOW_SMOKE_ENV]: '1',
      }),
    ).toBe(40);
    // A Vercel production deployment never.
    expect(() =>
      readAuthLimitWindowOverride({
        ...set,
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        [AUTH_RATE_LIMIT_WINDOW_SMOKE_ENV]: '1',
      }),
    ).toThrow('production deployment');
  });

  it('signInBudgets: the client budgets of the client (shared without a trusted address) — the office-range integration point', () => {
    const limits = PLATFORM_AUTH_LIMITS.signIn;
    expect(signInBudgets(limits, CLIENT)).toEqual({
      clientAttempts: limits.clientAttempts,
      clientFailures: limits.clientFailures,
      accountFailures: limits.accountFailures,
      deviceFailures: limits.deviceFailures,
    });
    expect(signInBudgets(limits, { key: null })).toMatchObject({
      clientAttempts: limits.sharedClientAttempts,
      clientFailures: limits.sharedClientFailures,
    });
  });
});

describe('createSignInGuard (FR-IAM-13 lockout, TM-0003 T-IAM-01/03; PO decisions 9 Oct 2026)', () => {
  it('counts BEFORE Auth: the 5th wrong attempt still reaches Auth, the 6th is refused, for a full window', async () => {
    const { guard, advance } = guardSetup();
    for (let i = 0; i < 5; i += 1) {
      const gate = await attempt(guard(i % 2 === 0 ? CLIENT : OTHER_CLIENT).check(EMAIL), 'wrong');
      expect(gate.allowed).toBe(true);
    }
    const refused = await guard({ key: '192.0.2.44' }).check('someone@example.test');
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 900 });
    advance(899);
    expect((await guard().check(EMAIL)).allowed).toBe(false);
    advance(1);
    expect((await guard().check(EMAIL)).allowed).toBe(true);
  });

  it('N parallel attempts on one account: at most 5 reach Auth (security review HIGH 1)', async () => {
    const { guard } = guardSetup();
    let authCalls = 0;
    const deps = {
      supabase: {
        auth: {
          signInWithPassword: () => {
            authCalls += 1;
            return Promise.resolve({ data: { session: null }, error: { status: 400 } });
          },
        },
      },
      signInGuard: guard(),
      now: () => 0,
      sleep: () => Promise.resolve(),
      logWarning: () => undefined,
    } as unknown as AuthFlowDeps;
    const answers = await Promise.all(
      Array.from({ length: 30 }, () =>
        startPasswordSession(deps, { email: EMAIL, password: 'wrong horse battery' }),
      ),
    );
    expect(authCalls).toBe(5);
    expect(
      answers.filter((a) => !a.ok && a.error.code === 'AUTH_INVALID_CREDENTIALS'),
    ).toHaveLength(5);
    expect(answers.filter((a) => !a.ok && a.error.code === 'AUTH_TOO_MANY_ATTEMPTS')).toHaveLength(
      25,
    );
  });

  it('treats an unknown account exactly like an existing one (counters per typed e-mail)', async () => {
    const { guard } = guardSetup();
    const answers: unknown[] = [];
    for (const email of ['exists@example.test', 'nobody@example.test']) {
      const g = guard({ key: email === 'exists@example.test' ? '203.0.113.1' : '203.0.113.2' });
      for (let i = 0; i < 5; i += 1) await attempt(g.check(email), 'wrong');
      answers.push(await g.check(email));
    }
    expect(answers[0]).toEqual(answers[1]);
  });

  it('ends the run of failures after a success (consecutive failures, screen 6)', async () => {
    const { guard } = guardSetup();
    for (let i = 0; i < 4; i += 1) await attempt(guard().check(EMAIL), 'wrong');
    await attempt(guard().check(EMAIL), 'right');
    for (let i = 0; i < 4; i += 1) await attempt(guard().check(EMAIL), 'wrong');
    expect((await guard().check(EMAIL)).allowed).toBe(true);
  });

  it('limits wrong passwords per client across accounts (100), never successes; other clients unaffected', async () => {
    const { guard } = guardSetup();
    // Many people signing in successfully behind one address use no failure budget.
    for (let i = 0; i < 150; i += 1) {
      expect((await attempt(guard().check(`ok${String(i)}@example.test`), 'right')).allowed).toBe(
        true,
      );
    }
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.signIn.clientFailures.max; i += 1) {
      expect((await attempt(guard().check(`u${String(i)}@example.test`), 'wrong')).allowed).toBe(
        true,
      );
    }
    expect(await guard().check('fresh@example.test')).toMatchObject({ allowed: false });
    expect((await guard(OTHER_CLIENT).check('fresh@example.test')).allowed).toBe(true);
  });

  it("limits every attempt per client (Auth's shared budget, 1,000); the shared key has larger budgets", async () => {
    const { guard } = guardSetup();
    const max = PLATFORM_AUTH_LIMITS.signIn.clientAttempts.max;
    for (let i = 0; i < max; i += 1) {
      expect((await attempt(guard().check(`a${String(i)}@example.test`), 'right')).allowed).toBe(
        true,
      );
    }
    expect((await guard().check(EMAIL)).allowed).toBe(false);
    // No trusted address: one shared key with its own (larger) budgets.
    const shared = guardSetup({ key: null });
    for (let i = 0; i < PLATFORM_AUTH_LIMITS.signIn.clientFailures.max + 1; i += 1) {
      await attempt(shared.guard().check(`u${String(i)}@example.test`), 'wrong');
    }
    expect((await shared.guard().check('fresh@example.test')).allowed).toBe(true);
  });

  it('trusts a browser only after a sign-in with «تذكّر هذا المتصفح» ticked (opt-in, PO decision 9 Oct 2026)', async () => {
    const { guard, memory } = guardSetup();
    const mine = browser();
    // Unticked: no cookie, nothing trusted.
    await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'right');
    expect(mine.jar.token).toBeNull();
    expect(memory.trusted.size).toBe(0);
    // Ticked: a random token in the cookie, trusted for 30 days.
    await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'remember');
    expect(mine.jar.token).toMatch(DEVICE_TOKEN_PATTERN);
    expect(mine.jar.maxAge).toBe(30 * 86_400);
    expect(memory.signInSucceeded).toHaveBeenLastCalledWith(
      expect.objectContaining({ device: null }),
      false,
      { freshDevice: deviceSubject(mine.jar.token ?? ''), trustDays: 30 },
    );
    expect(memory.trusted.size).toBe(1);
  });

  it('a trusted browser signs in while the account is locked for others, with its own budget; using it up e-mails the owner too (L1)', async () => {
    const { guard, lockMails } = guardSetup();
    const mine = browser();
    await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'remember');
    const token = mine.jar.token;
    // Someone else locks the account from unknown browsers.
    const attacker = browser();
    for (let i = 0; i < 5; i += 1)
      await attempt(guard(OTHER_CLIENT, attacker.cookie).check(EMAIL), 'wrong');
    expect((await guard(OTHER_CLIENT, attacker.cookie).check(EMAIL)).allowed).toBe(false);
    expect(lockMails).toEqual([{ email: EMAIL, minutes: 15 }]);
    // The trusted browser still gets through — its own budget of 10.
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'wrong')).allowed).toBe(true);
    }
    expect(await guard(CLIENT, mine.cookie).check(EMAIL)).toMatchObject({ allowed: false });
    // Its budget used up (a stolen cookie guessing?): the owner hears of it as well — the worker's quiet
    // window and caps apply alike.
    expect(lockMails).toEqual([
      { email: EMAIL, minutes: 15 },
      { email: EMAIL, minutes: 15 },
    ]);
    // The cookie names no account and stays the same token for every account of the browser.
    await attempt(guard(CLIENT, mine.cookie).check('second@example.test'), 'remember');
    expect(mine.jar.token).toBe(token);
  });

  it('an unticked sign-in on a trusted browser does not renew its trust (it ends on its date)', async () => {
    const { guard, memory, advance } = guardSetup();
    const mine = browser();
    await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'remember');
    const [key, firstUntil] = [...memory.trusted][0] ?? [];
    mine.jar.maxAge = 0;
    advance(10 * 86_400);
    expect((await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'right')).allowed).toBe(true);
    expect(memory.trusted.get(key ?? '')).toBe(firstUntil);
    expect(mine.jar.maxAge).toBe(0); // the cookie was not written again
    // A ticked one renews it: sliding, 30 days from now.
    await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'remember');
    expect(memory.trusted.get(key ?? '')).toBe((firstUntil ?? 0) + 10 * 86_400_000);
    expect(mine.jar.maxAge).toBe(30 * 86_400);
    // After the 30 days without a ticked sign-in, the browser is unknown again.
    advance(30 * 86_400);
    const gate = await guard(CLIENT, mine.cookie).check(EMAIL);
    expect(gate.allowed).toBe(true);
    expect(memory.signInCheck.mock.results.length).toBeGreaterThan(0);
    const answer = (await memory.signInCheck.mock.results.at(-1)?.value) as SignInCheck;
    expect(answer.trusted).toBe(false);
  });

  it('a token the server never issued is replaced by a fresh one (never trusted as presented)', async () => {
    const { guard, memory } = guardSetup();
    const planted = 'p'.repeat(43);
    const mine = browser(planted);
    await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'remember');
    expect(mine.jar.token).toMatch(DEVICE_TOKEN_PATTERN);
    expect(mine.jar.token).not.toBe(planted);
    expect([...memory.trusted.keys()].some((k) => k.endsWith(hex(deviceSubject(planted))))).toBe(
      false,
    );
  });

  it('a trusted browser’s success does not end the account’s lock for other browsers', async () => {
    const { guard, advance } = guardSetup();
    const mine = browser();
    await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'remember');
    for (let i = 0; i < 5; i += 1)
      await attempt(guard(OTHER_CLIENT, browser().cookie).check(EMAIL), 'wrong');
    advance(1);
    expect((await attempt(guard(CLIENT, mine.cookie).check(EMAIL), 'right')).allowed).toBe(true);
    expect((await guard(OTHER_CLIENT, browser().cookie).check(EMAIL)).allowed).toBe(false);
  });

  it("Auth's 429 gives the account's failure back (no password compared), the client's stays (L6)", async () => {
    const { guard, memory } = guardSetup();
    for (let i = 0; i < 20; i += 1) await attempt(guard().check(EMAIL), 'auth_429');
    // A flood Auth refused by itself did not lock the account…
    expect((await attempt(guard().check(EMAIL), 'wrong')).allowed).toBe(true);
    // …but each attempt still counts for the client (20 + 1 of its 100 wrong passwords).
    const last = (await memory.signInCheck.mock.results.at(-1)?.value) as SignInCheck;
    expect(last.clientRemaining).toBe(100 - 21);
    expect(memory.signInNotChecked).toHaveBeenCalledTimes(20);
    // A failure to give it back is logged, never thrown.
    const events: SecurityEvent[] = [];
    const g = createSignInGuard({
      store: { ...memory.store, signInNotChecked: () => Promise.reject(new Error('down')) },
      limits: PLATFORM_AUTH_LIMITS,
      log: (e) => events.push(e),
      client: CLIENT,
      action: 'platform.auth.sign_in',
      device: browser().cookie,
      requestLockedMail: () => Promise.resolve(),
    });
    await attempt(g.check('other@example.test'), 'auth_429');
    expect(events.map((e) => [e.event, e.reason])).toEqual([
      ['auth.limiter.unavailable', 'failure_not_given_back'],
    ]);
  });

  it('requests the lockout e-mail once, when the 5th failure locks the account', async () => {
    const { guard, lockMails, events } = guardSetup();
    for (let i = 0; i < 4; i += 1) await attempt(guard().check(EMAIL), 'wrong');
    expect(lockMails).toEqual([]);
    await attempt(guard().check(EMAIL), 'wrong');
    expect(lockMails).toEqual([{ email: EMAIL, minutes: 15 }]);
    // Refused attempts while locked request nothing more.
    for (let i = 0; i < 3; i += 1) await attempt(guard().check(EMAIL), 'wrong');
    expect(lockMails).toHaveLength(1);
    expect(events.filter((e) => e.event === 'auth.lockout')).toHaveLength(1);
  });

  it('a failing lockout e-mail request is logged, never thrown', async () => {
    const events: SecurityEvent[] = [];
    const memory = memoryStore();
    const g = createSignInGuard({
      store: memory.store,
      limits: PLATFORM_AUTH_LIMITS,
      log: (e) => events.push(e),
      client: CLIENT,
      action: 'platform.auth.sign_in',
      device: browser().cookie,
      requestLockedMail: () => Promise.reject(new Error('queue down for someone@example.test')),
    });
    for (let i = 0; i < 5; i += 1) await attempt(g.check(EMAIL), 'wrong');
    expect(events.at(-1)).toMatchObject({
      event: 'auth.limiter.unavailable',
      reason: 'lock_mail_not_requested',
      errorName: 'Error',
    });
    expect(JSON.stringify(events)).not.toContain('example.test');
  });

  it('records security events with codes and keyed references only', async () => {
    const { guard, events } = guardSetup();
    for (let i = 0; i < 5; i += 1) await attempt(guard().check(EMAIL), 'wrong');
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

  it('never throws after Auth said yes: an unrecorded (ticked) success is logged and the browser stays untrusted', async () => {
    const memory = memoryStore();
    const events: SecurityEvent[] = [];
    const mine = browser();
    const g = createSignInGuard({
      store: { ...memory.store, signInSucceeded: () => Promise.reject(new Error('down')) },
      limits: PLATFORM_AUTH_LIMITS,
      log: (e) => events.push(e),
      client: CLIENT,
      action: 'platform.auth.sign_in',
      device: mine.cookie,
      requestLockedMail: () => Promise.resolve(),
    });
    await expect(attempt(g.check(EMAIL), 'remember')).resolves.toMatchObject({ allowed: true });
    expect(mine.jar.token).toBeNull();
    expect(events.map((e) => [e.event, e.reason])).toEqual([
      ['auth.limiter.unavailable', 'success_not_recorded'],
    ]);
  });

  it('ignores nothing it cannot trust: a malformed cookie is an unknown browser (the adapter checks the pattern)', () => {
    expect(DEVICE_TOKEN_PATTERN.test('a'.repeat(43))).toBe(true);
    for (const value of [
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}=`,
      `${'a'.repeat(42)}.`,
    ]) {
      expect(DEVICE_TOKEN_PATTERN.test(value), value).toBe(false);
    }
  });

  it('NO_SIGN_IN_GUARD refuses any check (a sign-in path without a client fails closed)', async () => {
    await expect(NO_SIGN_IN_GUARD.check(EMAIL)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it('a completed password reset unlocks the account, TRUSTS the browser that completed it and forgets the others (M2)', async () => {
    const { deps, guard, memory } = guardSetup();
    const laptop = browser();
    await attempt(guard(CLIENT, laptop.cookie).check(EMAIL), 'remember');
    expect(memory.trusted.size).toBe(1);
    for (let i = 0; i < 5; i += 1) await attempt(guard(OTHER_CLIENT).check(EMAIL), 'wrong');
    expect((await guard(OTHER_CLIENT).check(EMAIL)).allowed).toBe(false);
    // The owner resets the password from a phone that never signed in: it gets a fresh token, trusted.
    const phone = browser();
    await resetAccountSignIn(
      deps,
      'platform.auth.password_reset',
      'someone@example.TEST',
      phone.cookie,
    );
    expect(phone.jar.token).toMatch(DEVICE_TOKEN_PATTERN);
    expect(phone.jar.maxAge).toBe(30 * 86_400);
    // The lock ended for everyone; the phone is trusted — an attacker locking the account again cannot
    // keep the owner out — and the laptop must be remembered again.
    expect((await guard(OTHER_CLIENT).check(EMAIL)).allowed).toBe(true);
    for (let i = 0; i < 5; i += 1) await attempt(guard(OTHER_CLIENT).check(EMAIL), 'wrong');
    expect((await attempt(guard(CLIENT, phone.cookie).check(EMAIL), 'right')).allowed).toBe(true);
    expect((await guard(CLIENT, laptop.cookie).check(EMAIL)).allowed).toBe(false);
    expect(memory.trusted.size).toBe(1);
  });

  it('a reset from a browser the server knows keeps its token', async () => {
    const { deps, guard } = guardSetup();
    const laptop = browser();
    await attempt(guard(CLIENT, laptop.cookie).check(EMAIL), 'remember');
    const token = laptop.jar.token;
    await resetAccountSignIn(deps, 'platform.auth.password_reset', EMAIL, laptop.cookie);
    expect(laptop.jar.token).toBe(token);
  });

  it('resetAccountSignIn never throws (logged), and trusts nothing then', async () => {
    const events: SecurityEvent[] = [];
    const phone = browser();
    await resetAccountSignIn(
      { store: failingStore(), limits: PLATFORM_AUTH_LIMITS, log: (e) => events.push(e) },
      'platform.auth.password_reset',
      EMAIL,
      phone.cookie,
    );
    expect(events[0]).toMatchObject({
      event: 'auth.limiter.unavailable',
      reason: 'lock_not_cleared',
    });
    expect(phone.jar.token).toBeNull();
  });

  it('after a My profile password change, every trusted browser but this one is forgotten (L2)', async () => {
    const { deps, guard, memory } = guardSetup();
    const here = browser();
    const elsewhere = browser();
    await attempt(guard(CLIENT, here.cookie).check(EMAIL), 'remember');
    await attempt(guard(OTHER_CLIENT, elsewhere.cookie).check(EMAIL), 'remember');
    expect(memory.trusted.size).toBe(2);
    await forgetOtherTrustedBrowsers(deps, 'platform.auth.change_password', EMAIL, here.jar.token);
    expect(memory.forgetOtherDevices).toHaveBeenCalledWith(
      accountSubject(EMAIL),
      deviceSubject(here.jar.token ?? ''),
    );
    expect(memory.trusted.size).toBe(1);
    // From a browser without a token, all of them go.
    await forgetOtherTrustedBrowsers(deps, 'platform.auth.change_password', EMAIL, null);
    expect(memory.trusted.size).toBe(0);
    // Never throws (logged).
    const events: SecurityEvent[] = [];
    await forgetOtherTrustedBrowsers(
      { store: failingStore(), limits: PLATFORM_AUTH_LIMITS, log: (e) => events.push(e) },
      'platform.auth.change_password',
      EMAIL,
      null,
    );
    expect(events.map((e) => [e.event, e.reason])).toEqual([
      ['auth.limiter.unavailable', 'devices_not_forgotten'],
    ]);
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

  it('is refused on Vercel: hosted Auth must never receive visitors’ addresses (security review T-M2-11)', () => {
    expect(() =>
      authClientHeaders(
        { key: '203.0.113.7' },
        { [AUTH_CLIENT_HEADER_ENV]: 'X-Jadarat-Client', VERCEL: '1' },
      ),
    ).toThrow('refused on Vercel');
    // Unset on Vercel: fine.
    expect(authClientHeaders({ key: '203.0.113.7' }, { VERCEL: '1' })).toBeNull();
  });
});

describe('organizationAccountLockout (T-M2-10 policy, members only — T-M2-10 security review)', () => {
  const fallback = PLATFORM_AUTH_LIMITS.signIn.accountFailures;
  const ORG = '22222222-2222-4222-8222-222222222222';
  const lax = { threshold: 20, minutes: 5 };

  it('applies the host organization’s policy to its own members only; everyone else gets the platform default', async () => {
    const accountInTenant = vi.fn((email: string, tenantId: string) =>
      Promise.resolve(email === 'member@org.test' && tenantId === ORG),
    );
    const lockoutPolicyFor = vi.fn(() => Promise.resolve(lax));
    const budget = organizationAccountLockout(
      { hostTenantId: ORG, lockoutPolicyFor, accountInTenant },
      fallback,
      {},
    );
    // Clamped to the platform default or stricter (L5): never more than 5 failures, never under 15 minutes.
    expect(await budget('member@org.test')).toEqual(fallback);
    // Another organization's account on this (lax) host: the platform default, not the host's policy.
    expect(await budget('victim@elsewhere.test')).toEqual(fallback);
    // The platform's own sign-in host: always the default.
    const platform = organizationAccountLockout(
      { hostTenantId: null, lockoutPolicyFor, accountInTenant },
      fallback,
      {},
    );
    expect(await platform('member@org.test')).toEqual(fallback);
    expect(accountInTenant).toHaveBeenCalledTimes(2);
  });

  it('applies a stricter policy as it is; clamps a laxer one (L5); ignores a missing or malformed one; keeps the smoke test’s short window', async () => {
    const deps = (policy: { threshold: number; minutes: number } | null) => ({
      hostTenantId: ORG,
      lockoutPolicyFor: () => Promise.resolve(policy),
      accountInTenant: () => Promise.resolve(true),
    });
    for (const policy of [
      null,
      { threshold: 0, minutes: 15 },
      { threshold: 5, minutes: 0 },
      { threshold: 5.5, minutes: 15 },
    ]) {
      expect(await organizationAccountLockout(deps(policy), fallback, {})('m@org.test')).toEqual(
        fallback,
      );
    }
    expect(
      await organizationAccountLockout(
        deps({ threshold: 3, minutes: 30 }),
        fallback,
        {},
      )('m@org.test'),
    ).toEqual({ max: 3, windowSeconds: 1800 });
    expect(
      await organizationAccountLockout(
        deps({ threshold: 4, minutes: 10 }),
        fallback,
        {},
      )('m@org.test'),
    ).toEqual({ max: 4, windowSeconds: 900 });
    expect(
      await organizationAccountLockout(
        deps({ threshold: 8, minutes: 60 }),
        fallback,
        {},
      )('m@org.test'),
    ).toEqual({ max: 5, windowSeconds: 3600 });
    expect(
      await organizationAccountLockout(deps({ threshold: 3, minutes: 30 }), fallback, {
        [AUTH_RATE_LIMIT_WINDOW_ENV]: '40',
      })('m@org.test'),
    ).toEqual({ max: 3, windowSeconds: 40 });
  });

  it('the guard applies it per typed address, and fails closed when it cannot be read', async () => {
    const { deps } = guardSetup();
    const strict = createSignInGuard({
      ...deps,
      client: CLIENT,
      action: 'platform.auth.sign_in',
      device: browser().cookie,
      requestLockedMail: () => Promise.resolve(),
      accountLockout: (email) =>
        Promise.resolve(email === 'member@org.test' ? { max: 2, windowSeconds: 60 } : fallback),
    });
    for (let i = 0; i < 2; i += 1) await attempt(strict.check('member@org.test'), 'wrong');
    expect(await strict.check('member@org.test')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect((await strict.check(EMAIL)).allowed).toBe(true);
    const broken = createSignInGuard({
      ...deps,
      client: CLIENT,
      action: 'platform.auth.sign_in',
      device: browser().cookie,
      requestLockedMail: () => Promise.resolve(),
      accountLockout: () => Promise.reject(new Error('down')),
    });
    await expect(broken.check(EMAIL)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });
});

describe('createCodeAttemptLimiter / withCodeAttemptLimit (authenticator codes, TM-0003 T-IAM-12)', () => {
  const USER = '11111111-1111-4111-8111-111111111111';
  const setup = (client: { key: string | null } = CLIENT, store?: RateLimitStore) => {
    const memory = memoryStore();
    const events: SecurityEvent[] = [];
    const limiter = (c = client) =>
      createCodeAttemptLimiter({
        store: store ?? memory.store,
        limits: PLATFORM_AUTH_LIMITS,
        log: (e) => events.push(e),
        client: c,
        action: 'platform.auth.mfa_verify',
      });
    return { limiter, events, memory };
  };
  const wrongCode = () => Promise.resolve(err(appError('VALIDATION_FAILED')));
  const isWrong = (e: { code: string }) => e.code === 'VALIDATION_FAILED';

  it('5 wrong codes per account (any client): the 6th never reaches Auth; a right code ends the run', async () => {
    const { limiter, events } = setup();
    const verify = vi.fn(wrongCode);
    for (let i = 0; i < 5; i += 1) {
      const r = await withCodeAttemptLimit(
        limiter(i % 2 ? CLIENT : OTHER_CLIENT),
        USER,
        verify,
        isWrong,
      );
      expect(!r.ok && r.error.code).toBe('VALIDATION_FAILED');
    }
    const limited = await withCodeAttemptLimit(limiter(), USER, verify, isWrong);
    expect(!limited.ok && limited.error.code).toBe('RATE_LIMITED');
    expect(verify).toHaveBeenCalledTimes(5);
    expect(events.filter((e) => e.event === 'auth.mfa_code.failed')).toHaveLength(5);
    expect(events.find((e) => e.event === 'auth.lockout')).toMatchObject({
      reason: 'mfa_code.account_failures',
      entityType: 'auth_user',
      entityId: USER,
    });
    // Another account is unaffected.
    const other = await withCodeAttemptLimit(
      limiter(),
      '22222222-2222-4222-8222-222222222222',
      () => Promise.resolve(ok('aal2')),
      isWrong,
    );
    expect(other).toEqual(ok('aal2'));
  });

  it('N parallel code checks of one account: at most 5 reach Auth', async () => {
    const { limiter } = setup();
    const verify = vi.fn(wrongCode);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withCodeAttemptLimit(limiter({ key: `192.0.2.${String(i)}` }), USER, verify, isWrong),
      ),
    );
    expect(verify).toHaveBeenCalledTimes(5);
  });

  it('counts wrong codes only: right codes are given back, outages stay counted', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 4; i += 1) await withCodeAttemptLimit(limiter(), USER, wrongCode, isWrong);
    // A right code ends the account's run and gives the client's provisional failure back.
    expect(
      await withCodeAttemptLimit(limiter(), USER, () => Promise.resolve(ok(1)), isWrong),
    ).toEqual(ok(1));
    for (let i = 0; i < 4; i += 1) await withCodeAttemptLimit(limiter(), USER, wrongCode, isWrong);
    // An Auth outage (thrown) keeps the provisional failure: that was the 5th.
    await expect(
      withCodeAttemptLimit(limiter(), USER, () => Promise.reject(new Error('auth down')), isWrong),
    ).rejects.toThrow('auth down');
    expect((await limiter().check(USER)).allowed).toBe(false);
  });

  it('fails closed when the limiter cannot answer: Auth is never asked', async () => {
    const { limiter, events } = setup(CLIENT, failingStore());
    const verify = vi.fn(wrongCode);
    await expect(withCodeAttemptLimit(limiter(), USER, verify, isWrong)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
    expect(verify).not.toHaveBeenCalled();
    expect(events.map((e) => e.reason)).toEqual(['fail_closed']);
  });
});
