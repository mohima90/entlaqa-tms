import { describe, expect, it, vi } from 'vitest';
import type { AuthFlowDeps } from './auth-flow';
import { IdentityErrors, firstFactorOf } from './auth-flow';
import { NO_SIGN_IN_GUARD } from './auth-limits';
import {
  type PendingRememberCookie,
  type RememberedBrowserCookie,
  type SignInCodeDeps,
  completeRememberedSignIn,
  forgetBrowserOnSignOut,
  rememberAfterSecondStep,
  requestSignInCode,
  signInWithEmailedCode,
} from './sign-in-code';
import { type SignInCodeLimiter, rememberedBrowserHash } from './sign-in-code-limits';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TENANT = 'a0000000-0000-4000-8000-000000000001';
const PERSON = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'T'.repeat(43);
const EMAIL = 'someone@example.test';

const tokenClaims: Record<string, Record<string, unknown>> = {
  'access-1': {
    sub: USER,
    role: 'authenticated',
    aal: 'aal1',
    session_id: SESSION,
    amr: [{ method: 'magiclink' }],
  },
  'access-2': {
    sub: USER,
    role: 'authenticated',
    aal: 'aal1',
    session_id: SESSION,
    tenant_id: TENANT,
    person_id: PERSON,
    amr: [{ method: 'magiclink' }],
  },
};

interface Options {
  verifyOtpError?: { status?: number | undefined };
  access?: string;
  limiterAllows?: boolean;
  triesIfWrong?: number;
  cookie?: string | null;
  /** The pending tick of an earlier code sign-in. */
  pending?: string | null;
  /** The database says the cookie's browser is remembered for the typed address. */
  remembered?: boolean;
  rememberResult?: number;
  codes?: Partial<SignInCodeDeps['codes']>;
}

