import { describe, expect, it, vi } from 'vitest';
import { AuthServiceError } from './auth-flow';
import { RateLimiterUnavailableError } from './auth-limits';
import {
  type PasswordResetDeps,
  type PasswordResetRequestDeps,
  RESET_REQUEST_ANSWER_MS,
  type RecoveryClientLike,
  completePasswordReset,
  readPasswordResetDelivery,
  requestPasswordReset,
} from './password-reset';

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN_HASH = 'sample0token0hash'.padEnd(56, '0'); // shape only
const EMAIL = 'reset.me@example.test';
const PASSWORD = 'A-new-password-for-reset';

// ---------------------------------------------------------------------------------------------------
// Delivery setting (T-M2-17)

describe('readPasswordResetDelivery (PASSWORD_RESET_DELIVERY)', () => {
  it("defaults to Auth's own mailer: unset, empty or blank", () => {
    expect(readPasswordResetDelivery({})).toBe('auth');
    expect(readPasswordResetDelivery({ PASSWORD_RESET_DELIVERY: '' })).toBe('auth');
    expect(readPasswordResetDelivery({ PASSWORD_RESET_DELIVERY: '  ' })).toBe('auth');
    expect(readPasswordResetDelivery({ PASSWORD_RESET_DELIVERY: 'auth' })).toBe('auth');
  });

  it('worker: our notification service', () => {
    expect(readPasswordResetDelivery({ PASSWORD_RESET_DELIVERY: ' worker ' })).toBe('worker');
  });

  it('refuses any other value (a configuration error, never a silent fallback)', () => {
    for (const value of ['Worker', 'smtp', 'none', 'true']) {
      expect(() => readPasswordResetDelivery({ PASSWORD_RESET_DELIVERY: value })).toThrow(
        'PASSWORD_RESET_DELIVERY must be "auth" or "worker"',
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Request (screen 10)

type ResetForEmail = RecoveryClientLike['auth']['resetPasswordForEmail'];

/** The shared limiter's answer: allowed, limited, or unavailable (an Error). */
function limiter(answer: boolean | Error = true) {
  return vi.fn((_email: string) =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
  );
}

function requestSetup(
  resetPasswordForEmail: ResetForEmail | null,
  allowed: boolean | Error = true,
) {
  const order: string[] = [];
  const kept: Promise<unknown>[] = [];
  const logWarning = vi.fn();
  const deps: PasswordResetRequestDeps = {
    delivery: {
      mode: 'auth',
      client: resetPasswordForEmail
        ? ({ auth: { resetPasswordForEmail } } as unknown as RecoveryClientLike)
        : null,
    },
    allowRequest: limiter(allowed),
    logWarning,
    sleep: vi.fn((ms: number) => {
      order.push(`sleep:${String(ms)}`);
      return Promise.resolve();
    }),
    keepAlive: vi.fn((work: Promise<unknown>) => {
      order.push('keepAlive');
      kept.push(work);
    }),
  };
  return { deps, order, kept, logWarning };
}

describe('requestPasswordReset (no account enumeration)', () => {
  const outcomes: [string, ResetForEmail | null][] = [
    ['link sent (account exists)', () => Promise.resolve({ error: null })],
    ['unknown address (Auth answers 200 too)', () => Promise.resolve({ error: null })],
    [
      'repeat within a minute (Auth: 429 for existing accounts only)',
      () => Promise.resolve({ error: { status: 429, code: 'over_email_send_rate_limit' } }),
    ],
    ['Auth failed to send', () => Promise.resolve({ error: { status: 500 } })],
    ['Auth unreachable (thrown)', () => Promise.reject(new TypeError('fetch failed'))],
    ['Auth not configured', null],
  ];

  it.each(outcomes)(
    'answers the same after the same time: %s',
    async (_name, resetPasswordForEmail) => {
      const { deps, order, kept } = requestSetup(resetPasswordForEmail);
      // Same resolved value (undefined) — the action turns it into one fixed answer.
      await expect(requestPasswordReset(deps, { email: EMAIL })).resolves.toBeUndefined();
      // The Auth call is handed over first (it may outlive the answer), then the fixed wait.
      expect(order).toEqual(['keepAlive', `sleep:${String(RESET_REQUEST_ANSWER_MS)}`]);
      // The kept work never rejects (nothing reaches the error reporter with request data).
      await expect(Promise.all(kept)).resolves.toBeDefined();
    },
  );

  it('never waits for Auth: the answer does not depend on how long Auth takes', async () => {
    let release: (() => void) | undefined;
    const slow: ResetForEmail = () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ error: null });
        };
      });
    const { deps, kept } = requestSetup(slow);
    await requestPasswordReset(deps, { email: EMAIL });
    expect(kept).toHaveLength(1);
    release?.();
    await Promise.all(kept);
  });

  it.each([
    ['limited', false],
    ['the limiter could not answer (fail closed)', new RateLimiterUnavailableError()],
  ] as const)(
    'does not ask Auth when %s — same answer, same time, same steps',
    async (_name, allowed) => {
      const resetPasswordForEmail = vi.fn<ResetForEmail>(() => Promise.resolve({ error: null }));
      const { deps, order, kept, logWarning } = requestSetup(resetPasswordForEmail, allowed);
      await expect(requestPasswordReset(deps, { email: EMAIL })).resolves.toBeUndefined();
      // The limiter runs in the background too: the answer cannot tell a limited request apart.
      expect(order).toEqual(['keepAlive', `sleep:${String(RESET_REQUEST_ANSWER_MS)}`]);
      await expect(Promise.all(kept)).resolves.toBeDefined();
      expect(deps.allowRequest).toHaveBeenCalledWith(EMAIL);
      expect(resetPasswordForEmail).not.toHaveBeenCalled();
      expect(logWarning).toHaveBeenCalledWith('password reset request limited', {
        action: 'platform.auth.request_password_reset',
        reason: 'rate_limited',
      });
    },
  );

  it('asks Auth with the address and logs codes only — never the address', async () => {
    const resetPasswordForEmail = vi.fn<ResetForEmail>(() =>
      Promise.resolve({ error: { status: 429, code: 'over_email_send_rate_limit' } }),
    );
    const { deps, kept, logWarning } = requestSetup(resetPasswordForEmail);
    await requestPasswordReset(deps, { email: EMAIL });
    await Promise.all(kept);
    expect(resetPasswordForEmail).toHaveBeenCalledWith(EMAIL);
    expect(logWarning).toHaveBeenCalledWith('password reset request not accepted by Auth', {
      action: 'platform.auth.request_password_reset',
      status: 429,
      errorCode: 'over_email_send_rate_limit',
    });
    expect(JSON.stringify(logWarning.mock.calls)).not.toContain('example.test');
  });

  it('logs a thrown error by class name only, and nothing when Auth accepted', async () => {
    const thrown = requestSetup(() =>
      Promise.reject(new Error(`could not reach Auth for ${EMAIL}`)),
    );
    await requestPasswordReset(thrown.deps, { email: EMAIL });
    await Promise.all(thrown.kept);
    expect(thrown.logWarning).toHaveBeenCalledWith('password reset request failed', {
      action: 'platform.auth.request_password_reset',
      errorName: 'Error',
    });
    expect(JSON.stringify(thrown.logWarning.mock.calls)).not.toContain('example.test');

    const bare = requestSetup(() => Promise.resolve({ error: {} }));
    await requestPasswordReset(bare.deps, { email: EMAIL });
    await Promise.all(bare.kept);
    expect(bare.logWarning).toHaveBeenCalledWith('password reset request not accepted by Auth', {
      action: 'platform.auth.request_password_reset',
    });

    const accepted = requestSetup(() => Promise.resolve({ error: null }));
    await requestPasswordReset(accepted.deps, { email: EMAIL });
    await Promise.all(accepted.kept);
    expect(accepted.logWarning).not.toHaveBeenCalled();

    const throwsString = requestSetup(() => Promise.reject(new Error('x')));
    throwsString.deps = {
      ...throwsString.deps,
      delivery: {
        mode: 'auth',
        client: {
          auth: {
            resetPasswordForEmail: () => {
              throw 'not an error'; // eslint-disable-line @typescript-eslint/only-throw-error
            },
          },
        } as unknown as RecoveryClientLike,
      },
    };
    await requestPasswordReset(throwsString.deps, { email: EMAIL });
    await Promise.all(throwsString.kept);
    expect(throwsString.logWarning).toHaveBeenCalledWith('password reset request failed', {
      action: 'platform.auth.request_password_reset',
      errorName: 'unknown',
    });
  });
});

describe('requestPasswordReset, worker mode (T-M2-17: our notification service)', () => {
  function workerSetup(enqueue: (email: string) => Promise<void>, allowed: boolean | Error = true) {
    const order: string[] = [];
    const kept: Promise<unknown>[] = [];
    const logWarning = vi.fn();
    const deps: PasswordResetRequestDeps = {
      delivery: { mode: 'worker', enqueue },
      allowRequest: limiter(allowed),
      logWarning,
      sleep: vi.fn((ms: number) => {
        order.push(`sleep:${String(ms)}`);
        return Promise.resolve();
      }),
      keepAlive: vi.fn((work: Promise<unknown>) => {
        order.push('keepAlive');
        kept.push(work);
      }),
    };
    return { deps, order, kept, logWarning };
  }

  it('queues the typed address unconditionally, then answers after the same fixed time', async () => {
    const enqueue = vi.fn(() => Promise.resolve());
    const { deps, order, kept, logWarning } = workerSetup(enqueue);
    await expect(requestPasswordReset(deps, { email: EMAIL })).resolves.toBeUndefined();
    await Promise.all(kept);
    expect(enqueue).toHaveBeenCalledWith(EMAIL);
    expect(order).toEqual(['keepAlive', `sleep:${String(RESET_REQUEST_ANSWER_MS)}`]);
    expect(logWarning).not.toHaveBeenCalled();
  });

  it('a failed enqueue gives the same answer; the log has the class name only', async () => {
    const { deps, order, kept, logWarning } = workerSetup(() =>
      Promise.reject(new Error(`insert failed for ${EMAIL}`)),
    );
    await expect(requestPasswordReset(deps, { email: EMAIL })).resolves.toBeUndefined();
    await expect(Promise.all(kept)).resolves.toBeDefined();
    expect(order).toEqual(['keepAlive', `sleep:${String(RESET_REQUEST_ANSWER_MS)}`]);
    expect(logWarning).toHaveBeenCalledWith('password reset request could not be queued', {
      action: 'platform.auth.request_password_reset',
      reason: 'enqueue_failed',
      errorName: 'Error',
    });
    expect(JSON.stringify(logWarning.mock.calls)).not.toContain('example.test');
  });

  it('never waits for the queue, and queues nothing when the limiter refused', async () => {
    let release: (() => void) | undefined;
    const enqueue = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { deps, kept } = workerSetup(enqueue);
    await requestPasswordReset(deps, { email: EMAIL });
    expect(kept).toHaveLength(1);
    release?.();
    await Promise.all(kept);

    const limited = workerSetup(enqueue, false);
    await requestPasswordReset(limited.deps, { email: EMAIL });
    await Promise.all(limited.kept);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(limited.order).toEqual(['keepAlive', `sleep:${String(RESET_REQUEST_ANSWER_MS)}`]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Complete (screen 11)

interface CompleteOptions {
  /** The shared limiter's answer for new-password submissions (default: allowed). */
  allowed?: boolean | Error;
  verifyError?: { status?: number; code?: string } | null;
  verifyData?: unknown;
  updateError?: { status?: number; code?: string; reasons?: unknown } | null;
  updateThrows?: boolean;
  signOutError?: unknown;
  signOutThrows?: boolean;
  /** The account's factors as Auth lists them (T-M2-10). */
  factors?: { id: string; factor_type: string; status: string }[];
  listError?: { status?: number; code?: string };
  challengeError?: { status?: number; code?: string };
}

function completeSetup(options: CompleteOptions = {}) {
  const calls: string[] = [];
  const auth = {
    resetPasswordForEmail: vi.fn(),
    verifyOtp: vi.fn((params: { type: 'recovery'; token_hash: string }) => {
      calls.push(`verifyOtp:${params.type}`);
      if (options.verifyError) return Promise.resolve({ data: {}, error: options.verifyError });
      return Promise.resolve({
        data:
          options.verifyData === undefined
            ? {
                user: { id: USER, email: EMAIL },
                session: { access_token: 'access-otp', refresh_token: 'refresh-otp' },
              }
            : options.verifyData,
        error: null,
      });
    }),
    updateUser: vi.fn((attributes: { password: string }) => {
      calls.push(`updateUser:${attributes.password === PASSWORD ? 'password' : 'other'}`);
      if (options.updateThrows) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve({ error: options.updateError ?? null });
    }),
    signOut: vi.fn((o: { scope: string }) => {
      calls.push(`signOut:${o.scope}`);
      if (options.signOutThrows) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve({ error: options.signOutError ?? null });
    }),
    mfa: {
      listFactors: vi.fn(() =>
        Promise.resolve(
          options.listError
            ? { data: null, error: options.listError }
            : { data: { all: options.factors ?? [] }, error: null },
        ),
      ),
      challengeAndVerify: vi.fn((params: { factorId: string; code: string }) => {
        calls.push(`code:${params.factorId}`);
        return Promise.resolve({ data: {}, error: options.challengeError ?? null });
      }),
    },
  };
  const logInfo = vi.fn();
  const logWarning = vi.fn();
  const endBrowserSession = vi.fn(() => {
    calls.push('endBrowserSession');
    return Promise.resolve();
  });
  const unlockSignIn = vi.fn((email: string) => {
    calls.push(`unlock:${email === EMAIL ? 'account' : 'other'}`);
    return Promise.resolve();
  });
  const deps: PasswordResetDeps = {
    client: { auth },
    allowAttempt: vi.fn(() =>
      options.allowed instanceof Error
        ? Promise.reject(options.allowed)
        : Promise.resolve(options.allowed ?? true),
    ),
    unlockSignIn,
    logInfo,
    logWarning,
    endBrowserSession,
  };
  return { deps, auth, calls, logInfo, logWarning, unlockSignIn };
}

const input = { tokenHash: TOKEN_HASH, password: PASSWORD };

describe('completePasswordReset (FR-IAM-13)', () => {
  it('limits new-password submissions per client before the single-use link is spent (T-M2-11)', async () => {
    const { deps, auth, unlockSignIn } = completeSetup({ allowed: false });
    const result = await completePasswordReset(deps, input);
    expect(result).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(unlockSignIn).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter cannot answer: the link is not spent', async () => {
    const { deps, auth } = completeSetup({ allowed: new RateLimiterUnavailableError() });
    await expect(completePasswordReset(deps, input)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('counts malformed submissions too, and unlocks nothing when the password was not changed', async () => {
    const malformed = completeSetup();
    await completePasswordReset(malformed.deps, { ...input, tokenHash: 'x' });
    expect(malformed.deps.allowAttempt).toHaveBeenCalled();
    for (const options of [
      { verifyError: { status: 403, code: 'otp_expired' } },
      { updateError: { status: 422, code: 'weak_password' } },
    ]) {
      const { deps, unlockSignIn } = completeSetup(options);
      await completePasswordReset(deps, input);
      expect(unlockSignIn).not.toHaveBeenCalled();
    }
    // An answer without the account's e-mail: the reset succeeds, nothing to unlock.
    const noEmail = completeSetup({
      verifyData: { user: { id: USER }, session: { access_token: 'a', refresh_token: 'r' } },
    });
    expect((await completePasswordReset(noEmail.deps, input)).ok).toBe(true);
    expect(noEmail.unlockSignIn).not.toHaveBeenCalled();
  });

  it('verifies the link, sets the password, ends every session, then sends to sign-in — in that order', async () => {
    const { deps, auth, calls, logInfo } = completeSetup();
    expect(await completePasswordReset(deps, input)).toEqual({
      ok: true,
      value: { next: 'sign-in' },
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: TOKEN_HASH });
    expect(calls).toEqual([
      'verifyOtp:recovery',
      'updateUser:password',
      'signOut:global',
      // The owner proved control of the mailbox: the account's sign-in lock ends (T-M2-11).
      'unlock:account',
      'endBrowserSession',
    ]);
    // Security event with the user id only: no token, password or e-mail.
    expect(logInfo).toHaveBeenCalledWith('password reset', {
      action: 'platform.auth.password_reset',
      outcome: 'success',
      entityType: 'auth_user',
      entityId: USER,
    });
    const logged = JSON.stringify(logInfo.mock.calls);
    expect(logged).not.toContain(TOKEN_HASH);
    expect(logged).not.toContain(PASSWORD);
  });

  it('worker mode: queues the "password changed" notice for the account after the sessions ended', async () => {
    const { deps, calls } = completeSetup();
    const queuePasswordChangedNotice = vi.fn((userId: string) => {
      calls.push(`notice:${userId}`);
      return Promise.resolve();
    });
    const result = await completePasswordReset({ ...deps, queuePasswordChangedNotice }, input);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'verifyOtp:recovery',
      'updateUser:password',
      'signOut:global',
      'unlock:account',
      `notice:${USER}`,
      'endBrowserSession',
    ]);
  });

  it('worker mode: a notice that cannot be queued never fails the reset (a code is logged)', async () => {
    const { deps, logWarning } = completeSetup();
    const queuePasswordChangedNotice = vi.fn(() =>
      Promise.reject(new Error('database down for reset.me@example.test')),
    );
    const result = await completePasswordReset({ ...deps, queuePasswordChangedNotice }, input);
    expect(result).toEqual({ ok: true, value: { next: 'sign-in' } });
    expect(logWarning).toHaveBeenCalledWith('password changed notice could not be queued', {
      action: 'platform.auth.password_reset',
      reason: 'notice_not_queued',
      errorName: 'Error',
      entityType: 'auth_user',
      entityId: USER,
    });
    expect(JSON.stringify(logWarning.mock.calls)).not.toContain('example.test');
  });

  it('worker mode: no notice when the password was not changed', async () => {
    const queuePasswordChangedNotice = vi.fn(() => Promise.resolve());
    for (const options of [
      { verifyError: { status: 403, code: 'otp_expired' } },
      { updateError: { status: 422, code: 'same_password' } },
    ]) {
      const { deps } = completeSetup(options);
      const result = await completePasswordReset({ ...deps, queuePasswordChangedNotice }, input);
      expect(result.ok).toBe(false);
    }
    expect(queuePasswordChangedNotice).not.toHaveBeenCalled();
  });

  it('still succeeds when the sessions could not be ended (logged; Auth ended the others itself)', async () => {
    for (const options of [{ signOutError: new Error('auth down') }, { signOutThrows: true }]) {
      const { deps, logWarning } = completeSetup(options);
      const result = await completePasswordReset(deps, input);
      expect(result.ok).toBe(true);
      expect(logWarning).toHaveBeenCalledWith(
        'could not end the sessions of the account after a password reset',
        { action: 'platform.auth.password_reset', entityType: 'auth_user', entityId: USER },
      );
    }
  });

  it('maps an expired, used, unknown link or a banned account to one state — the password is untouched', async () => {
    const cases: CompleteOptions[] = [
      { verifyError: { status: 403, code: 'otp_expired' } },
      { verifyError: { status: 403, code: 'user_banned' } },
      { verifyError: { status: 400, code: 'validation_failed' } },
      { verifyError: { status: 404 } },
    ];
    for (const options of cases) {
      const { deps, auth } = completeSetup(options);
      const result = await completePasswordReset(deps, input);
      expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_LINK_INVALID');
      expect(auth.updateUser).not.toHaveBeenCalled();
    }
  });

  it('ends a session it cannot use (no tokens or no user in the answer)', async () => {
    for (const verifyData of [
      { user: { id: USER }, session: null },
      { user: null, session: { access_token: 'a', refresh_token: 'r' } },
      null,
    ]) {
      const { deps, auth, calls } = completeSetup({ verifyData });
      const result = await completePasswordReset(deps, input);
      expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_LINK_INVALID');
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(calls).toEqual(['verifyOtp:recovery', 'signOut:local']);
    }
  });

  it('never asks Auth about a malformed token', async () => {
    const { deps, auth } = completeSetup();
    for (const tokenHash of [
      '',
      'short',
      'x'.repeat(129),
      'abc def ghi jkl mno',
      '../../etc/passwd!',
    ]) {
      const result = await completePasswordReset(deps, { tokenHash, password: PASSWORD });
      expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_LINK_INVALID');
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('maps rate limits and Auth outages of the link check (the link is not used up then)', async () => {
    for (const verifyError of [{ status: 429 }, { status: 400, code: 'over_request_rate_limit' }]) {
      const { deps } = completeSetup({ verifyError });
      const result = await completePasswordReset(deps, input);
      expect(!result.ok && result.error.code).toBe('RATE_LIMITED');
    }
    for (const verifyError of [{ status: 500 }, {}, { status: 0 }]) {
      const { deps } = completeSetup({ verifyError });
      await expect(completePasswordReset(deps, input)).rejects.toBeInstanceOf(AuthServiceError);
    }
  });

  it('after a refused password: ends the recovery session and asks for a new link, naming the reason', async () => {
    const cases: [NonNullable<CompleteOptions['updateError']>, string][] = [
      [{ status: 422, code: 'same_password' }, 'PASSWORD_RESET_SAME_PASSWORD'],
      [{ status: 422, code: 'weak_password', reasons: ['length'] }, 'PASSWORD_RESET_WEAK_PASSWORD'],
      [{ status: 422, code: 'weak_password' }, 'PASSWORD_RESET_WEAK_PASSWORD'],
      [
        { status: 422, code: 'weak_password', reasons: ['characters', 'pwned'] },
        'PASSWORD_RESET_BREACHED_PASSWORD',
      ],
      [{ status: 422, code: 'validation_failed' }, 'PASSWORD_RESET_PASSWORD_REJECTED'],
      [{ status: 429 }, 'PASSWORD_RESET_PASSWORD_REJECTED'],
      [{ status: 401 }, 'PASSWORD_RESET_PASSWORD_REJECTED'],
    ];
    for (const [updateError, code] of cases) {
      const { deps, calls, logInfo, logWarning } = completeSetup({ updateError });
      const result = await completePasswordReset(deps, input);
      expect(!result.ok && result.error.code).toBe(code);
      // Local scope: only the recovery session; the account's other sessions are not touched.
      expect(calls).toEqual(['verifyOtp:recovery', 'updateUser:password', 'signOut:local']);
      expect(logInfo).not.toHaveBeenCalled();
      expect(logWarning).toHaveBeenCalledWith(
        'password reset: Auth refused the new password',
        expect.objectContaining({ action: 'platform.auth.password_reset' }),
      );
    }
  });

  it('ends the recovery session before an Auth outage while setting the password surfaces', async () => {
    const outage = completeSetup({ updateError: { status: 503 } });
    await expect(completePasswordReset(outage.deps, input)).rejects.toBeInstanceOf(
      AuthServiceError,
    );
    expect(outage.calls).toEqual(['verifyOtp:recovery', 'updateUser:password', 'signOut:local']);

    const thrown = completeSetup({ updateThrows: true });
    await expect(completePasswordReset(thrown.deps, input)).rejects.toBeInstanceOf(TypeError);
    expect(thrown.calls).toEqual(['verifyOtp:recovery', 'updateUser:password', 'signOut:local']);

    const noSignOut = completeSetup({
      updateError: { status: 422, code: 'same_password' },
      signOutError: new Error('down'),
    });
    await completePasswordReset(noSignOut.deps, input);
    expect(noSignOut.logWarning).toHaveBeenCalledWith(
      'could not end the recovery session after a refused password',
      { action: 'platform.auth.password_reset', entityType: 'auth_user', entityId: USER },
    );
  });

  it('is not configured without Auth', async () => {
    const { deps } = completeSetup();
    const result = await completePasswordReset({ ...deps, client: null }, input);
    expect(!result.ok && result.error.code).toBe('NOT_CONFIGURED');
  });
});

describe("completePasswordReset: strictest rule of the account's organizations (T-M2-10)", () => {
  it("asks with the recovery session's token; a shorter password ends the recovery session unchanged", async () => {
    const { deps, calls, logWarning } = completeSetup();
    const passwordMinLength = vi.fn(() => Promise.resolve(30));
    const result = await completePasswordReset({ ...deps, passwordMinLength }, input);
    expect(!result.ok && result.error).toMatchObject({
      code: 'PASSWORD_RESET_TOO_SHORT',
      params: { min: 30 },
    });
    expect(passwordMinLength).toHaveBeenCalledWith('access-otp');
    expect(calls).toEqual(['verifyOtp:recovery', 'signOut:local']);
    expect(JSON.stringify(logWarning.mock.calls)).not.toContain(PASSWORD);
  });

  it("a long enough password, or an unknown rule (Auth's 12 apply), goes on", async () => {
    for (const min of [24, null]) {
      const { deps, calls } = completeSetup();
      const result = await completePasswordReset(
        { ...deps, passwordMinLength: () => Promise.resolve(min) },
        input,
      );
      expect(result.ok).toBe(true);
      expect(calls).toContain('updateUser:password');
    }
  });

  it('ends the recovery session when the rule cannot be read (then the error surfaces)', async () => {
    const { deps, calls } = completeSetup();
    await expect(
      completePasswordReset(
        { ...deps, passwordMinLength: () => Promise.reject(new Error('db down')) },
        input,
      ),
    ).rejects.toThrow('db down');
    expect(calls).toEqual(['verifyOtp:recovery', 'signOut:local']);
  });
});

describe('completePasswordReset for an account with an authenticator app (T-M2-10)', () => {
  const app = { id: 'f-app', factor_type: 'totp', status: 'verified' };
  const CODE = '123456';

  it('passes the code on the recovery session first (Auth wants AAL2 to set the password)', async () => {
    const { deps, calls, auth } = completeSetup({
      factors: [{ id: 'f-old', factor_type: 'totp', status: 'unverified' }, app],
    });
    expect(await completePasswordReset(deps, { ...input, code: CODE })).toEqual({
      ok: true,
      value: { next: 'sign-in' },
    });
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-app', code: CODE });
    expect(calls).toEqual([
      'verifyOtp:recovery',
      'code:f-app',
      'updateUser:password',
      'signOut:global',
      'endBrowserSession',
    ]);
  });

  it('an account without an app ignores a code', async () => {
    const { deps, calls } = completeSetup({ factors: [] });
    expect((await completePasswordReset(deps, { ...input, code: CODE })).ok).toBe(true);
    expect(calls).not.toContain('code:f-app');
  });

  it('no code: the link is used up, the recovery session ends, a new link is asked for', async () => {
    const { deps, calls, auth } = completeSetup({ factors: [app] });
    const result = await completePasswordReset(deps, input);
    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_CODE_REQUIRED');
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(calls).toEqual(['verifyOtp:recovery', 'signOut:local']);
  });

  it('a wrong code: refused with one answer, logged without the code (review M3)', async () => {
    const { deps, calls, logWarning } = completeSetup({
      factors: [app],
      challengeError: { status: 422, code: 'mfa_verification_failed' },
    });
    const result = await completePasswordReset(deps, { ...input, code: '000000' });
    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_CODE_INVALID');
    expect(calls).toEqual(['verifyOtp:recovery', 'code:f-app', 'signOut:local']);
    expect(logWarning).toHaveBeenCalledWith('password reset: authenticator code refused', {
      action: 'platform.auth.password_reset',
      outcome: 'failure',
      errorCode: 'PASSWORD_RESET_CODE_INVALID',
    });
    expect(JSON.stringify(logWarning.mock.calls)).not.toContain('000000');
  });

  it('rate limits and outages of the code check; Auth asking for AAL2 anyway', async () => {
    const limited = completeSetup({ factors: [app], challengeError: { status: 429 } });
    const r1 = await completePasswordReset(limited.deps, { ...input, code: CODE });
    expect(!r1.ok && r1.error.code).toBe('RATE_LIMITED');
    const down = completeSetup({ factors: [app], challengeError: { status: 503 } });
    await expect(completePasswordReset(down.deps, { ...input, code: CODE })).rejects.toBeInstanceOf(
      AuthServiceError,
    );
    expect(down.calls).toContain('signOut:local');
    const listDown = completeSetup({ listError: { status: 500 } });
    await expect(completePasswordReset(listDown.deps, input)).rejects.toBeInstanceOf(
      AuthServiceError,
    );
    expect(listDown.calls).toEqual(['verifyOtp:recovery', 'signOut:local']);
    const listRefused = completeSetup({ listError: { status: 403 } });
    const r2 = await completePasswordReset(listRefused.deps, input);
    expect(!r2.ok && r2.error.code).toBe('PASSWORD_RESET_LINK_INVALID');
    const aal = completeSetup({ updateError: { status: 401, code: 'insufficient_aal' } });
    const r3 = await completePasswordReset(aal.deps, input);
    expect(!r3.ok && r3.error.code).toBe('PASSWORD_RESET_CODE_REQUIRED');
  });
});
