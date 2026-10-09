import { createHash } from 'node:crypto';
import type { TokenLookup } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { AuthServiceError, type AuthFlowDeps } from './auth-flow';
import {
  type InvitationAcceptDeps,
  InvitationAccountError,
  acceptInvitationAsSignedInUser,
  acceptInvitationWithNewAccount,
  acceptInvitationWithPassword,
  lookupInvitation,
  lookupInvitationLink,
  sessionEmail,
} from './invitation-accept';

const USER = '11111111-1111-4111-8111-111111111111';
const NEW_USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TENANT = 'a0000000-0000-4000-8000-000000000001';
const OTHER_TENANT = 'b0000000-0000-4000-8000-000000000001';
const PERSON = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'A'.repeat(21) + '-_' + 'z9'.repeat(10); // 43 base64url characters
const EMAIL = 'invitee@example.test';
const PASSWORD = 'a long enough passphrase';

const valid: TokenLookup = {
  state: 'valid',
  email: EMAIL,
  locale: 'ar',
  organizationName: { ar: 'شركة الراية', en: 'Al-Raya' },
  displayName: { ar: 'نورة الدوسري', en: null },
};

const baseClaims = { sub: USER, role: 'authenticated', aal: 'aal1', session_id: SESSION };
const tokenClaims: Record<string, Record<string, unknown>> = {
  'access-1': { ...baseClaims, email: EMAIL },
  // The new account's first token: Auth copied the sign-up metadata (the raw token) into it.
  'access-new': {
    ...baseClaims,
    sub: NEW_USER,
    email: EMAIL,
    user_metadata: { invitation: 'raw token' },
  },
  'access-2': { ...baseClaims, email: EMAIL, tenant_id: TENANT, person_id: PERSON },
  'cookie-same': { ...baseClaims, email: 'Invitee@Example.test', tenant_id: OTHER_TENANT },
  'cookie-other': { ...baseClaims, email: 'someone@example.test' },
  'cookie-no-email': { ...baseClaims },
};

