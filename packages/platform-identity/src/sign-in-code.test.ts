import { describe, expect, it, vi } from 'vitest';
import type { AuthFlowDeps } from './auth-flow';
import { IdentityErrors, firstFactorOf } from './auth-flow';
import { NO_SIGN_IN_GUARD } from './auth-limits';
import { type SignInCodeDeps, requestSignInCode, signInWithEmailedCode } from './sign-in-code';
import type { SignInCodeLimiter } from './sign-in-code-limits';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TENANT = 'a0000000-0000-4000-8000-000000000001';
const PERSON = '44444444-4444-4444-8444-444444444444';
const EMAIL = 'someone@example.test';

const tokenClaims: Record<string, Record<string, unknown>> = {
  'access-1': {
    sub: USER,
    role: 'authenticated',
    aal: 'aal1',
    session_id: SESSION,
    amr: [{ method: 'otp' }],
  },
  'access-2': {
    sub: USER,
    role: 'authenticated',
    aal: 'aal1',
    session_id: SESSION,
    tenant_id: TENANT,
    person_id: PERSON,
    amr: [{ method: 'otp' }],
  },
};

interface Options {
  verifyOtpError?: { status?: number | undefined };
  access?: string;
  limiterAllows?: boolean;
  tooSoon?: number;
  triesIfWrong?: number;
  keptDays?: number;
  otpStatus?: number | undefined;
}

function setup(options: Options = {}) {
  const events: string[] = [];
  const kept: boolean[] = [];
  const markers: boolean[] = [];
  const background: Promise<unknown>[] = [];
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
    allowRequest: vi.fn(() =>
      Promise.resolve(
        options.tooSoon !== undefined
          ? ({ allowed: false, tooSoonSeconds: options.tooSoon } as const)
          : options.limiterAllows === false
            ? ({ allowed: false } as const)
            : ({ allowed: true } as const),
      ),
    ),
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
  const requestOtp = vi.fn(() =>
    Promise.resolve({ status: 'otpStatus' in options ? options.otpStatus : 200 }),
  );
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
    requestOtp,
    keepSession: vi.fn(() => Promise.resolve(options.keptDays ?? 14)),
    setSessionCookieLifetime: vi.fn((value: boolean) => {
      events.push(`lifetime:${String(value)}`);
      kept.push(value);
    }),
    setKeepMarker: vi.fn((value: boolean) => {
      markers.push(value);
    }),
    auditRefused: vi.fn(() => Promise.resolve()),
    keepAlive: (work) => {
      background.push(work);
    },
  };
  return { deps, auth, attempt, limiter, audited, events, kept, markers, background, requestOtp };
}

describe('requestSignInCode', () => {
  it('asks Auth for the code in the background and answers at once, the same for every address', async () => {
    const { deps, requestOtp, background } = setup();
    const result = await requestSignInCode(deps, { email: EMAIL });
    expect(result).toEqual({ ok: true, value: { resendAfterSeconds: 60 } });
    expect(background).toHaveLength(1);
    await Promise.all(background);
    expect(requestOtp).toHaveBeenCalledWith(EMAIL);
    // An unknown address (Auth refuses to create a user) is the normal case: nothing is logged.
    const unknown = setup({ otpStatus: 422 });
    await requestSignInCode(unknown.deps, { email: EMAIL });
    await Promise.all(unknown.background);
    expect(unknown.deps.logWarning).not.toHaveBeenCalled();
  });

  it('logs Auth problems by status only - never the address', async () => {
    for (const otpStatus of [undefined, 500, 429]) {
      const { deps, background } = setup({ otpStatus });
      await requestSignInCode(deps, { email: EMAIL });
      await Promise.all(background);
      expect(deps.logWarning).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify((deps.logWarning as unknown as { mock: { calls: unknown[] } }).mock.calls),
      ).not.toContain('someone');
    }
  });

  it('is refused by the limiter before Auth is asked (the same for every address)', async () => {
    const { deps, requestOtp, background } = setup({ limiterAllows: false });
    const result = await requestSignInCode(deps, { email: EMAIL });
    expect(result).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect(requestOtp).not.toHaveBeenCalled();
    expect(background).toHaveLength(0);
  });

  it('a second request within a minute says how long to wait, bounded to a minute', async () => {
    const { deps, requestOtp } = setup({ tooSoon: 42 });
    expect(await requestSignInCode(deps, { email: EMAIL })).toMatchObject({
      ok: false,
      error: { code: IdentityErrors.SIGN_IN_CODE_TOO_SOON.code, params: { seconds: 42 } },
    });
    const odd = setup({ tooSoon: 9999 });
    expect(await requestSignInCode(odd.deps, { email: EMAIL })).toMatchObject({
      error: { params: { seconds: 60 } },
    });
    expect(requestOtp).not.toHaveBeenCalled();
  });
});

