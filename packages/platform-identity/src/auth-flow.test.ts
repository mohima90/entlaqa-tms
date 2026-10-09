import { describe, expect, it, vi } from 'vitest';
import {
  AuthServiceError,
  type AuthFlowDeps,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
  signOutEndedSession,
} from './auth-flow';

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
  signInError?: { status?: number | undefined };
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
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const auth = {
    signInWithPassword: vi.fn(() =>
      Promise.resolve(
        options.signInError
          ? { data: { session: null }, error: options.signInError }
          : {
              data: { session: { access_token: 'access-1', refresh_token: 'refresh-1' } },
              error: null,
            },
      ),
    ),
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
  const deps: AuthFlowDeps = {
    supabase: { auth },
    withUserTx: ((claims: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      claimsSeen.push(claims);
      return fn('tx');
    }) as AuthFlowDeps['withUserTx'],
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
      }),
    ),
    insertAuditEvent: vi.fn((_tx, actor, event) => {
      if (options.auditFails) return Promise.reject(new Error('db down'));
      audited.push({ action: event.action, actor, entityId: event.entityId });
      return Promise.resolve();
    }),
    logWarning: vi.fn(),
  };
  return { deps, auth, audited, calls, claimsSeen };
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
    const { deps } = setup({ signInError: { status: 400 } });
    const result = await signInWithPassword(deps, credentials);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(!result.ok && result.error.status).toBe(401);
    // Security event without personal data (no e-mail, no password).
    expect(deps.logWarning).toHaveBeenCalledWith('sign-in refused', {
      action: 'platform.auth.sign_in',
      status: 400,
    });
  });

  it('never reports an Auth outage as a wrong password', async () => {
    for (const status of [500, 503, 0, undefined]) {
      const { deps } = setup({ signInError: { status } });
      await expect(signInWithPassword(deps, credentials)).rejects.toBeInstanceOf(AuthServiceError);
    }
  });

  it('maps Auth rate limiting to RATE_LIMITED', async () => {
    const { deps } = setup({ signInError: { status: 429 } });
    const result = await signInWithPassword(deps, credentials);
    expect(!result.ok && result.error.code).toBe('RATE_LIMITED');
  });

  it('signs the session out again when the account has no active organization', async () => {
    const { deps, calls, audited } = setup({ tenants: [] });
    const result = await signInWithPassword(deps, credentials);
    expect(!result.ok && result.error.code).toBe('AUTH_NO_ORGANIZATION');
    expect(calls).toEqual(['signOut']);
    expect(audited).toEqual([]);
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
