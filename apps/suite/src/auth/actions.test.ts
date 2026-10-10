import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-in action validates input and hands over to platform-identity with the request's client (the
 * flow tests cover the limits, the generic answers and their timing — T-M2-11). Here: validation comes
 * first, only a platform-overwritten client address reaches the limiter, and a limiter failure stays the
 * generic internal error.
 */
const flow = vi.hoisted(() => ({
  signInWithPasswordForRequest: vi.fn(),
  selectOrganizationForRequest: vi.fn(),
  signOutForRequest: vi.fn(),
}));
const requestHeaders = vi.hoisted(() => new Map<string, string>());
vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-identity/auth', () => flow);
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));

const { signInAction } = await import('./actions');

const credentials = { email: 'someone@example.test', password: 'a long enough passphrase' };

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  requestHeaders.clear();
});

describe('signInAction (T-M2-11)', () => {
  it('passes the trusted client key (IPv6 by its /64) with the credentials', async () => {
    flow.signInWithPasswordForRequest.mockResolvedValue({ ok: true, value: { next: 'home' } });
    vi.stubEnv('VERCEL', '1');
    requestHeaders.set('x-real-ip', '2001:db8:aa:bb::1');
    await expect(signInAction(credentials)).resolves.toEqual({ ok: true, value: { next: 'home' } });
    // «تذكّر هذا المتصفح» not ticked: not remembered (opt-in, PO decision 9 Oct 2026).
    expect(flow.signInWithPasswordForRequest).toHaveBeenCalledWith(
      { ...credentials, remember: false },
      { key: '2001:db8:aa:bb::/64' },
    );
  });

  it('passes «تذكّر هذا المتصفح» through when ticked', async () => {
    flow.signInWithPasswordForRequest.mockResolvedValue({ ok: true, value: { next: 'home' } });
    await signInAction({ ...credentials, remember: true });
    expect(flow.signInWithPasswordForRequest).toHaveBeenCalledWith(
      { ...credentials, remember: true },
      { key: null },
    );
  });

  it('never takes a client-sent header as the client (spoofing): the shared key applies', async () => {
    flow.signInWithPasswordForRequest.mockResolvedValue({ ok: true, value: { next: 'home' } });
    requestHeaders.set('x-real-ip', '203.0.113.7');
    requestHeaders.set('x-forwarded-for', '198.51.100.1');
    await signInAction(credentials);
    expect(flow.signInWithPasswordForRequest).toHaveBeenCalledWith(
      { ...credentials, remember: false },
      { key: null },
    );
  });

  it('passes the generic limited answer through unchanged', async () => {
    const limited = {
      ok: false,
      error: {
        code: 'AUTH_TOO_MANY_ATTEMPTS',
        status: 429,
        messageKey: 'auth.errors.tooManyAttempts',
        expose: true,
      },
    };
    flow.signInWithPasswordForRequest.mockResolvedValue(limited);
    await expect(signInAction(credentials)).resolves.toEqual(limited);
  });

  it('fails closed with the generic internal error when the limiter cannot answer', async () => {
    flow.signInWithPasswordForRequest.mockRejectedValue(
      Object.assign(new Error('the rate limiter could not answer'), {
        name: 'RateLimiterUnavailableError',
      }),
    );
    const result = await signInAction(credentials);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('someone@example.test');
  });

  it('validates before any limit or Auth call', async () => {
    for (const input of [
      { email: 'not-an-address', password: 'x' },
      { email: credentials.email, password: '' },
      { email: credentials.email, password: 'x'.repeat(1025) },
      { ...credentials, remember: 'yes' as unknown as boolean },
      // Auth accepts ASCII addresses only: a non-ASCII spelling (İ for i) never reaches the limiter or
      // Auth (the limiter's subject guard is the second line — auth-limits.ts accountSubject).
      { email: 'm\u0130na@example.test', password: 'a long enough passphrase' },
    ]) {
      const result = await signInAction(input);
      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    }
    expect(flow.signInWithPasswordForRequest).not.toHaveBeenCalled();
  });
});