describe('signInWithEmailedCode', () => {
  const input = { email: EMAIL, code: '482913', remember: false };

  it("opens the session with Auth's own code, continues like a password sign-in and audits the method", async () => {
    const { deps, auth, attempt, audited, events } = setup();
    const result = await signInWithEmailedCode(deps, input);
    expect(result).toEqual({ ok: true, value: { next: 'home' } });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: '482913', type: 'email' });
    expect(events).toEqual(['lifetime:false', 'verifyOtp', 'succeeded']);
    expect(attempt.failed).not.toHaveBeenCalled();
    expect(audited).toEqual([
      { action: 'platform.auth.signed_in', data: { method: 'email_code', aal: 'aal1' } },
    ]);
  });

  it('hands the organization MFA policy the same decision as after a password: the authenticator app next', async () => {
    const { deps } = setup({ access: 'mfa_challenge' });
    expect(await signInWithEmailedCode(deps, input)).toEqual({ ok: true, value: { next: 'mfa' } });
  });

  it('a wrong or expired code: counted, the tries left on the screen, the refusal audited; no session', async () => {
    const { deps, attempt } = setup({
      triesIfWrong: 3,
      verifyOtpError: { status: 403 },
    });
    const result = await signInWithEmailedCode(deps, input);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_INVALID', params: { tries: 3 } },
    });
    expect(attempt.failed).toHaveBeenCalledTimes(1);
    expect(deps.auditRefused).toHaveBeenCalledWith(EMAIL, false);
    expect(deps.keepSession).not.toHaveBeenCalled();
  });

  it('the fifth wrong code (no tries left) says the code is dead and checks are paused', async () => {
    const { deps } = setup({ triesIfWrong: 0, verifyOtpError: { status: 422 } });
    expect(await signInWithEmailedCode(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_LOCKED' },
    });
    expect(deps.auditRefused).toHaveBeenCalledWith(EMAIL, true);
  });

  it('code checks paused by the limiter: locked, Auth is not asked', async () => {
    const { deps, auth } = setup({ limiterAllows: false });
    expect(await signInWithEmailedCode(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_LOCKED' },
    });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("Auth rate limiting is not the code's fault; an outage is thrown and costs no try", async () => {
    const limited = setup({ verifyOtpError: { status: 429 } });
    expect(await signInWithEmailedCode(limited.deps, input)).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
    expect(limited.attempt.released).toHaveBeenCalledTimes(1);
    expect(limited.attempt.failed).not.toHaveBeenCalled();
    const down = setup({ verifyOtpError: { status: 503 } });
    await expect(signInWithEmailedCode(down.deps, input)).rejects.toThrow(
      'Supabase Auth request failed',
    );
    expect(down.attempt.released).toHaveBeenCalledTimes(1);
    expect(down.deps.auditRefused).not.toHaveBeenCalled();
  });

  it('a failure to audit the refusal never changes the answer', async () => {
    const { deps } = setup({ verifyOtpError: { status: 403 } });
    (deps.auditRefused as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(
      new Error('db'),
    );
    expect(await signInWithEmailedCode(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_INVALID' },
    });
    expect(deps.logWarning).toHaveBeenCalled();
  });
});

describe('«Remember this browser» = «keep me signed in»', () => {
  const input = { email: EMAIL, code: '482913', remember: true };

  it('ticked: the cookies last from the moment Auth opens the session, and the session is kept', async () => {
    const { deps, events, markers, kept } = setup({ keptDays: 14 });
    expect(await signInWithEmailedCode(deps, input)).toEqual({ ok: true, value: { next: 'home' } });
    // The lifetime is chosen BEFORE Auth writes the cookies.
    expect(events.indexOf('lifetime:true')).toBeLessThan(events.indexOf('verifyOtp'));
    expect(kept).toEqual([true]);
    expect(deps.keepSession).toHaveBeenCalledWith('tx');
    expect(markers).toEqual([false, true]);
  });

  it('not ticked: the cookies end with the browser and nothing is kept', async () => {
    const { deps, kept, markers } = setup();
    await signInWithEmailedCode(deps, { ...input, remember: false });
    expect(kept).toEqual([false]);
    expect(deps.keepSession).not.toHaveBeenCalled();
    expect(markers).toEqual([false]);
  });

  it('an organization with the setting Off keeps nothing: the browser is not marked', async () => {
    const { deps, markers } = setup({ keptDays: 0 });
    await signInWithEmailedCode(deps, input);
    expect(markers).toEqual([false, false]);
  });

  it('a failure to keep never blocks the sign-in', async () => {
    const { deps, markers } = setup();
    (deps.keepSession as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(
      new Error('db'),
    );
    expect(await signInWithEmailedCode(deps, input)).toEqual({ ok: true, value: { next: 'home' } });
    expect(deps.logWarning).toHaveBeenCalled();
    expect(markers).toEqual([false]);
  });

  it('the second step still follows when the organization requires it', async () => {
    const { deps } = setup({ access: 'mfa_challenge' });
    expect(await signInWithEmailedCode(deps, input)).toEqual({ ok: true, value: { next: 'mfa' } });
    expect(deps.keepSession).toHaveBeenCalledTimes(1);
  });
});

describe('firstFactorOf', () => {
  it('tells an e-mailed code from a password in the access token', () => {
    const claims = (amr: unknown) => ({ sub: USER, amr }) as never;
    expect(firstFactorOf(claims([{ method: 'password' }]))).toBe('password');
    expect(firstFactorOf(claims([{ method: 'otp' }]))).toBe('email_code');
    expect(firstFactorOf(claims([{ method: 'magiclink' }]))).toBe('email_code');
    expect(firstFactorOf(claims([{ method: 'totp' }, { method: 'otp' }]))).toBe('email_code');
    expect(firstFactorOf(claims(undefined))).toBe('password');
  });
});