interface Options {
  lookup?: TokenLookup;
  signUpError?: { status?: number; code?: string };
  signUpNoSession?: boolean;
  signUpThrows?: boolean;
  clearFails?: 'error' | 'throw';
  callerError?: Error;
  signInError?: { status?: number };
  signInThrows?: boolean;
  refreshError?: boolean;
  cookieToken?: string;
  tenants?: number;
  /** The invited organization's minimum password length (T-M2-10). */
  minLength?: number;
  /** The database's view of the new session in its organization (T-M2-10). */
  access?: 'ok' | 'prompt_grace' | 'mfa_enrol';
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const auth = {
    signInWithPassword: vi.fn(() => {
      calls.push('signIn');
      if (options.signInThrows) return Promise.reject(new AuthServiceError(503));
      return Promise.resolve(
        options.signInError
          ? { data: { session: null }, error: options.signInError }
          : {
              data: { session: { access_token: 'access-1', refresh_token: 'refresh-1' } },
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
    getUser: vi.fn((jwt?: string) => {
      const token = jwt ?? options.cookieToken;
      const sub = (token ? tokenClaims[token]?.sub : undefined) ?? USER;
      return Promise.resolve({ data: { user: { id: sub as string } }, error: null });
    }),
    signUp: vi.fn(() => {
      calls.push('signUp');
      if (options.signUpThrows) return Promise.reject(new Error('fetch failed'));
      if (options.signUpError) {
        return Promise.resolve({
          data: { user: null, session: null },
          error: options.signUpError,
        });
      }
      return Promise.resolve({
        data: {
          user: { id: NEW_USER },
          session: options.signUpNoSession
            ? null
            : { access_token: 'access-new', refresh_token: 'refresh-new' },
        },
        error: null,
      });
    }),
    updateUser: vi.fn(() => {
      calls.push('clearMetadata');
      if (options.clearFails === 'throw') return Promise.reject(new Error('network'));
      return Promise.resolve({
        error: options.clearFails === 'error' ? new Error('refused') : null,
      });
    }),
    refreshSession: vi.fn(() =>
      Promise.resolve(
        options.refreshError
          ? { data: { session: null }, error: new Error('refresh failed') }
          : {
              data: { session: { access_token: 'access-2', refresh_token: 'refresh-2' } },
              error: null,
            },
      ),
    ),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
  };
  const authDeps: AuthFlowDeps = {
    supabase: { auth },
    withUserTx: ((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn('tx')) as AuthFlowDeps['withUserTx'],
    listSessionTenants: vi.fn(() =>
      Promise.resolve(
        Array.from({ length: options.tenants ?? 1 }, (_, i) => ({
          tenantId: i === 0 ? TENANT : OTHER_TENANT,
          nameAr: 'أ',
          nameEn: null,
        })),
      ),
    ),
    switchActiveTenant: vi.fn((_tx, tenantId: string) => {
      calls.push(`switch:${tenantId}`);
      return Promise.resolve(true);
    }),
    getSessionAccess: vi.fn(() =>
      Promise.resolve({
        state: options.access ?? ('ok' as const),
        mfaDeadline: null,
        usesApp: false,
        mfaPending: false,
        aal2: false,
      }),
    ),
    insertAuditEvent: vi.fn(() => Promise.resolve()),
    logWarning: vi.fn(),
  };
  const hashToken = vi.fn((token: string) => createHash('sha256').update(token).digest());
  const deps: InvitationAcceptDeps = {
    auth: authDeps,
    signUpClient: { auth },
    hashToken,
    invitationByToken: vi.fn(() => Promise.resolve(options.lookup ?? valid)),
    invitationPasswordMinLength: vi.fn(() => Promise.resolve(options.minLength ?? 12)),
    acceptInvitationAsCaller: vi.fn(() => {
      calls.push('acceptAsCaller');
      return options.callerError === undefined
        ? Promise.resolve({ tenantId: TENANT })
        : Promise.reject(options.callerError);
    }),
  };
  return { deps, auth, calls, hashToken };
}

const newAccount = {
  token: TOKEN,
  password: PASSWORD,
  displayNameAr: '  نورة فهد الدوسري ',
  displayNameEn: '   ',
};
const notValidError = Object.assign(new Error('invitation not valid'), {
  code: 'INVITATION_NOT_VALID',
});

describe('lookupInvitation', () => {
  it('refuses a malformed token without asking the database', async () => {
    const { deps } = setup();
    for (const token of [
      '',
      'short',
      `${TOKEN}A`,
      `${TOKEN.slice(0, 42)}=`,
      `${TOKEN.slice(0, 42)}+`,
    ]) {
      await expect(lookupInvitation(deps, token)).resolves.toEqual({ state: 'invalid' });
    }
    expect(deps.invitationByToken).not.toHaveBeenCalled();
  });

  it('looks the link up by the SHA-256 of the token only', async () => {
    const { deps } = setup({ lookup: { state: 'expired' } });
    await expect(lookupInvitation(deps, TOKEN)).resolves.toEqual({ state: 'expired' });
    expect(deps.invitationByToken).toHaveBeenCalledWith(
      createHash('sha256').update(TOKEN, 'utf8').digest(),
    );
  });
});

describe('lookupInvitationLink', () => {
  it('a valid link carries its details and who is looking at it', async () => {
    for (const [cookieToken, viewer] of [
      [undefined, 'anonymous'],
      ['cookie-same', 'invitee'],
      ['cookie-other', 'other-account'],
      ['cookie-no-email', 'other-account'],
    ] as const) {
      const { deps } = setup(cookieToken ? { cookieToken } : {});
      await expect(lookupInvitationLink(deps, TOKEN)).resolves.toEqual({
        ...valid,
        viewer,
        passwordMinLength: 12,
      });
    }
  });

  it('other states carry nothing else and do not read the session', async () => {
    const { deps, auth } = setup({ lookup: { state: 'used' }, cookieToken: 'cookie-same' });
    await expect(lookupInvitationLink(deps, TOKEN)).resolves.toEqual({ state: 'used' });
    await expect(lookupInvitationLink(deps, 'malformed')).resolves.toEqual({ state: 'invalid' });
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it('without Auth configured the viewer is anonymous', async () => {
    const { deps } = setup();
    await expect(
      lookupInvitationLink({ ...deps, auth: { ...deps.auth, supabase: null } }, TOKEN),
    ).resolves.toMatchObject({ state: 'valid', viewer: 'anonymous' });
  });
});

describe("the organization's password rule and MFA step (T-M2-10)", () => {
  it("the accept page learns the invited organization's minimum (live rules)", async () => {
    const { deps } = setup({ minLength: 16 });
    await expect(lookupInvitationLink(deps, TOKEN)).resolves.toMatchObject({
      state: 'valid',
      passwordMinLength: 16,
    });
    expect(deps.invitationPasswordMinLength).toHaveBeenCalledWith(
      createHash('sha256').update(TOKEN, 'utf8').digest(),
    );
  });

  it('refuses a shorter password before Auth creates anything, naming only the length', async () => {
    const { deps, auth, calls } = setup({ minLength: 30 });
    const result = await acceptInvitationWithNewAccount(deps, newAccount);
    expect(!result.ok && result.error).toMatchObject({
      code: 'INVITATION_PASSWORD_TOO_SHORT',
      params: { min: 30 },
      fieldErrors: [{ path: 'password', code: 'TOO_SMALL', params: { min: 30 } }],
    });
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('counts characters, not UTF-16 units (an Arabic passphrase of 16 letters meets 16)', async () => {
    const { deps } = setup({ minLength: 16 });
    const result = await acceptInvitationWithNewAccount(deps, {
      token: TOKEN,
      password: 'كلمةمرورعربيةطوي',
    });
    expect(result.ok).toBe(true);
  });

  it('continues to the MFA page when the organization asks for an app (screen 8 step 2)', async () => {
    for (const access of ['prompt_grace', 'mfa_enrol'] as const) {
      const { deps } = setup({ access });
      const result = await acceptInvitationWithNewAccount(deps, newAccount);
      expect(result).toEqual({ ok: true, value: { next: 'mfa' } });
    }
  });
});

describe('acceptInvitationWithNewAccount (public sign-up gated by the Auth hook)', () => {
  it('signs up as the invitation e-mail with the raw token, clears it, accepts as the new user, opens the organization', async () => {
    const { deps, calls, auth } = setup();
    const result = await acceptInvitationWithNewAccount(deps, newAccount);
    expect(result).toEqual({ ok: true, value: { next: 'home' } });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      options: { data: { invitation: TOKEN } },
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { invitation: null } });
    expect(deps.acceptInvitationAsCaller).toHaveBeenCalledWith(
      'tx',
      createHash('sha256').update(TOKEN, 'utf8').digest(),
      { ar: 'نورة فهد الدوسري', en: null },
    );
    expect(calls).toEqual(['signUp', 'clearMetadata', 'acceptAsCaller', `switch:${TENANT}`]);
    // The organization is opened with the sign-up session's own refresh token (no other sign-in).
    expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-new' });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('accepts with the claims of the new session, and without display names when none were given', async () => {
    const { deps } = setup();
    const withUserTx = vi.spyOn(deps.auth, 'withUserTx');
    await acceptInvitationWithNewAccount(deps, { token: TOKEN, password: PASSWORD });
    expect(withUserTx.mock.calls[0]?.[0]).toMatchObject({ sub: NEW_USER, session_id: SESSION });
    expect(deps.acceptInvitationAsCaller).toHaveBeenCalledWith('tx', expect.any(Buffer), {
      ar: null,
      en: null,
    });
  });

  it('goes to the organization chooser when the organization cannot be opened', async () => {
    const { deps } = setup({ refreshError: true });
    await expect(
      acceptInvitationWithNewAccount(deps, { token: TOKEN, password: PASSWORD }),
    ).resolves.toEqual({ ok: true, value: { next: 'choose-organization' } });
  });

  it.each(['expired', 'revoked', 'used', 'invalid'] as const)(
    'never calls Auth when the link is %s',
    async (state) => {
      const { deps, auth } = setup({ lookup: { state } });
      const result = await acceptInvitationWithNewAccount(deps, newAccount);
      expect(result).toMatchObject({ ok: false, error: { code: 'INVITATION_NOT_VALID' } });
      expect(auth.signUp).not.toHaveBeenCalled();
      expect(deps.acceptInvitationAsCaller).not.toHaveBeenCalled();
    },
  );

  it('never calls Auth for a malformed token', async () => {
    const { deps, auth } = setup();
    const result = await acceptInvitationWithNewAccount(deps, { ...newAccount, token: 'x' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVITATION_NOT_VALID' } });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('answers NOT_CONFIGURED without Auth', async () => {
    const { deps } = setup();
    await expect(
      acceptInvitationWithNewAccount({ ...deps, signUpClient: null }, newAccount),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } });
    await expect(
      acceptInvitationWithNewAccount(
        { ...deps, auth: { ...deps.auth, supabase: null } },
        newAccount,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } });
  });

  it.each([
    [{ status: 403, code: 'unexpected_failure' }, 'INVITATION_NOT_VALID'],
    [{ status: 403 }, 'INVITATION_NOT_VALID'],
    [{ status: 422, code: 'user_already_exists' }, 'INVITATION_ACCOUNT_EXISTS'],
    [{ status: 422, code: 'email_exists' }, 'INVITATION_ACCOUNT_EXISTS'],
    [{ status: 422, code: 'weak_password' }, 'INVITATION_PASSWORD_REJECTED'],
    [{ status: 429, code: 'over_request_rate_limit' }, 'RATE_LIMITED'],
    [{ status: 429 }, 'RATE_LIMITED'],
  ] as const)('answers the Auth refusal %o as %s without accepting', async (signUpError, code) => {
    const { deps, auth } = setup({ signUpError });
    const result = await acceptInvitationWithNewAccount(deps, newAccount);
    expect(result).toMatchObject({ ok: false, error: { code, expose: true } });
    expect(deps.acceptInvitationAsCaller).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('throws InvitationAccountError (→ INTERNAL_ERROR) on another refusal, logged without personal data', async () => {
    const { deps } = setup({ signUpError: { status: 422, code: 'signup_disabled' } });
    await expect(acceptInvitationWithNewAccount(deps, newAccount)).rejects.toBeInstanceOf(
      InvitationAccountError,
    );
    expect(deps.auth.logWarning).toHaveBeenCalledWith('invitation: Auth refused the sign-up', {
      action: 'platform.invitation.accept',
      status: 422,
      errorCode: 'signup_disabled',
    });
    const noCode = setup({ signUpError: { status: 400 } });
    await expect(acceptInvitationWithNewAccount(noCode.deps, newAccount)).rejects.toBeInstanceOf(
      InvitationAccountError,
    );
    expect(noCode.deps.auth.logWarning).toHaveBeenCalledWith(
      'invitation: Auth refused the sign-up',
      { action: 'platform.invitation.accept', status: 400 },
    );
    expect(deps.acceptInvitationAsCaller).not.toHaveBeenCalled();
  });

  it.each([{ status: 500 }, { status: 0 }, {}])(
    'throws AuthServiceError when Auth fails (%o)',
    async (signUpError) => {
      const { deps } = setup({ signUpError });
      await expect(acceptInvitationWithNewAccount(deps, newAccount)).rejects.toBeInstanceOf(
        AuthServiceError,
      );
    },
  );

  it('a sign-up without a session (e-mail confirmation on) continues with sign in to accept', async () => {
    const { deps } = setup({ signUpNoSession: true });
    const result = await acceptInvitationWithNewAccount(deps, newAccount);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVITATION_ACCOUNT_EXISTS' } });
    expect(deps.auth.logWarning).toHaveBeenCalledWith(
      'invitation: sign-up answered without a session; is e-mail confirmation off?',
      { action: 'platform.invitation.accept' },
    );
    expect(deps.acceptInvitationAsCaller).not.toHaveBeenCalled();
  });

  it('ends the session when the new token cannot be verified', async () => {
    const { deps, auth } = setup();
    auth.getClaims.mockResolvedValueOnce({ data: null, error: new Error('bad token') });
    const result = await acceptInvitationWithNewAccount(deps, newAccount);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(deps.acceptInvitationAsCaller).not.toHaveBeenCalled();
  });

  it.each(['error', 'throw'] as const)(
    'goes on when the token cannot be removed from the metadata (%s), logged',
    async (clearFails) => {
      const { deps } = setup({ clearFails });
      await expect(acceptInvitationWithNewAccount(deps, newAccount)).resolves.toEqual({
        ok: true,
        value: { next: 'home' },
      });
      expect(deps.auth.logWarning).toHaveBeenCalledWith(
        'invitation: could not remove the token from the new account metadata',
        { action: 'platform.invitation.accept' },
      );
    },
  );

  it.each([
    ['INVITATION_NOT_VALID', 'INVITATION_NOT_VALID'],
    ['INVITATION_ACCOUNT_MISMATCH', 'INVITATION_ACCOUNT_MISMATCH'],
  ] as const)(
    'a refused acceptance (%s) logs the orphan Auth user and ends the session',
    async (dbCode, code) => {
      const { deps, auth } = setup({
        callerError: Object.assign(new Error(dbCode), { code: dbCode }),
      });
      const result = await acceptInvitationWithNewAccount(deps, newAccount);
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      // An orphan Auth user: its id and the link's current state for the runbook, no e-mail or names.
      expect(deps.auth.logWarning).toHaveBeenCalledWith(
        'invitation: Auth user created but the invitation was not accepted',
        {
          action: 'platform.invitation.accept',
          reason: 'orphan_auth_user',
          entityType: 'auth_user',
          entityId: NEW_USER,
          state: 'valid',
          ...(dbCode === 'INVITATION_NOT_VALID' ? { errorCode: 'INVITATION_NOT_VALID' } : {}),
        },
      );
      expect(JSON.stringify(vi.mocked(deps.auth.logWarning).mock.calls)).not.toMatch(
        /invitee|example\.test|نورة|passphrase|AAAA/,
      );
    },
  );

  it('logs the state read again after the failure, or unknown when it cannot be read', async () => {
    const { deps, auth } = setup({ callerError: notValidError });
    vi.mocked(deps.invitationByToken)
      .mockResolvedValueOnce(valid)
      .mockResolvedValueOnce({ state: 'revoked' });
    await acceptInvitationWithNewAccount(deps, newAccount);
    expect(deps.auth.logWarning).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'orphan_auth_user', state: 'revoked' }),
    );
    vi.mocked(deps.invitationByToken)
      .mockResolvedValueOnce(valid)
      .mockRejectedValueOnce(new Error('db down'));
    await acceptInvitationWithNewAccount(deps, newAccount);
    expect(deps.auth.logWarning).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ state: 'unknown' }),
    );
    // Validated right before Auth is asked: lookup → sign-up → accept.
    expect(vi.mocked(deps.invitationByToken).mock.invocationCallOrder[0]).toBeLessThan(
      auth.signUp.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('rethrows any other acceptance failure, after logging the orphan and ending the session', async () => {
    const failure = new Error('db down');
    const { deps, auth } = setup({ callerError: failure });
    await expect(acceptInvitationWithNewAccount(deps, newAccount)).rejects.toBe(failure);
    expect(deps.auth.logWarning).toHaveBeenCalledWith(
      'invitation: Auth user created but the invitation was not accepted',
      expect.objectContaining({ reason: 'orphan_auth_user', entityId: NEW_USER }),
    );
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(JSON.stringify(vi.mocked(deps.auth.logWarning).mock.calls)).not.toMatch(
      /invitee|passphrase/,
    );
  });

  it('a failed sign-out after a refusal is logged under the accept action', async () => {
    const { deps, auth } = setup({ callerError: notValidError });
    auth.signOut.mockResolvedValueOnce({ error: new Error('revoke failed') as never });
    await acceptInvitationWithNewAccount(deps, newAccount);
    expect(deps.auth.logWarning).toHaveBeenCalledWith(
      'invitation: could not end the sign-in session after a refused acceptance',
      { action: 'platform.invitation.accept' },
    );
  });

  it('a sign-up request that cannot be sent is an internal error', async () => {
    const { deps } = setup({ signUpThrows: true });
    await expect(acceptInvitationWithNewAccount(deps, newAccount)).rejects.toThrow('fetch failed');
    expect(deps.acceptInvitationAsCaller).not.toHaveBeenCalled();
  });
});

describe('acceptInvitationWithPassword (sign in to accept)', () => {
  it('signs in as the invitation e-mail, accepts as that user and opens the organization', async () => {
    const { deps, auth, calls } = setup();
    const result = await acceptInvitationWithPassword(deps, { token: TOKEN, password: PASSWORD });
    expect(result).toEqual({ ok: true, value: { next: 'home' } });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
    expect(calls).toEqual(['signIn', 'acceptAsCaller', `switch:${TENANT}`]);
    expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-1' });
  });

  it('refuses wrong credentials with the usual sign-in answer', async () => {
    const { deps } = setup({ signInError: { status: 400 } });
    const result = await acceptInvitationWithPassword(deps, { token: TOKEN, password: 'wrong' });
    expect(result).toMatchObject({ ok: false, error: { code: 'AUTH_INVALID_CREDENTIALS' } });
    expect(deps.acceptInvitationAsCaller).not.toHaveBeenCalled();
  });

  it('does not sign in when the link is no longer valid', async () => {
    const { deps, auth } = setup({ lookup: { state: 'used' } });
    const result = await acceptInvitationWithPassword(deps, { token: TOKEN, password: PASSWORD });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVITATION_NOT_VALID' } });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    ['INVITATION_NOT_VALID', 'INVITATION_NOT_VALID'],
    ['ALREADY_MEMBER', 'INVITATION_ALREADY_MEMBER'],
    ['INVITATION_ACCOUNT_MISMATCH', 'INVITATION_ACCOUNT_MISMATCH'],
  ] as const)(
    'maps the database refusal %s to %s and ends the just-created session',
    async (dbCode, code) => {
      const refused = setup({
        callerError: Object.assign(new Error(dbCode), { code: dbCode }),
      });
      await expect(
        acceptInvitationWithPassword(refused.deps, { token: TOKEN, password: PASSWORD }),
      ).resolves.toMatchObject({ ok: false, error: { code, expose: true } });
      expect(refused.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    },
  );

  it('rethrows anything else, also ending the session', async () => {
    const failure = new Error('db down');
    const broken = setup({ callerError: failure });
    await expect(
      acceptInvitationWithPassword(broken.deps, { token: TOKEN, password: PASSWORD }),
    ).rejects.toBe(failure);
    expect(broken.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a failed sign-out is logged, never answered', async () => {
    const refused = setup({ callerError: notValidError });
    refused.auth.signOut.mockResolvedValueOnce({ error: new Error('revoke failed') as never });
    await expect(
      acceptInvitationWithPassword(refused.deps, { token: TOKEN, password: PASSWORD }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVITATION_NOT_VALID' } });
    expect(refused.deps.auth.logWarning).toHaveBeenCalledWith(
      'invitation: could not end the sign-in session after a refused acceptance',
      { action: 'platform.invitation.accept_with_sign_in' },
    );
  });

  it('keeps the session when the acceptance succeeded', async () => {
    const { deps, auth } = setup();
    await acceptInvitationWithPassword(deps, { token: TOKEN, password: PASSWORD });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('falls back to the organization chooser when opening the organization fails', async () => {
    const { deps } = setup({ refreshError: true });
    await expect(
      acceptInvitationWithPassword(deps, { token: TOKEN, password: PASSWORD }),
    ).resolves.toEqual({ ok: true, value: { next: 'choose-organization' } });
  });
});

describe('acceptInvitationAsSignedInUser', () => {
  it('accepts with the current session when its e-mail is the invitation e-mail', async () => {
    const { deps, auth, calls } = setup({ cookieToken: 'cookie-same' });
    const result = await acceptInvitationAsSignedInUser(deps, { token: TOKEN });
    expect(result).toEqual({ ok: true, value: { next: 'home' } });
    expect(auth.getUser).toHaveBeenCalled(); // strict: confirmed with the Auth server
    expect(calls).toEqual(['acceptAsCaller', `switch:${TENANT}`]);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    const { deps } = setup();
    const result = await acceptInvitationAsSignedInUser(deps, { token: TOKEN });
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(deps.invitationByToken).not.toHaveBeenCalled();
  });

  it.each(['cookie-other', 'cookie-no-email'])(
    'refuses a session of another account (%s)',
    async (cookieToken) => {
      const { deps } = setup({ cookieToken });
      const result = await acceptInvitationAsSignedInUser(deps, { token: TOKEN });
      expect(result).toMatchObject({ ok: false, error: { code: 'INVITATION_OTHER_ACCOUNT' } });
      expect(deps.acceptInvitationAsCaller).not.toHaveBeenCalled();
    },
  );

  it('refuses a link that is no longer valid', async () => {
    const { deps } = setup({ cookieToken: 'cookie-same', lookup: { state: 'revoked' } });
    const result = await acceptInvitationAsSignedInUser(deps, { token: TOKEN });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVITATION_NOT_VALID' } });
  });
});

describe('sessionEmail', () => {
  it('reads the lower-cased e-mail claim', () => {
    expect(sessionEmail({ ...baseClaims, email: 'A@B.test' } as never)).toBe('a@b.test');
    expect(sessionEmail({ ...baseClaims, email: '' } as never)).toBeNull();
    expect(sessionEmail(baseClaims as never)).toBeNull();
  });
});