function setup(options: Options = {}) {
  const events: string[] = [];
  const cookieWrites: { token: string; maxAge: number }[] = [];
  const cookieCleared: boolean[] = [];
  const attempt = {
    triesIfWrong: options.triesIfWrong ?? 3,
    failed: vi.fn(() => {
      events.push('failed');
      return Promise.resolve();
    }),
    succeeded: vi.fn(() => {
      events.push('succeeded');
      return Promise.resolve();
    }),
    released: vi.fn(() => {
      events.push('released');
      return Promise.resolve();
    }),
  };
  const limiter: SignInCodeLimiter = {
    allowRequest: vi.fn(() => Promise.resolve(options.limiterAllows ?? true)),
    checkCode: vi.fn(() =>
      Promise.resolve(
        options.limiterAllows === false
          ? ({ allowed: false, retryAfterSeconds: 900 } as const)
          : ({ allowed: true, attempt } as const),
      ),
    ),
  };
  const auth = {
    verifyOtp: vi.fn(() => {
      events.push('verifyOtp');
      return Promise.resolve(
        options.verifyOtpError
          ? { data: { session: null }, error: options.verifyOtpError }
          : {
              data: { session: { access_token: 'access-1', refresh_token: 'refresh-1' } },
              error: null,
            },
      );
    }),
    signInWithPassword: vi.fn(),
    getClaims: vi.fn((jwt?: string) => {
      const claims = jwt ? tokenClaims[jwt] : undefined;
      return Promise.resolve(
        claims ? { data: { claims }, error: null } : { data: null, error: new Error('no session') },
      );
    }),
    getUser: vi.fn(() => Promise.resolve({ data: { user: { id: USER } }, error: null })),
    refreshSession: vi.fn(() =>
      Promise.resolve({
        data: { session: { access_token: 'access-2', refresh_token: 'refresh-2' } },
        error: null,
      }),
    ),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
  };
  const audited: { action: string; data: unknown }[] = [];
  let clock = 1_000_000;
  const cookie: RememberedBrowserCookie = {
    read: () => (options.cookie === undefined ? null : options.cookie),
    write: (token, maxAge) => {
      cookieWrites.push({ token, maxAge });
    },
    clear: () => {
      cookieCleared.push(true);
    },
  };
  let pendingValue: string | null = options.pending ?? null;
  const pendingWrites: string[] = [];
  const pendingRemember: PendingRememberCookie = {
    read: () => pendingValue,
    write: (value) => {
      pendingWrites.push(value);
      pendingValue = value;
    },
    clear: () => {
      pendingValue = null;
    },
  };
  const defaultCodes: SignInCodeDeps['codes'] = {
    request: vi.fn(() => Promise.resolve({ outcome: 'queued' as const, requestId: REQUEST })),
    verify: vi.fn(() =>
      Promise.resolve({ outcome: 'ok' as const, linkToken: 'one-time-sign-in-token' }),
    ),
    takeRemembered: vi.fn(() => Promise.resolve({ outcome: 'gone' as const })),
    isRemembered: vi.fn(() => Promise.resolve(options.remembered ?? false)),
  };
  const deps: SignInCodeDeps = {
    supabase: { auth },
    withUserTx: ((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn('tx')) as AuthFlowDeps['withUserTx'],
    isPlatformAdmin: vi.fn(() => Promise.resolve(false)),
    listSessionTenants: vi.fn(() =>
      Promise.resolve([{ tenantId: TENANT, nameAr: 'أ', nameEn: 'A' }]),
    ),
    switchActiveTenant: vi.fn(() => Promise.resolve(true)),
    getSessionAccess: vi.fn(() =>
      Promise.resolve({
        state: (options.access ?? 'ok') as Awaited<
          ReturnType<AuthFlowDeps['getSessionAccess']>
        >['state'],
        mfaDeadline: null,
        usesApp: false,
        mfaPending: false,
        aal2: false,
      }),
    ),
    insertAuditEvent: vi.fn((_tx, _actor, event) => {
      audited.push({ action: event.action, data: event.data });
      return Promise.resolve();
    }),
    logWarning: vi.fn(),
    signInGuard: NO_SIGN_IN_GUARD,
    now: () => clock,
    sleep: vi.fn((ms: number) => {
      clock += ms;
      return Promise.resolve();
    }),
    limiter,
    codes: { ...defaultCodes, ...options.codes },
    rememberBrowser: vi.fn(() => Promise.resolve(options.rememberResult ?? 1)),
    forgetThisBrowser: vi.fn(() => Promise.resolve(1)),
    cookie,
    pendingRemember,
    browserLabel: () => 'Chrome on Windows',
    kickWorker: vi.fn(),
  };
  return {
    deps,
    auth,
    attempt,
    limiter,
    audited,
    events,
    cookieWrites,
    cookieCleared,
    pendingWrites,
    pending: () => pendingValue,
  };
}

describe('requestSignInCode', () => {
  it('queues a code and asks the worker for a pass; the answer is a request id and the resend wait', async () => {
    const { deps } = setup();
    const result = await requestSignInCode(deps, { email: EMAIL });
    expect(result).toEqual({
      ok: true,
      value: { kind: 'code', requestId: REQUEST, resendAfterSeconds: 60 },
    });
    expect(deps.kickWorker).toHaveBeenCalledTimes(1);
    expect(deps.codes.request).toHaveBeenCalledWith(EMAIL, null);
    // No browser token: the address's ceilings apply to everybody.
    expect(deps.limiter.allowRequest).toHaveBeenCalledWith(EMAIL, undefined);
  });

  it('asks the database whether the browser is remembered only when the limiter wants to know', async () => {
    const { deps } = setup({ cookie: TOKEN, remembered: true });
    await requestSignInCode(deps, { email: EMAIL });
    const [, options] = (deps.limiter.allowRequest as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [string, { trusted?: () => Promise<boolean> }];
    expect(deps.codes.isRemembered).not.toHaveBeenCalled();
    await expect(options.trusted?.()).resolves.toBe(true);
    expect(deps.codes.isRemembered).toHaveBeenCalledWith(EMAIL, rememberedBrowserHash(TOKEN));
  });

  it('a full queue answers like any request but is logged for the operator', async () => {
    const { deps } = setup({
      codes: {
        request: vi.fn(() => Promise.resolve({ outcome: 'full' as const, requestId: REQUEST })),
      },
    });
    const result = await requestSignInCode(deps, { email: EMAIL });
    expect(result).toEqual({
      ok: true,
      value: { kind: 'code', requestId: REQUEST, resendAfterSeconds: 60 },
    });
    expect(deps.logWarning).toHaveBeenCalledWith(
      expect.stringContaining('queue is full'),
      expect.objectContaining({ reason: 'queue_full' }),
    );
  });

  it('presents the remembered browser (as a hash, never the token) unless a code is forced', async () => {
    const { deps } = setup({
      cookie: TOKEN,
      codes: {
        request: vi.fn(() =>
          Promise.resolve({ outcome: 'remembered' as const, requestId: REQUEST }),
        ),
      },
    });
    const result = await requestSignInCode(deps, { email: EMAIL });
    expect(result).toEqual({ ok: true, value: { kind: 'remembered', requestId: REQUEST } });
    expect(deps.codes.request).toHaveBeenCalledWith(EMAIL, rememberedBrowserHash(TOKEN));
    await requestSignInCode(deps, { email: EMAIL, forceCode: true });
    expect(deps.codes.request).toHaveBeenLastCalledWith(EMAIL, null);
  });

  it('is refused by the limiter before anything is queued (the same for every address)', async () => {
    const { deps } = setup({ limiterAllows: false });
    const result = await requestSignInCode(deps, { email: EMAIL });
    expect(result).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect(deps.codes.request).not.toHaveBeenCalled();
    expect(deps.kickWorker).not.toHaveBeenCalled();
  });

  it('a second request within a minute says how long to wait', async () => {
    const { deps } = setup({
      codes: {
        request: vi.fn(() =>
          Promise.resolve({ outcome: 'too_soon' as const, retryAfterSeconds: 42 }),
        ),
      },
    });
    const result = await requestSignInCode(deps, { email: EMAIL });
    expect(result).toMatchObject({
      ok: false,
      error: { code: IdentityErrors.SIGN_IN_CODE_TOO_SOON.code, params: { seconds: 42 } },
    });
    expect(deps.kickWorker).not.toHaveBeenCalled();
  });
});

describe('signInWithEmailedCode', () => {
  const input = { requestId: REQUEST, email: EMAIL, code: '482913', remember: false };

  it('opens the session with the one-time token, continues like a password sign-in and audits the method', async () => {
    const { deps, auth, attempt, audited, events } = setup();
    const result = await signInWithEmailedCode(deps, input);
    expect(result).toEqual({ ok: true, value: { next: 'home' } });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'one-time-sign-in-token',
      type: 'magiclink',
    });
    expect(events).toEqual(['succeeded', 'verifyOtp']);
    expect(attempt.failed).not.toHaveBeenCalled();
    expect(audited).toEqual([
      { action: 'platform.auth.signed_in', data: { method: 'email_code', aal: 'aal1' } },
    ]);
  });

  it('hands the organization MFA policy the same decision as after a password: the authenticator app next', async () => {
    const { deps } = setup({ access: 'mfa_challenge' });
    expect(await signInWithEmailedCode(deps, input)).toEqual({ ok: true, value: { next: 'mfa' } });
  });

  it('a wrong code: counted, the tries left on the screen; no session', async () => {
    const { deps, auth, attempt } = setup({
      triesIfWrong: 3,
      codes: { verify: vi.fn(() => Promise.resolve({ outcome: 'wrong' as const })) },
    });
    const result = await signInWithEmailedCode(deps, input);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_INVALID', params: { tries: 3 } },
    });
    expect(attempt.failed).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('the fifth wrong code (no tries left) says the code is dead and checks are paused', async () => {
    const { deps } = setup({
      triesIfWrong: 0,
      codes: { verify: vi.fn(() => Promise.resolve({ outcome: 'wrong' as const })) },
    });
    expect(await signInWithEmailedCode(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_LOCKED' },
    });
  });

  it('a code the database killed is locked; an expired or used one is expired and costs no try', async () => {
    const locked = setup({
      codes: { verify: vi.fn(() => Promise.resolve({ outcome: 'locked' as const })) },
    });
    expect(await signInWithEmailedCode(locked.deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_LOCKED' },
    });
    expect(locked.attempt.failed).toHaveBeenCalledTimes(1);
    const expired = setup({
      codes: { verify: vi.fn(() => Promise.resolve({ outcome: 'expired' as const })) },
    });
    expect(await signInWithEmailedCode(expired.deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_EXPIRED' },
    });
    expect(expired.attempt.released).toHaveBeenCalledTimes(1);
    expect(expired.attempt.failed).not.toHaveBeenCalled();
  });

  it('code checks paused by the limiter: locked, the database is not asked', async () => {
    const { deps } = setup({ limiterAllows: false });
    expect(await signInWithEmailedCode(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_LOCKED' },
    });
    expect(deps.codes.verify).not.toHaveBeenCalled();
  });

  it('a token Auth refuses reads as an expired code; Auth rate limiting as RATE_LIMITED; an outage is thrown', async () => {
    const refused = setup({ verifyOtpError: { status: 403 } });
    expect(await signInWithEmailedCode(refused.deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_EXPIRED' },
    });
    const limited = setup({ verifyOtpError: { status: 429 } });
    expect(await signInWithEmailedCode(limited.deps, input)).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
    const down = setup({ verifyOtpError: { status: 503 } });
    await expect(signInWithEmailedCode(down.deps, input)).rejects.toThrow(
      'Supabase Auth request failed',
    );
  });

  it('remembers the browser only when ticked, writes the cookie only when an organization remembered it', async () => {
    const plain = setup();
    await signInWithEmailedCode(plain.deps, input);
    expect(plain.deps.rememberBrowser).not.toHaveBeenCalled();
    expect(plain.cookieWrites).toEqual([]);

    const ticked = setup({ rememberResult: 1 });
    await signInWithEmailedCode(ticked.deps, { ...input, remember: true });
    expect(ticked.deps.rememberBrowser).toHaveBeenCalledTimes(1);
    expect(ticked.cookieWrites).toHaveLength(1);
    expect(ticked.cookieWrites[0]?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ticked.cookieWrites[0]?.maxAge).toBe(30 * 24 * 60 * 60);
    // Only the SHA-256 of the token goes to the database, with the browser's label.
    const [, hash, label] =
      (ticked.deps.rememberBrowser as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] ??
      [];
    expect(hash).toEqual(rememberedBrowserHash(ticked.cookieWrites[0]?.token ?? ''));
    expect(label).toBe('Chrome on Windows');

    const off = setup({ rememberResult: 0 });
    await signInWithEmailedCode(off.deps, { ...input, remember: true });
    expect(off.cookieWrites).toEqual([]);
  });

  it('never adopts a token the browser already holds: a fresh one at every remembering (fixation)', async () => {
    const planted = setup({ cookie: TOKEN, rememberResult: 1 });
    await signInWithEmailedCode(planted.deps, { ...input, remember: true });
    expect(planted.cookieWrites).toHaveLength(1);
    expect(planted.cookieWrites[0]?.token).not.toBe(TOKEN);
    const [, hash] =
      (planted.deps.rememberBrowser as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] ??
      [];
    expect(hash).not.toEqual(rememberedBrowserHash(TOKEN));
  });

  it("remembers only after the organization's second step (BR-AUTH-f): the tick waits, bound to the session", async () => {
    const asked = setup({ access: 'mfa_challenge', rememberResult: 1 });
    expect(await signInWithEmailedCode(asked.deps, { ...input, remember: true })).toEqual({
      ok: true,
      value: { next: 'mfa' },
    });
    expect(asked.deps.rememberBrowser).not.toHaveBeenCalled();
    expect(asked.cookieWrites).toEqual([]);
    expect(asked.pendingWrites).toEqual([`${USER}.${SESSION}`]);

    // The authenticator code passed: the tick of this session remembers the browser.
    const claims = { sub: USER, session_id: SESSION } as never;
    await rememberAfterSecondStep(asked.deps, claims);
    expect(asked.deps.rememberBrowser).toHaveBeenCalledTimes(1);
    expect(asked.cookieWrites).toHaveLength(1);
    expect(asked.pending()).toBeNull();
    // Used once.
    await rememberAfterSecondStep(asked.deps, claims);
    expect(asked.deps.rememberBrowser).toHaveBeenCalledTimes(1);

    // Another account or session on the same browser cannot complete it - and the tick is gone.
    const other = setup({ pending: `${USER}.${SESSION}`, rememberResult: 1 });
    await rememberAfterSecondStep(other.deps, { sub: USER, session_id: 'another' } as never);
    expect(other.deps.rememberBrowser).not.toHaveBeenCalled();
    expect(other.pending()).toBeNull();
  });

  it('with several organizations the tick waits for the choice; a sign-in that does not tick drops an old tick', async () => {
    const several = setup({ rememberResult: 1 });
    (
      several.deps.listSessionTenants as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue([
      { tenantId: TENANT, nameAr: 'أ', nameEn: 'A' },
      { tenantId: 'b0000000-0000-4000-8000-000000000001', nameAr: 'ب', nameEn: 'B' },
    ]);
    expect(await signInWithEmailedCode(several.deps, { ...input, remember: true })).toEqual({
      ok: true,
      value: { next: 'choose-organization' },
    });
    expect(several.deps.rememberBrowser).not.toHaveBeenCalled();
    expect(several.pendingWrites).toHaveLength(1);

    const stale = setup({ pending: `${USER}.${SESSION}` });
    await signInWithEmailedCode(stale.deps, input);
    expect(stale.pending()).toBeNull();
  });

  it("a remembered browser is checked against its own budget, not the address's pause (M3)", async () => {
    const remembered = setup({ cookie: TOKEN, remembered: true });
    await signInWithEmailedCode(remembered.deps, input);
    expect(remembered.limiter.checkCode).toHaveBeenCalledWith(EMAIL, { rememberedToken: TOKEN });
    expect(remembered.deps.codes.isRemembered).toHaveBeenCalledWith(
      EMAIL,
      rememberedBrowserHash(TOKEN),
    );
    // A cookie the database does not know for this address counts for nothing.
    const unknown = setup({ cookie: TOKEN, remembered: false });
    await signInWithEmailedCode(unknown.deps, input);
    expect(unknown.limiter.checkCode).toHaveBeenCalledWith(EMAIL, undefined);
    const none = setup();
    await signInWithEmailedCode(none.deps, input);
    expect(none.deps.codes.isRemembered).not.toHaveBeenCalled();
  });

  it('"keep me signed in": the token the browser presented is replaced when another (or the same) account is remembered', async () => {
    const next = setup({ cookie: TOKEN, rememberResult: 1 });
    await signInWithEmailedCode(next.deps, { ...input, remember: true });
    const [, fresh, , replaced] =
      (next.deps.rememberBrowser as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] ??
      [];
    expect(replaced).toEqual(rememberedBrowserHash(TOKEN));
    expect(fresh).not.toEqual(replaced);
    // A browser with no cookie replaces nothing.
    const first = setup({ rememberResult: 1 });
    await signInWithEmailedCode(first.deps, { ...input, remember: true });
    const [, , , none] =
      (first.deps.rememberBrowser as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] ??
      [];
    expect(none).toBeNull();
  });

  it('a failure to remember never blocks the sign-in', async () => {
    const { deps } = setup();
    (
      deps.rememberBrowser as unknown as { mockRejectedValue: (e: Error) => void }
    ).mockRejectedValue(new Error('db'));
    expect(await signInWithEmailedCode(deps, { ...input, remember: true })).toEqual({
      ok: true,
      value: { next: 'home' },
    });
    expect(deps.logWarning).toHaveBeenCalled();
  });
});

describe('completeRememberedSignIn', () => {
  it('waits for the worker, then signs in without any code', async () => {
    const takeRemembered = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'pending' })
      .mockResolvedValueOnce({ outcome: 'ok', linkToken: 'one-time-sign-in-token' });
    const { deps, auth, cookieWrites } = setup({ cookie: TOKEN, codes: { takeRemembered } });
    const result = await completeRememberedSignIn(deps, { requestId: REQUEST, email: EMAIL });
    expect(result).toEqual({ ok: true, value: { status: 'done', outcome: { next: 'home' } } });
    // The token is replaced at every use: the database gets the hash of a new one, the browser the token itself.
    const [, , oldHash, newHash] = takeRemembered.mock.calls[0] as unknown[];
    expect(oldHash).toEqual(rememberedBrowserHash(TOKEN));
    expect(takeRemembered.mock.calls[1]?.[3]).toEqual(newHash);
    expect(cookieWrites).toHaveLength(1);
    expect(cookieWrites[0]?.token).not.toBe(TOKEN);
    expect(rememberedBrowserHash(cookieWrites[0]?.token ?? '')).toEqual(newHash);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('answers pending when the worker takes longer than one ask may wait', async () => {
    const { deps } = setup({
      cookie: TOKEN,
      codes: { takeRemembered: vi.fn(() => Promise.resolve({ outcome: 'pending' as const })) },
    });
    expect(await completeRememberedSignIn(deps, { requestId: REQUEST, email: EMAIL })).toEqual({
      ok: true,
      value: { status: 'pending' },
    });
  });

  it('a browser that is no longer remembered (or has no token) reads as expired: the screen sends a code instead', async () => {
    const gone = setup({
      cookie: TOKEN,
      codes: { takeRemembered: vi.fn(() => Promise.resolve({ outcome: 'gone' as const })) },
    });
    expect(
      await completeRememberedSignIn(gone.deps, { requestId: REQUEST, email: EMAIL }),
    ).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_EXPIRED' },
    });
    const none = setup({ cookie: null });
    expect(
      await completeRememberedSignIn(none.deps, { requestId: REQUEST, email: EMAIL }),
    ).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_EXPIRED' },
    });
    expect(none.deps.codes.takeRemembered).not.toHaveBeenCalled();
  });
});

