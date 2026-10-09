import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The password-reset actions validate input and hand over to platform-identity with the request's client
 * (whose flow tests cover every Auth outcome, the constant answer and its timing, and the shared limits —
 * T-M2-11). Here: validation happens first, nothing reaches the flow or Auth on bad input, the trusted
 * client address (only) reaches the limiter, and failures stay generic.
 */
const flow = vi.hoisted(() => ({
  requestPasswordResetForRequest: vi.fn(),
  completePasswordResetForRequest: vi.fn(),
}));
const requestHeaders = vi.hoisted(() => new Map<string, string>());
vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-identity/auth', () => flow);
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));

const { completePasswordResetAction, requestPasswordResetAction } =
  await import('./password-reset');

const tokenHash = 'sample0token0hash'.padEnd(56, '0'); // shape only
const password = 'a long enough passphrase';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  requestHeaders.clear();
});

describe('requestPasswordResetAction (screen 10)', () => {
  it('hands the address and the trusted client to the flow, and answers the same every time', async () => {
    flow.requestPasswordResetForRequest.mockResolvedValue(undefined);
    vi.stubEnv('VERCEL', '1');
    requestHeaders.set('x-real-ip', '2001:db8:1:2::7');
    const first = await requestPasswordResetAction({ email: 'known@example.test', locale: 'ar' });
    requestHeaders.clear();
    const second = await requestPasswordResetAction({ email: 'nobody@example.test', locale: 'en' });
    expect(first).toEqual({ ok: true, value: { requested: true } });
    expect(second).toEqual(first);
    expect(flow.requestPasswordResetForRequest).toHaveBeenNthCalledWith(
      1,
      { email: 'known@example.test' },
      { key: '2001:db8:1:2::/64' },
    );
    // No trusted address: the shared key.
    expect(flow.requestPasswordResetForRequest).toHaveBeenNthCalledWith(
      2,
      { email: 'nobody@example.test' },
      { key: null },
    );
  });

  it('refuses a malformed address or unknown fields before any limit or Auth call', async () => {
    for (const input of [
      { email: 'not-an-address', locale: 'ar' },
      { email: `${'a'.repeat(250)}@example.test`, locale: 'ar' },
      { email: 'a@example.test', locale: 'fr' },
      { email: 'a@example.test', locale: 'ar', redirectTo: 'https://evil.example' },
    ]) {
      const result = await requestPasswordResetAction(input as never);
      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    }
    expect(flow.requestPasswordResetForRequest).not.toHaveBeenCalled();
  });
});

describe('completePasswordResetAction (screen 11)', () => {
  it('validates, then runs the reset flow with the token, the password and the client only', async () => {
    flow.completePasswordResetForRequest.mockResolvedValue({
      ok: true,
      value: { next: 'sign-in' },
    });
    await expect(
      completePasswordResetAction({ tokenHash, password, confirmPassword: password }),
    ).resolves.toEqual({ ok: true, value: { next: 'sign-in' } });
    // No trusted client address configured here: the shared key.
    expect(flow.completePasswordResetForRequest).toHaveBeenCalledWith(
      { tokenHash, password, code: undefined },
      { key: null },
    );
  });

  it("passes the authenticator app's code (T-M2-10): six digits in any script, spaces dropped", async () => {
    flow.completePasswordResetForRequest.mockResolvedValue({
      ok: true,
      value: { next: 'sign-in' },
    });
    await completePasswordResetAction({
      tokenHash,
      password,
      confirmPassword: password,
      code: '١٢٣ ٤٥٦',
    });
    expect(flow.completePasswordResetForRequest).toHaveBeenCalledWith(
      { tokenHash, password, code: '123456' },
      { key: null },
    );
    for (const code of ['12345', '1234567', 'abcdef', '12-456']) {
      const refused = await completePasswordResetAction({
        tokenHash,
        password,
        confirmPassword: password,
        code,
      });
      expect(!refused.ok && refused.error.fieldErrors?.map((e) => e.path), code).toEqual(['code']);
    }
    expect(flow.completePasswordResetForRequest).toHaveBeenCalledTimes(1);
  });

  it("passes the flow's RATE_LIMITED through (the link is not spent)", async () => {
    flow.completePasswordResetForRequest.mockResolvedValue({
      ok: false,
      error: { code: 'RATE_LIMITED', status: 429, messageKey: 'errors.rateLimited', expose: true },
    });
    const result = await completePasswordResetAction({
      tokenHash,
      password,
      confirmPassword: password,
    });
    expect(!result.ok && result.error.code).toBe('RATE_LIMITED');
  });

  it('refuses invalid input with field-error codes before the link is spent', async () => {
    const result = await completePasswordResetAction({
      tokenHash,
      password: 'short',
      confirmPassword: 'different',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(result.error)).not.toContain('short');
      expect(result.error.fieldErrors?.map((e) => e.path)).toEqual(
        expect.arrayContaining(['password']),
      );
    }
    const mismatch = await completePasswordResetAction({
      tokenHash,
      password,
      confirmPassword: `${password}!`,
    });
    expect(!mismatch.ok && mismatch.error.fieldErrors?.map((e) => e.path)).toEqual([
      'confirmPassword',
    ]);
    for (const input of [
      { password, confirmPassword: password },
      { tokenHash: 'has spaces and more', password, confirmPassword: password },
      { tokenHash: 'x'.repeat(200), password, confirmPassword: password },
      // 37 Arabic letters = 74 bytes: over bcrypt's 72-byte limit.
      { tokenHash, password: 'ب'.repeat(37), confirmPassword: 'ب'.repeat(37) },
      { tokenHash, password, confirmPassword: password, email: 'a@example.test' },
    ]) {
      const refused = await completePasswordResetAction(input as never);
      expect(!refused.ok && refused.error.code).toBe('VALIDATION_FAILED');
    }
    expect(flow.completePasswordResetForRequest).not.toHaveBeenCalled();
  });

  it('turns an unexpected failure (the limiter included) into an internal error with a correlation id only', async () => {
    for (const failure of [
      new Error(`Auth said ${tokenHash}`),
      Object.assign(new Error('the rate limiter could not answer'), {
        name: 'RateLimiterUnavailableError',
      }),
    ]) {
      flow.completePasswordResetForRequest.mockRejectedValue(failure);
      const result = await completePasswordResetAction({
        tokenHash,
        password,
        confirmPassword: password,
      });
      expect(!result.ok && result.error.code).toBe('INTERNAL_ERROR');
      expect(!result.ok && result.error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(result)).not.toContain(tokenHash);
    }
  });
});
