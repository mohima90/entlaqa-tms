import { describe, expect, it, vi } from 'vitest';
import {
  AuthServiceError,
  type AuthFlowDeps,
  SIGN_IN_REFUSAL_ANSWER_MS,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
  signOutEndedSession,
} from './auth-flow';
import {
  RateLimiterUnavailableError,
  type SignInGate,
  type SignInGuard,
  type SignInSuccessOptions,
} from './auth-limits';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TENANT_A = 'a0000000-0000-4000-8000-000000000001';
const TENANT_B = 'b0000000-0000-4000-8000-000000000001';
const PERSON = '44444444-4444-4444-8444-444444444444';

const baseClaims = { sub: USER, role: 'authenticated', aal: 'aal1', session_id: SESSION };
const tokenClaims: Record<string, Record<string, unknown>> = {
  'access-1': baseClaims,
  'access-2': { ...baseClaims, tenant_id: TENANT_A, person_id: PERSON },
  'access-other-tenant': { ...baseClaims, tenant_id: TENANT_B, person_id: PERSON },
};

interface FakeOptions {
  signInError?: { status?: number | undefined; message?: string | undefined };
  /** private.is_platform_admin's answer (FR-ADM-17). */
  platformAdmin?: boolean;
  tenants?: { tenantId: string; nameAr: string; nameEn: string | null }[];
  switched?: boolean;
  refreshError?: boolean;
  refreshedToken?: string;
  cookieToken?: string;
  auditFails?: boolean;
  serverUserId?: string | null;
  signOutFails?: boolean;
  /** The database's view of the session in its organization (T-M2-10); default 'ok'. */
  access?: string;
  mfaPending?: boolean;
  /** The sign-in guard's answer before Auth (default: allowed); an Error = limiter unavailable. */
  gate?: SignInGate | Error;
  /** Milliseconds Auth takes to answer (the fake clock moves on by this much). */
  authLatencyMs?: number;
  /** The account's factors in Auth's answer (default: none — no authenticator app); null: no `factors`. */
  factors?: { factor_type: string; status: string }[] | null;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  let clock = 1_000_000;
  const auth = {
    // Not used here: the e-mailed sign-in code's token exchange (sign-in-code.test.ts).
    verifyOtp: vi.fn(() => Promise.resolve({ data: { session: null }, error: { status: 400 } })),
    signInWithPassword: vi.fn(() => {
      clock += options.authLatencyMs ?? 0;
      return Promise.resolve(
        options.signInError
          ? { data: { session: null }, error: options.signInError }
          : {
              data: {
                session: { access_token: 'access-1', refresh_token: 'refresh-1' },
                user:
                  options.factors === null
                    ? { id: USER }
                    : { id: USER, factors: options.factors ?? [] },
              },
              error: null,
            },
      );
    }),
    getClaims: vi.fn((jwt?: string) => {
      const token = jwt ?? options.cookieToken;
      const claims = token ? tokenClaims[token] : undefined;
      return Promise.resolve(
        claims ? { data: { claims }, error: null } : { data: null, error: new Error('no session') },
      );
    }),
    getUser: vi.fn(() =>
      Promise.resolve({
        data: { user: options.serverUserId === null ? null : { id: options.serverUserId ?? USER } },
        error: null,
      }),
    ),
    refreshSession: vi.fn(() =>
      Promise.resolve(
        options.refreshError
          ? { data: { session: null }, error: new Error('refresh failed') }
          : {
              data: {
                session: {
                  access_token: options.refreshedToken ?? 'access-2',
                  refresh_token: 'refresh-2',
                },
              },
              error: null,
            },
      ),
    ),
    signOut: vi.fn(() => {
      calls.push('signOut');
      return Promise.resolve({ error: options.signOutFails ? new Error('auth down') : null });
    }),
  };
  const audited: { action: string; actor: unknown; entityId?: string | undefined }[] = [];
  const claimsSeen: unknown[] = [];
  // The attempt an allowed check hands out: Auth's verdict is reported to it.
  const failed = vi.fn(() => Promise.resolve());
  const succeeded = vi.fn((_options?: SignInSuccessOptions) => Promise.resolve());
  const notChecked = vi.fn(() => Promise.resolve());
  const check = vi.fn((_email: string): Promise<SignInGate> =>
    options.gate instanceof Error
      ? Promise.reject(options.gate)
      : Promise.resolve(
          options.gate ?? { allowed: true, attempt: { failed, succeeded, notChecked } },
        ),
  );
  const signInGuard: SignInGuard = { check };
  const guard = { check, failed, succeeded, notChecked };
  const deps: AuthFlowDeps = {
    supabase: { auth },
    withUserTx: ((claims: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      claimsSeen.push(claims);
      return fn('tx');
    }) as AuthFlowDeps['withUserTx'],
    isPlatformAdmin: vi.fn(() => Promise.resolve(options.platformAdmin ?? false)),
    listSessionTenants: vi.fn(() =>
      Promise.resolve(options.tenants ?? [{ tenantId: TENANT_A, nameAr: 'أ', nameEn: 'A' }]),
    ),
    switchActiveTenant: vi.fn((_tx, tenantId: string) => {
      calls.push(`switch:${tenantId}`);
      return Promise.resolve(options.switched ?? true);
    }),
    getSessionAccess: vi.fn(() =>
      Promise.resolve({
        state: (options.access ?? 'ok') as Awaited<
          ReturnType<AuthFlowDeps['getSessionAccess']>
        >['state'],
        mfaDeadline: null,
        usesApp: false,
        mfaPending: options.mfaPending ?? false,
        aal2: false,
      }),
    ),
    insertAuditEvent: vi.fn((_tx, actor, event) => {
      if (options.auditFails) return Promise.reject(new Error('db down'));
      audited.push({ action: event.action, actor, entityId: event.entityId });
      return Promise.resolve();
    }),
    logWarning: vi.fn(),
    signInGuard,
    now: () => clock,
    sleep: vi.fn((ms: number) => {
      clock += ms;
      return Promise.resolve();
    }),
  };
  return { deps, auth, audited, calls, claimsSeen, guard };
}

