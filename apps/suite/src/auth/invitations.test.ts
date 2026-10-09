import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The invitation actions only validate input and hand over to platform-identity (whose flow tests
 * cover every outcome with mocked helpers). Here: validation happens first, nothing reaches the flow
 * or Auth on bad input.
 */
const flow = vi.hoisted(() => ({
  acceptInvitationWithNewAccountForRequest: vi.fn(),
  acceptInvitationWithPasswordForRequest: vi.fn(),
  acceptInvitationAsSignedInUserForRequest: vi.fn(),
  lookupInvitationLinkForRequest: vi.fn(),
}));
const requestHeaders = vi.hoisted(() => new Map<string, string>());
vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-identity/auth', () => flow);
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));

const {
  acceptInvitationAction,
  acceptInvitationAsSignedInUser,
  acceptInvitationWithSignInAction,
  lookupInvitationAction,
} = await import('./invitations');

const token = 'sample-invitation-token'.padEnd(43, '0'); // shape only
const form = {
  token,
  displayNameAr: 'نورة',
  password: 'a long enough passphrase',
  confirmPassword: 'a long enough passphrase',
  privacyAcknowledged: true as const,
};

// No trusted client address in these tests: every visitor shares one key (T-M2-11).
const SHARED = { key: null };

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  requestHeaders.clear();
});

describe('acceptInvitationAction', () => {
  it('validates, then runs the new-account flow (sign-up through the public Auth API)', async () => {
    flow.acceptInvitationWithNewAccountForRequest.mockResolvedValue({
      ok: true,
      value: { next: 'home' },
    });
    await expect(acceptInvitationAction(form)).resolves.toEqual({
      ok: true,
      value: { next: 'home' },
    });
    expect(flow.acceptInvitationWithNewAccountForRequest).toHaveBeenCalledWith(
      {
        token,
        password: form.password,
        displayNameAr: 'نورة',
        displayNameEn: undefined,
      },
      SHARED,
    );
  });

  it('passes the trusted client address (sign-ups are limited per client, T-M2-11)', async () => {
    flow.acceptInvitationWithNewAccountForRequest.mockResolvedValue({
      ok: false,
      error: { code: 'RATE_LIMITED', status: 429, messageKey: 'errors.rateLimited', expose: true },
    });
    vi.stubEnv('VERCEL', '1');
    requestHeaders.set('x-real-ip', '203.0.113.7');
    const result = await acceptInvitationAction(form);
    expect(result).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect(flow.acceptInvitationWithNewAccountForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ token }),
      { key: '203.0.113.7' },
    );
  });

  it('refuses invalid input with field errors (codes only) before any flow or Auth call', async () => {
    const result = await acceptInvitationAction({
      ...form,
      password: 'short',
      confirmPassword: 'different',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const paths = result.ok ? [] : (result.error.fieldErrors ?? []).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['password', 'confirmPassword']));
    expect(JSON.stringify(result)).not.toContain('short');
    expect(flow.acceptInvitationWithNewAccountForRequest).not.toHaveBeenCalled();
  });

  it('turns an unexpected failure into INTERNAL_ERROR with a correlation id', async () => {
    flow.acceptInvitationWithNewAccountForRequest.mockRejectedValue(new Error('db down'));
    const result = await acceptInvitationAction(form);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(result.ok ? '' : result.error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('sign-in-to-accept and signed-in actions', () => {
  it('pass the validated token (and password) to the flow', async () => {
    flow.acceptInvitationWithPasswordForRequest.mockResolvedValue({
      ok: true,
      value: { next: 'home' },
    });
    flow.acceptInvitationAsSignedInUserForRequest.mockResolvedValue({
      ok: true,
      value: { next: 'home' },
    });
    await acceptInvitationWithSignInAction({ token, password: 'secret' });
    expect(flow.acceptInvitationWithPasswordForRequest).toHaveBeenCalledWith(
      { token, password: 'secret' },
      SHARED,
    );
    await acceptInvitationAsSignedInUser({ token });
    expect(flow.acceptInvitationAsSignedInUserForRequest).toHaveBeenCalledWith({ token }, SHARED);
  });

  it('refuse a malformed token without calling the flow', async () => {
    const bad = await acceptInvitationAsSignedInUser({ token: 'x' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const badSignIn = await acceptInvitationWithSignInAction({ token: 'x', password: 'secret' });
    expect(badSignIn).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(flow.acceptInvitationAsSignedInUserForRequest).not.toHaveBeenCalled();
    expect(flow.acceptInvitationWithPasswordForRequest).not.toHaveBeenCalled();
  });
});

describe('lookupInvitationAction (token from the URL fragment)', () => {
  it('answers the link view for a well-formed token', async () => {
    const view = {
      state: 'valid',
      email: 'noura@example.test',
      locale: 'ar',
      organizationName: { ar: 'الراية', en: null },
      displayName: { ar: 'نورة', en: null },
      viewer: 'anonymous',
    };
    flow.lookupInvitationLinkForRequest.mockResolvedValueOnce({ ok: true, value: view });
    await expect(lookupInvitationAction({ token })).resolves.toEqual({ ok: true, value: view });
    expect(flow.lookupInvitationLinkForRequest).toHaveBeenCalledWith(token, SHARED);
    flow.lookupInvitationLinkForRequest.mockResolvedValueOnce({
      ok: true,
      value: { state: 'expired' },
    });
    await expect(lookupInvitationAction({ token })).resolves.toEqual({
      ok: true,
      value: { state: 'expired' },
    });
  });

  it("passes RATE_LIMITED through when the client's lookups are used up (T-M2-11)", async () => {
    flow.lookupInvitationLinkForRequest.mockResolvedValueOnce({
      ok: false,
      error: { code: 'RATE_LIMITED', status: 429, messageKey: 'errors.rateLimited', expose: true },
    });
    await expect(lookupInvitationAction({ token })).resolves.toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('refuses a malformed token or extra fields without a lookup; failures stay internal', async () => {
    for (const input of [{ token: 'x' }, { token, locale: 'ar' }, {}]) {
      const result = await lookupInvitationAction(input as never);
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    }
    expect(flow.lookupInvitationLinkForRequest).not.toHaveBeenCalled();
    flow.lookupInvitationLinkForRequest.mockRejectedValueOnce(new Error('db down'));
    const failed = await lookupInvitationAction({ token });
    expect(failed).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(failed)).not.toContain(token);
  });
});
