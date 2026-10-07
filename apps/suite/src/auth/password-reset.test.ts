import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The password-reset actions validate input, apply the application limits and hand over to
 * platform-identity (whose flow tests cover every Auth outcome, the constant answer and its timing).
 * Here: validation happens first, nothing reaches the flow or Auth on bad input, a limited request gets
 * the same answer, and a limited submission never spends the link.
 */
const flow = vi.hoisted(() => ({
  requestPasswordResetForRequest: vi.fn(),
  completePasswordResetForRequest: vi.fn(),
}));
const limits = vi.hoisted(() => ({
  allowRequest: vi.fn((_email: string, _client: string) => true),
  allowCompletion: vi.fn((_client: string) => true),
}));
const requestHeaders = vi.hoisted(() => new Map<string, string>());
vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-identity/auth', () => flow);
vi.mock('../lib/reset-limits', () => ({ resetLimiter: limits }));
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
  limits.allowRequest.mockImplementation(() => true);
  limits.allowCompletion.mockImplementation(() => true);
});

describe('requestPasswordResetAction (screen 10)', () => {
  it('answers the same whether or not the request was limited (the flow decides nothing visible)', async () => {
    flow.requestPasswordResetForRequest.mockResolvedValue(undefined);
    vi.stubEnv('VERCEL', '1');
    requestHeaders.set('x-real-ip', '203.0.113.7');
    const allowed = await requestPasswordResetAction({ email: 'known@example.test', locale: 'ar' });
    limits.allowRequest.mockImplementation(() => false);
    const limited = await requestPasswordResetAction({
      email: 'nobody@example.test',
      locale: 'en',
    });
    expect(allowed).toEqual({ ok: true, value: { requested: true } });
    expect(limited).toEqual(allowed);
    expect(limits.allowRequest).toHaveBeenNthCalledWith(1, 'known@example.test', '203.0.113.7');
    expect(flow.requestPasswordResetForRequest).toHaveBeenNthCalledWith(1, {
      email: 'known@example.test',
      limited: false,
    });
    expect(flow.requestPasswordResetForRequest).toHaveBeenNthCalledWith(2, {
      email: 'nobody@example.test',
      limited: true,
    });
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
    expect(limits.allowRequest).not.toHaveBeenCalled();
    expect(flow.requestPasswordResetForRequest).not.toHaveBeenCalled();
  });
});

describe('completePasswordResetAction (screen 11)', () => {
  it('validates, then runs the reset flow with the token and the password only', async () => {
    flow.completePasswordResetForRequest.mockResolvedValue({
      ok: true,
      value: { next: 'sign-in' },
    });
    await expect(
      completePasswordResetAction({ tokenHash, password, confirmPassword: password }),
    ).resolves.toEqual({ ok: true, value: { next: 'sign-in' } });
    expect(flow.completePasswordResetForRequest).toHaveBeenCalledWith({ tokenHash, password });
    // No trusted client address configured here: the shared key.
    expect(limits.allowCompletion).toHaveBeenCalledWith('unknown');
  });

  it('answers RATE_LIMITED without spending the link when the client is limited', async () => {
    limits.allowCompletion.mockImplementation(() => false);
    const result = await completePasswordResetAction({
      tokenHash,
      password,
      confirmPassword: password,
    });
    expect(!result.ok && result.error.code).toBe('RATE_LIMITED');
    expect(flow.completePasswordResetForRequest).not.toHaveBeenCalled();
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
    expect(limits.allowCompletion).not.toHaveBeenCalled();
    expect(flow.completePasswordResetForRequest).not.toHaveBeenCalled();
  });

  it('turns an unexpected failure into an internal error with a correlation id only', async () => {
    flow.completePasswordResetForRequest.mockRejectedValue(new Error(`Auth said ${tokenHash}`));
    const result = await completePasswordResetAction({
      tokenHash,
      password,
      confirmPassword: password,
    });
    expect(!result.ok && result.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result)).not.toContain(tokenHash);
  });
});
