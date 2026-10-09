import { describe, expect, it, vi } from 'vitest';
import { AuthServiceError } from './auth-flow';
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

function requestSetup(resetPasswordForEmail: ResetForEmail | null) {
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
      await expect(
        requestPasswordReset(deps, { email: EMAIL, limited: false }),
      ).resolves.toBeUndefined();
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
    await requestPasswordReset(deps, { email: EMAIL, limited: false });
    expect(kept).toHaveLength(1);
    release?.();
    await Promise.all(kept);
  });

  it('does not ask Auth when the application limiter refused — same answer, same time', async () => {
    const resetPasswordForEmail = vi.fn<ResetForEmail>(() => Promise.resolve({ error: null }));
    const { deps, order, logWarning } = requestSetup(resetPasswordForEmail);
    await expect(
      requestPasswordReset(deps, { email: EMAIL, limited: true }),
    ).resolves.toBeUndefined();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(order).toEqual([`sleep:${String(RESET_REQUEST_ANSWER_MS)}`]);
    expect(logWarning).toHaveBeenCalledWith('password reset request limited', {
      action: 'platform.auth.request_password_reset',
      reason: 'rate_limited',
    });
  });

  it('asks Auth with the address and logs codes only — never the address', async () => {
    const resetPasswordForEmail = vi.fn<ResetForEmail>(() =>
      Promise.resolve({ error: { status: 429, code: 'over_email_send_rate_limit' } }),
    );
    const { deps, kept, logWarning } = requestSetup(resetPasswordForEmail);
    await requestPasswordReset(deps, { email: EMAIL, limited: false });
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
    await requestPasswordReset(thrown.deps, { email: EMAIL, limited: false });
    await Promise.all(thrown.kept);
    expect(thrown.logWarning).toHaveBeenCalledWith('password reset request failed', {
      action: 'platform.auth.request_password_reset',
      errorName: 'Error',
    });
    expect(JSON.stringify(thrown.logWarning.mock.calls)).not.toContain('example.test');

    const bare = requestSetup(() => Promise.resolve({ error: {} }));
    await requestPasswordReset(bare.deps, { email: EMAIL, limited: false });
    await Promise.all(bare.kept);
    expect(bare.logWarning).toHaveBeenCalledWith('password reset request not accepted by Auth', {
      action: 'platform.auth.request_password_reset',
    });

    const accepted = requestSetup(() => Promise.resolve({ error: null }));
    await requestPasswordReset(accepted.deps, { email: EMAIL, limited: false });
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
    await requestPasswordReset(throwsString.deps, { email: EMAIL, limited: false });
    await Promise.all(throwsString.kept);
    expect(throwsString.logWarning).toHaveBeenCalledWith('password reset request failed', {
      action: 'platform.auth.request_password_reset',
      errorName: 'unknown',
    });
  });
});

describe('requestPasswordReset, worker mode (T-M2-17: our notification service)', () => {
  function workerSetup(enqueue: (email: string) => Promise<void>) {
    const order: string[] = [];
    const kept: Promise<unknown>[] = [];
    const logWarning = vi.fn();
    const deps: PasswordResetRequestDeps = {
      delivery: { mode: 'worker', enqueue },
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
    await expect(
      requestPasswordReset(deps, { email: EMAIL, limited: false }),
    ).resolves.toBeUndefined();
    await Promise.all(kept);
    expect(enqueue).toHaveBeenCalledWith(EMAIL);
    expect(order).toEqual(['keepAlive', `sleep:${String(RESET_REQUEST_ANSWER_MS)}`]);
    expect(logWarning).not.toHaveBeenCalled();
  });

  it('a failed enqueue gives the same answer; the log has the class name only', async () => {
    const { deps, order, kept, logWarning } = workerSetup(() =>
      Promise.reject(new Error(`insert failed for ${EMAIL}`)),
    );
    await expect(
      requestPasswordReset(deps, { email: EMAIL, limited: false }),
    ).resolves.toBeUndefined();
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
    await requestPasswordReset(deps, { email: EMAIL, limited: false });
    expect(kept).toHaveLength(1);
    release?.();
    await Promise.all(kept);

    const limited = workerSetup(enqueue);
    await requestPasswordReset(limited.deps, { email: EMAIL, limited: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(limited.order).toEqual([`sleep:${String(RESET_REQUEST_ANSWER_MS)}`]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Complete (screen 11)

interface CompleteOptions {
  verifyError?: { status?: number; code?: string } | null;
  verifyData?: unknown;
  updateError?: { status?: number; code?: string; reasons?: unknown } | null;
  updateThrows?: boolean;
  signOutError?: unknown;
  signOutThrows?: boolean;
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
                user: { id: USER },
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
  };
  const logInfo = vi.fn();
  const logWarning = vi.fn();
  const endBrowserSession = vi.fn(() => {
    calls.push('endBrowserSession');
    return Promise.resolve();
  });
  const deps: PasswordResetDeps = {
    client: { auth },
    logInfo,
    logWarning,
    endBrowserSession,
  };
  return { deps, auth, calls, logInfo, logWarning };
}

const input = { tokenHash: TOKEN_HASH, password: PASSWORD };

describe('completePasswordReset (FR-IAM-13)', () => {
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
