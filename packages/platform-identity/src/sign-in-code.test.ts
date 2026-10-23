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
  /** What the database says about the typed code (private.verify_sign_in_code). */
  codeOutcome?: 'ok' | 'wrong' | 'killed' | 'none';
  /** The sealed token hash cannot be opened (the hook secret changed since the code was made). */
  unopenable?: boolean;
  /** Where the continuation ends: the access check of the organization. */
  nextAfter?: 'home' | 'mfa';
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
  const pending: boolean[] = [];
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
        state: (options.access ??
          (options.nextAfter === 'mfa' ? 'mfa_challenge' : 'ok')) as Awaited<
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
    verifyCode: vi.fn(() => {
      events.push('verifyCode');
      const outcome = options.codeOutcome ?? 'ok';
      return Promise.resolve(
        outcome === 'ok'
          ? ({
              outcome,
              userId: USER,
              sealedTokenHash: 'v1.sealed',
              actionType: 'magiclink',
            } as const)
          : ({ outcome } as const),
      );
    }),
    openTokenHash: vi.fn((_userId: string, _sealed: string) =>
      options.unopenable ? null : 'ab12cd34'.repeat(7),
    ),
    keepSession: vi.fn(() => Promise.resolve(options.keptDays ?? 14)),
    setSessionCookieLifetime: vi.fn((value: boolean) => {
      events.push(`lifetime:${String(value)}`);
      kept.push(value);
    }),
    setKeepMarker: vi.fn((value: boolean) => {
      markers.push(value);
    }),
    setKeepPending: vi.fn((value: boolean) => {
      pending.push(value);
    }),
    auditRefused: vi.fn(() => Promise.resolve()),
    keepAlive: (work) => {
      background.push(work);
    },
  };
  return {
    deps,
    auth,
    attempt,
    limiter,
    audited,
    events,
    kept,
    markers,
    pending,
    background,
    requestOtp,
  };
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

  it("checks OUR code first, then redeems Auth's token hash, continues like a password sign-in and audits the method", async () => {
    const { deps, auth, attempt, audited, events } = setup();
    const result = await signInWithEmailedCode(deps, input);
    expect(result).toEqual({ ok: true, value: { next: 'home' } });
    expect(deps.verifyCode).toHaveBeenCalledWith(EMAIL, '482913');
    // Auth is asked with the token HASH released by the right code - never with the typed code.
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'ab12cd34'.repeat(7),
      type: 'magiclink',
    });
    expect(JSON.stringify(auth.verifyOtp.mock.calls)).not.toContain('482913');
    expect(events).toEqual(['lifetime:false', 'verifyCode', 'verifyOtp', 'succeeded']);
    expect(attempt.failed).not.toHaveBeenCalled();
    expect(audited).toEqual([
      { action: 'platform.auth.signed_in', data: { method: 'email_code', aal: 'aal1' } },
    ]);
  });

  it('hands the organization MFA policy the same decision as after a password: the authenticator app next', async () => {
    const { deps } = setup({ access: 'mfa_challenge' });
    expect(await signInWithEmailedCode(deps, input)).toEqual({ ok: true, value: { next: 'mfa' } });
  });

  it('a wrong, expired or used code: counted, the tries left on the screen, the refusal audited; Auth is not asked', async () => {
    for (const codeOutcome of ['wrong', 'none'] as const) {
      const { deps, attempt, auth } = setup({ triesIfWrong: 3, codeOutcome });
      const result = await signInWithEmailedCode(deps, input);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'SIGN_IN_CODE_INVALID', params: { tries: 3 } },
      });
      expect(attempt.failed).toHaveBeenCalledTimes(1);
      expect(deps.auditRefused).toHaveBeenCalledWith(EMAIL, false);
      expect(deps.keepSession).not.toHaveBeenCalled();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    }
  });

  it('the fifth wrong code (no tries left, or killed by the database) says the code is dead and checks are paused', async () => {
    const { deps } = setup({ triesIfWrong: 0, codeOutcome: 'wrong' });
    expect(await signInWithEmailedCode(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_LOCKED' },
    });
    expect(deps.auditRefused).toHaveBeenCalledWith(EMAIL, true);
    const killed = setup({ triesIfWrong: 3, codeOutcome: 'killed' });
    expect(await signInWithEmailedCode(killed.deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_INVALID' },
    });
    expect(killed.deps.auditRefused).toHaveBeenCalledWith(EMAIL, true);
  });

  it('code checks paused by the limiter: locked, neither the database nor Auth is asked', async () => {
    const { deps, auth } = setup({ limiterAllows: false });
    expect(await signInWithEmailedCode(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_LOCKED' },
    });
    expect(deps.verifyCode).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('a right code whose sealed token cannot be opened (the hook secret changed) is a refusal: a new code is needed', async () => {
    const { deps, auth } = setup({ unopenable: true });
    expect(await signInWithEmailedCode(deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_INVALID' },
    });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("Auth refusing the released token is a refusal; its rate limit is not the code's fault; an outage is thrown and costs no try", async () => {
    const refused = setup({ verifyOtpError: { status: 403 } });
    expect(await signInWithEmailedCode(refused.deps, input)).toMatchObject({
      ok: false,
      error: { code: 'SIGN_IN_CODE_INVALID' },
    });
    expect(refused.attempt.failed).toHaveBeenCalledTimes(1);
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
    const { deps } = setup({ codeOutcome: 'wrong' });
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

  it('ticked: the cookies are NOT persistent while the policy is unknown (L2); the session is kept once the sign-in is finished (L3)', async () => {
    const { deps, events, markers, kept, pending } = setup({ keptDays: 14 });
    expect(await signInWithEmailedCode(deps, input)).toEqual({ ok: true, value: { next: 'home' } });
    // The lifetime is chosen BEFORE Auth writes the cookies, and it is "until the browser closes".
    expect(events.indexOf('lifetime:false')).toBeLessThan(events.indexOf('verifyOtp'));
    expect(events).not.toContain('lifetime:true');
    expect(kept).toEqual([false]);
    expect(deps.keepSession).toHaveBeenCalledWith('tx');
    // The marker (which also makes the written cookies persistent) comes only with the database's yes.
    expect(markers).toEqual([false, true]);
    expect(pending).toEqual([false]);
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

  it('the second step pending (or the chooser): nothing is kept yet, the wish waits (L3)', async () => {
    const { deps, pending, markers } = setup({ nextAfter: 'mfa' });
    expect(await signInWithEmailedCode(deps, input)).toEqual({ ok: true, value: { next: 'mfa' } });
    expect(deps.keepSession).not.toHaveBeenCalled();
    expect(pending).toEqual([false, true]);
    expect(markers).toEqual([false]);
    // Not ticked: nothing waits.
    const plain = setup({ nextAfter: 'mfa' });
    await signInWithEmailedCode(plain.deps, { ...input, remember: false });
    expect(plain.pending).toEqual([false]);
  });

  it('a new sign-in forgets an earlier pending wish and the marker of the previous account', async () => {
    const { deps, markers, pending } = setup({ codeOutcome: 'wrong' });
    await signInWithEmailedCode(deps, input);
    expect(markers).toEqual([false]);
    expect(pending).toEqual([false]);
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