const credentials = { email: 'user@example.test', password: 'correct horse battery staple' };

describe('signInWithPassword', () => {
  it('signs in, selects the only organization, refreshes the token and audits the sign-in', async () => {
    const { deps, auth, audited, calls } = setup();
    const result = await signInWithPassword(deps, credentials);
    expect(result).toEqual({ ok: true, value: { next: 'home' } });
    expect(auth.signInWithPassword).toHaveBeenCalledWith(credentials);
    // Tokens issued in this request are verified explicitly (not re-read from cookies).
    expect(auth.getClaims).toHaveBeenCalledWith('access-1');
    expect(auth.getUser).toHaveBeenCalledWith('access-1');
    expect(calls).toEqual([`switch:${TENANT_A}`]);
    expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-1' });
    expect(auth.getClaims).toHaveBeenCalledWith('access-2');
    expect(audited).toEqual([
      {
        action: 'platform.auth.signed_in',
        entityId: SESSION,
        actor: {
          userId: USER,
          personId: PERSON,
          tenantId: TENANT_A,
          aal: 'aal1',
          impersonatorUserId: null,
        },
      },
    ]);
  });

  it('answers wrong e-mail and wrong password identically (no account enumeration)', async () => {
    const { deps, guard, auth } = setup({ signInError: { status: 400 } });
    const result = await signInWithPassword(deps, credentials);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(!result.ok && result.error.status).toBe(401);
    // The failure was counted BEFORE Auth was asked (check); the attempt records the security event
    // (keyed refs only) and requests the lockout e-mail when the account locks now.
    expect(guard.check).toHaveBeenCalledWith(credentials.email);
    expect(guard.check.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signInWithPassword.mock.invocationCallOrder[0] ?? 0,
    );
    expect(guard.failed).toHaveBeenCalledTimes(1);
    expect(guard.succeeded).not.toHaveBeenCalled();
  });

  it('a right password in a suspended organization: «Access paused», not counted as a failure (WP-ADM-06)', async () => {
    const { deps, guard } = setup({
      signInError: { status: 403, message: 'Access to this organization is paused.' },
    });
    const result = await signInWithPassword(deps, credentials);
    expect(!result.ok && result.error.code).toBe('AUTH_ACCESS_PAUSED');
    expect(!result.ok && result.error.status).toBe(403);
    expect(guard.failed).not.toHaveBeenCalled();
    expect(guard.notChecked).toHaveBeenCalledTimes(1);
    // Any other refusal by the hook stays the one neutral answer.
    const neutral = setup({
      signInError: { status: 403, message: 'Sign-in is not available for this account.' },
    });
    const other = await signInWithPassword(neutral.deps, credentials);
    expect(!other.ok && other.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('warns (codes only) when a refusal took longer than the padding allows', async () => {
    const slow = setup({ signInError: { status: 400 }, authLatencyMs: 1_300 });
    const result = await signInWithPassword(slow.deps, credentials);
    expect(!result.ok && result.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(slow.deps.logWarning).toHaveBeenCalledWith(
      'sign-in refusal took longer than its padding allows',
      { action: 'platform.auth.sign_in', reason: 'refusal_padding_exceeded', durationMs: 1_300 },
    );
    const fast = setup({ signInError: { status: 400 }, authLatencyMs: 1_100 });
    await signInWithPassword(fast.deps, credentials);
    expect(fast.deps.logWarning).not.toHaveBeenCalled();
  });

  it('answers an unknown account and a wrong password after the same time (timing, T-IAM-27)', async () => {
    // GoTrue answers an unknown e-mail at once and compares the password of an existing account first.
    const unknown = setup({ signInError: { status: 400 }, authLatencyMs: 20 });
    const wrongPassword = setup({ signInError: { status: 400 }, authLatencyMs: 180 });
    const answers = [];
    for (const { deps } of [unknown, wrongPassword]) {
      const started = deps.now();
      const result = await signInWithPassword(deps, credentials);
      answers.push({ result, took: deps.now() - started });
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]?.took).toBe(SIGN_IN_REFUSAL_ANSWER_MS);
    expect(answers[0]?.result).toMatchObject({
      ok: false,
      error: { code: 'AUTH_INVALID_CREDENTIALS' },
    });
  });

  it('refuses a limited attempt without asking Auth, after the same time, with one generic answer', async () => {
    const { deps, auth, guard } = setup({ gate: { allowed: false, retryAfterSeconds: 600 } });
    const started = deps.now();
    const result = await signInWithPassword(deps, credentials);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'AUTH_TOO_MANY_ATTEMPTS',
        status: 429,
        messageKey: 'auth.errors.tooManyAttempts',
      },
    });
    // The answer says nothing about the account: no retry time, no account state.
    expect(!result.ok && result.error.params).toBeUndefined();
    expect(deps.now() - started).toBe(SIGN_IN_REFUSAL_ANSWER_MS);
    expect(guard.check).toHaveBeenCalledWith(credentials.email);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(guard.failed).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter cannot answer: Auth is never asked', async () => {
    const { deps, auth } = setup({ gate: new RateLimiterUnavailableError() });
    await expect(signInWithPassword(deps, credentials)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("ends the account's run of failures after a correct password; remembers the browser only when ticked", async () => {
    const { deps, guard } = setup();
    await signInWithPassword(deps, credentials);
    expect(guard.succeeded).toHaveBeenCalledTimes(1);
    // Opt-in (PO decision 9 Oct 2026): not ticked, not remembered.
    expect(guard.succeeded).toHaveBeenCalledWith({
      remember: false,
      verified: { userId: USER, sessionId: SESSION },
      authNamesApp: false,
    });
    expect(guard.failed).not.toHaveBeenCalled();
    // A successful sign-in is not slowed down.
    expect(deps.sleep).not.toHaveBeenCalled();
    // Ticked: the verified token's user and session go with it — the database decides (L4).
    const ticked = setup();
    await signInWithPassword(ticked.deps, { ...credentials, remember: true });
    expect(ticked.guard.succeeded).toHaveBeenCalledWith({
      remember: true,
      verified: { userId: USER, sessionId: SESSION },
      authNamesApp: false,
    });
  });

  it('an account with an authenticator app: Auth naming it is passed on; the database decides (integration review L4)', async () => {
    const app = [{ factor_type: 'totp', status: 'verified' }];
    const ticked = setup({ factors: app });
    expect((await signInWithPassword(ticked.deps, { ...credentials, remember: true })).ok).toBe(
      true,
    );
    expect(ticked.guard.succeeded).toHaveBeenCalledWith({
      remember: true,
      verified: { userId: USER, sessionId: SESSION },
      authNamesApp: true,
    });
    // A set-up that never passed its first code is not named as an app (the database still looks).
    const unfinished = setup({ factors: [{ factor_type: 'totp', status: 'unverified' }] });
    await signInWithPassword(unfinished.deps, { ...credentials, remember: true });
    expect(unfinished.guard.succeeded).toHaveBeenCalledWith(
      expect.objectContaining({ remember: true, authNamesApp: false }),
    );
  });

  it('Auth’s answer without `factors` (re-review): not taken as "no app" by itself — the verified user goes to the database', async () => {
    const { deps, guard } = setup({ factors: null });
    expect((await signInWithPassword(deps, { ...credentials, remember: true })).ok).toBe(true);
    // Auth said nothing about an app; the database looks at this user's factors itself (pgTAP 71).
    expect(guard.succeeded).toHaveBeenCalledWith({
      remember: true,
      verified: { userId: USER, sessionId: SESSION },
      authNamesApp: false,
    });
  });

  it('a token that cannot be verified: the success is recorded without a user — nothing can be trusted', async () => {
    const { deps, guard, auth } = setup();
    auth.getClaims.mockResolvedValueOnce({ data: null, error: new Error('bad token') });
    const result = await signInWithPassword(deps, { ...credentials, remember: true });
    expect(!result.ok && result.error.code).toBe('UNAUTHENTICATED');
    expect(guard.succeeded).toHaveBeenCalledWith({
      remember: true,
      verified: null,
      authNamesApp: false,
    });
  });

  it('never reports an Auth outage as a wrong password; the provisional failure stays counted', async () => {
    for (const status of [500, 503, 0, undefined]) {
      const { deps, guard } = setup({ signInError: { status } });
      await expect(signInWithPassword(deps, credentials)).rejects.toBeInstanceOf(AuthServiceError);
      // Neither verdict is reported: nothing is given back (security review T-M2-11).
      expect(guard.failed).not.toHaveBeenCalled();
      expect(guard.succeeded).not.toHaveBeenCalled();
      expect(guard.notChecked).not.toHaveBeenCalled();
    }
  });

  it('maps Auth rate limiting to RATE_LIMITED; no password was compared, so the account gets its failure back (L6)', async () => {
    const { deps, guard } = setup({ signInError: { status: 429 } });
    const started = deps.now();
    const result = await signInWithPassword(deps, credentials);
    expect(!result.ok && result.error.code).toBe('RATE_LIMITED');
    expect(deps.now() - started).toBe(SIGN_IN_REFUSAL_ANSWER_MS);
    expect(guard.notChecked).toHaveBeenCalledTimes(1);
    expect(guard.failed).not.toHaveBeenCalled();
    expect(guard.succeeded).not.toHaveBeenCalled();
    expect(deps.logWarning).toHaveBeenCalledWith('sign-in limited by Auth', {
      action: 'platform.auth.sign_in',
      securityEvent: 'auth.rate_limited',
      reason: 'auth_service',
      status: 429,
    });
  });

  it('signs the session out again when the account has no active organization', async () => {
    const { deps, calls, audited } = setup({ tenants: [] });
    const result = await signInWithPassword(deps, credentials);
    expect(!result.ok && result.error.code).toBe('AUTH_NO_ORGANIZATION');
    expect(calls).toEqual(['signOut']);
    expect(audited).toEqual([]);
  });

  it('sends a Platform Super Admin without organizations to the console (signed in, FR-ADM-17)', async () => {
    const { deps, calls, audited } = setup({ tenants: [], platformAdmin: true });
    expect(await signInWithPassword(deps, credentials)).toEqual({
      ok: true,
      value: { next: 'platform' },
    });
    expect(calls).toEqual([]);
    expect(audited).toEqual([]);
  });

  it('lets a Super Admin who is also a member choose (an organization or the console)', async () => {
    const { deps, calls } = setup({ platformAdmin: true });
    expect(await signInWithPassword(deps, credentials)).toEqual({
      ok: true,
      value: { next: 'choose-organization' },
    });
    // No organization is selected automatically.
    expect(calls).toEqual([]);
  });

  it('asks the user to choose when there are several organizations (no tenant selected yet)', async () => {
    const { deps, calls } = setup({
      tenants: [
        { tenantId: TENANT_A, nameAr: 'أ', nameEn: 'A' },
        { tenantId: TENANT_B, nameAr: 'ب', nameEn: null },
      ],
    });
    expect(await signInWithPassword(deps, credentials)).toEqual({
      ok: true,
      value: { next: 'choose-organization' },
    });
    expect(calls).toEqual([]);
  });

  it('fails closed without a usable session or configuration', async () => {
    const { deps, auth } = setup();
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    } as never);
    const noSession = await signInWithPassword(deps, credentials);
    expect(!noSession.ok && noSession.error.code).toBe('UNAUTHENTICATED');

    const notConfigured = await signInWithPassword({ ...deps, supabase: null }, credentials);
    expect(!notConfigured.ok && notConfigured.error.code).toBe('NOT_CONFIGURED');
  });
});

describe('selectOrganization', () => {
  it('refuses an organization the user is not an active member of (no existence leak)', async () => {
    const { deps, auth, audited } = setup({ switched: false, cookieToken: 'access-1' });
    const result = await selectOrganization(deps, TENANT_B);
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(audited).toEqual([]);
  });

  it('uses the cookie session when called from the chooser (separate request)', async () => {
    const { deps, auth, audited } = setup({ cookieToken: 'access-1' });
    const result = await selectOrganization(deps, TENANT_A);
    expect(result).toEqual({ ok: true, value: { tenantId: TENANT_A, next: 'home' } });
    expect(auth.getClaims).toHaveBeenCalledWith();
    expect(auth.refreshSession).toHaveBeenCalledWith();
    expect(audited.map((a) => a.action)).toEqual(['platform.auth.signed_in']);
  });

  it('sends the session to the MFA page when the organization asks for a code or an app (T-M2-10)', async () => {
    for (const access of ['mfa_challenge', 'mfa_enrol']) {
      const { deps, audited } = setup({ cookieToken: 'access-1', access });
      const result = await selectOrganization(deps, TENANT_A);
      expect(result).toEqual({ ok: true, value: { tenantId: TENANT_A, next: 'mfa' } });
      // Refused by the database until the code: the sign-in is audited after it (mfa.ts).
      expect(audited).toEqual([]);
    }
  });

  it('invites to set up an app (grace period, Organization Admin prompt) after auditing the sign-in', async () => {
    for (const access of ['prompt_grace', 'prompt_admin']) {
      const { deps, audited } = setup({ cookieToken: 'access-1', access });
      const result = await selectOrganization(deps, TENANT_A);
      expect(result).toEqual({ ok: true, value: { tenantId: TENANT_A, next: 'mfa' } });
      expect(audited.map((a) => a.action)).toEqual(['platform.auth.signed_in']);
    }
    const signIn = await signInWithPassword(setup({ access: 'mfa_challenge' }).deps, credentials);
    expect(signIn).toEqual({ ok: true, value: { next: 'mfa' } });
  });

  it('shows an app waiting for its e-mailed code — here or added elsewhere — also when nothing requires one (re-review N1)', async () => {
    const { deps, audited } = setup({ cookieToken: 'access-1', access: 'ok', mfaPending: true });
    const result = await selectOrganization(deps, TENANT_A);
    expect(result).toEqual({ ok: true, value: { tenantId: TENANT_A, next: 'mfa' } });
    expect(audited.map((a) => a.action)).toEqual(['platform.auth.signed_in']);
  });

  it('never continues without the tenant claim (hook disabled or another tenant)', async () => {
    for (const refreshedToken of ['access-1', 'access-other-tenant']) {
      const { deps, audited } = setup({ cookieToken: 'access-1', refreshedToken });
      const result = await selectOrganization(deps, TENANT_A);
      expect(!result.ok && result.error.code).toBe('NOT_CONFIGURED');
      expect(audited).toEqual([]);
      expect(deps.logWarning).toHaveBeenCalled();
    }
  });

  it('fails when the session cannot be refreshed or the Auth server no longer knows it', async () => {
    const refreshFails = setup({ cookieToken: 'access-1', refreshError: true });
    const r1 = await selectOrganization(refreshFails.deps, TENANT_A);
    expect(!r1.ok && r1.error.code).toBe('UNAUTHENTICATED');

    const revoked = setup({ cookieToken: 'access-1', serverUserId: null });
    const r2 = await selectOrganization(revoked.deps, TENANT_A);
    expect(!r2.ok && r2.error.code).toBe('UNAUTHENTICATED');
    expect(revoked.calls).toEqual([]);

    const noSession = setup({});
    const r3 = await selectOrganization(noSession.deps, TENANT_A);
    expect(!r3.ok && r3.error.code).toBe('UNAUTHENTICATED');

    const notConfigured = await selectOrganization({ ...noSession.deps, supabase: null }, TENANT_A);
    expect(!notConfigured.ok && notConfigured.error.code).toBe('NOT_CONFIGURED');
  });
});

describe('getSessionOrganizations', () => {
  it('lists the session organizations and fails closed without a session', async () => {
    const withSession = setup({ cookieToken: 'access-1' });
    const listed = await getSessionOrganizations(withSession.deps);
    expect(listed.ok && listed.value).toEqual([{ tenantId: TENANT_A, nameAr: 'أ', nameEn: 'A' }]);

    const without = setup({});
    const refused = await getSessionOrganizations(without.deps);
    expect(!refused.ok && refused.error.code).toBe('UNAUTHENTICATED');
    expect(without.deps.listSessionTenants).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  it('audits the sign-out for a tenant session, then revokes the session', async () => {
    const { deps, audited, calls } = setup({ cookieToken: 'access-2' });
    expect(await signOut(deps)).toEqual({ ok: true, value: null });
    expect(audited.map((a) => a.action)).toEqual(['platform.auth.signed_out']);
    expect(calls).toEqual(['signOut']);
  });

  it('still signs out when there is no tenant or the audit write fails', async () => {
    const noTenant = setup({ cookieToken: 'access-1' });
    await signOut(noTenant.deps);
    expect(noTenant.audited).toEqual([]);
    expect(noTenant.calls).toEqual(['signOut']);

    const auditDown = setup({ cookieToken: 'access-2', auditFails: true });
    expect(await signOut(auditDown.deps)).toEqual({ ok: true, value: null });
    expect(auditDown.calls).toEqual(['signOut']);
    expect(auditDown.deps.logWarning).toHaveBeenCalled();

    const revokeFails = setup({ cookieToken: 'access-1', signOutFails: true });
    expect(await signOut(revokeFails.deps)).toEqual({ ok: true, value: null });
    expect(revokeFails.calls).toEqual(['signOut']);
    expect(revokeFails.deps.logWarning).toHaveBeenCalledWith(
      'could not revoke the session in Auth',
      { action: 'platform.auth.sign_out' },
    );

    const notConfigured = await signOut({ ...noTenant.deps, supabase: null });
    expect(!notConfigured.ok && notConfigured.error.code).toBe('NOT_CONFIGURED');
  });
});

describe('signOutEndedSession (T-M2-10)', () => {
  it('signs out only a session the organization ended', async () => {
    const ended = setup({ cookieToken: 'access-2', access: 'ended' });
    expect(await signOutEndedSession(ended.deps)).toEqual({ ok: true, value: { signedOut: true } });
    expect(ended.calls).toEqual(['signOut']);

    for (const access of ['ok', 'invalid', 'mfa_challenge']) {
      const other = setup({ cookieToken: 'access-2', access });
      expect(await signOutEndedSession(other.deps)).toEqual({
        ok: true,
        value: { signedOut: false },
      });
      expect(other.calls).toEqual([]);
    }
    const noTenant = setup({ cookieToken: 'access-1', access: 'ended' });
    expect(await signOutEndedSession(noTenant.deps)).toEqual({
      ok: true,
      value: { signedOut: false },
    });
    const noSession = setup({});
    expect((await signOutEndedSession(noSession.deps)).ok).toBe(true);
    expect(noSession.calls).toEqual([]);

    const revokeFails = setup({ cookieToken: 'access-2', access: 'ended', signOutFails: true });
    expect(await signOutEndedSession(revokeFails.deps)).toEqual({
      ok: true,
      value: { signedOut: true },
    });
    expect(revokeFails.deps.logWarning).toHaveBeenCalled();

    const notConfigured = await signOutEndedSession({ ...noSession.deps, supabase: null });
    expect(!notConfigured.ok && notConfigured.error.code).toBe('NOT_CONFIGURED');
  });
});