describe('forgetBrowserOnSignOut', () => {
  const claims = { sub: USER, session_id: SESSION } as never;

  it('explicit sign-out forgets the browser server side and removes the cookie', async () => {
    const { deps, cookieCleared } = setup({ cookie: TOKEN });
    await forgetBrowserOnSignOut(deps, claims);
    const [, hash] =
      (deps.forgetThisBrowser as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] ?? [];
    expect(hash).toEqual(rememberedBrowserHash(TOKEN));
    expect(cookieCleared).toEqual([true]);
  });

  it('a browser with no remembered-browser cookie: nothing to do', async () => {
    const { deps, cookieCleared } = setup();
    await forgetBrowserOnSignOut(deps, claims);
    expect(deps.forgetThisBrowser).not.toHaveBeenCalled();
    expect(cookieCleared).toEqual([]);
  });

  it('never blocks the sign-out: the cookie goes even when the database fails', async () => {
    const { deps, cookieCleared } = setup({ cookie: TOKEN });
    (
      deps.forgetThisBrowser as unknown as { mockRejectedValue: (e: Error) => void }
    ).mockRejectedValue(new Error('db'));
    await forgetBrowserOnSignOut(deps, claims);
    expect(deps.logWarning).toHaveBeenCalled();
    expect(cookieCleared).toEqual([true]);
  });
});

describe('firstFactorOf', () => {
  it('tells an e-mailed code from a password in the access token', () => {
    const claims = (amr: unknown) => ({ sub: USER, amr }) as never;
    expect(firstFactorOf(claims([{ method: 'password' }]))).toBe('password');
    expect(firstFactorOf(claims([{ method: 'magiclink' }]))).toBe('email_code');
    expect(firstFactorOf(claims([{ method: 'totp' }, { method: 'otp' }]))).toBe('email_code');
    expect(firstFactorOf(claims(undefined))).toBe('password');
  });
});
