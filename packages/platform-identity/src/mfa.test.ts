import { describe, expect, it, vi } from 'vitest';
import { AuthServiceError } from './auth-flow';
import {
  type FactorLike,
  type MfaDeps,
  TOTP_ISSUER,
  getMfaOverview,
  removeTotp,
  startTotpSetup,
  verifyTotpCode,
} from './mfa';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TENANT = 'a0000000-0000-4000-8000-000000000001';
const base = { sub: USER, role: 'authenticated', session_id: SESSION };
const tokens: Record<string, Record<string, unknown>> = {
  aal1: { ...base, aal: 'aal1', tenant_id: TENANT },
  aal2: { ...base, aal: 'aal2', tenant_id: TENANT },
  'no-tenant': { ...base, aal: 'aal1' },
};

interface Options {
  cookie?: string | null;
  factors?: FactorLike[];
  listError?: { status?: number; code?: string };
  enrollError?: { status?: number; code?: string };
  verifyError?: { status?: number; code?: string };
  unenrollError?: { status?: number; code?: string };
  access?: 'ok' | 'mfa_challenge' | 'mfa_enrol';
  auditFails?: boolean;
}

const verifiedApp: FactorLike = { id: 'f-verified', factor_type: 'totp', status: 'verified' };
const unfinished: FactorLike = { id: 'f-unverified', factor_type: 'totp', status: 'unverified' };
const phone: FactorLike = { id: 'f-phone', factor_type: 'phone', status: 'verified' };

function setup(options: Options = {}) {
  const calls: string[] = [];
  const audited: string[] = [];
  const cookie = options.cookie === undefined ? 'aal1' : options.cookie;
  const auth = {
    getClaims: vi.fn((jwt?: string) => {
      const claims = tokens[jwt ?? cookie ?? ''];
      return Promise.resolve(
        claims ? { data: { claims }, error: null } : { data: null, error: new Error('no session') },
      );
    }),
    getUser: vi.fn(() => Promise.resolve({ data: { user: { id: USER } }, error: null })),
    mfa: {
      listFactors: vi.fn(() =>
        Promise.resolve(
          options.listError
            ? { data: null, error: options.listError }
            : { data: { all: options.factors ?? [] }, error: null },
        ),
      ),
      enroll: vi.fn(() => {
        calls.push('enroll');
        return Promise.resolve(
          options.enrollError
            ? { data: null, error: options.enrollError }
            : {
                data: {
                  id: 'f-new',
                  totp: {
                    qr_code: 'data:image/svg+xml;utf-8,<svg/>',
                    secret: 'SECRETKEY',
                    uri: 'otpauth://x',
                  },
                },
                error: null,
              },
        );
      }),
      challengeAndVerify: vi.fn((params: { factorId: string; code: string }) => {
        calls.push(`verify:${params.factorId}`);
        return Promise.resolve(
          options.verifyError
            ? { data: null, error: options.verifyError }
            : { data: { access_token: 'aal2', refresh_token: 'refresh' }, error: null },
        );
      }),
      unenroll: vi.fn((params: { factorId: string }) => {
        calls.push(`unenroll:${params.factorId}`);
        return Promise.resolve({ data: null, error: options.unenrollError ?? null });
      }),
    },
  };
  const deps: MfaDeps = {
    supabase: { auth },
    withUserTx: ((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn('tx')) as MfaDeps['withUserTx'],
    insertAuditEvent: vi.fn((_tx, _actor, event: { action: string }) => {
      if (options.auditFails) return Promise.reject(new Error('db down'));
      audited.push(event.action);
      return Promise.resolve();
    }),
    getSessionAccess: vi.fn(() =>
      Promise.resolve({ state: options.access ?? 'ok', mfaDeadline: null }),
    ),
    logWarning: vi.fn(),
  };
  return { deps, auth, calls, audited };
}

describe('getMfaOverview', () => {
  it('says whether the account uses an app and whether this session passed a code', async () => {
    expect(await getMfaOverview(setup({ factors: [verifiedApp] }).deps)).toEqual({
      ok: true,
      value: { usesApp: true, sessionVerified: false },
    });
    expect(
      await getMfaOverview(setup({ cookie: 'aal2', factors: [unfinished, phone] }).deps),
    ).toEqual({ ok: true, value: { usesApp: false, sessionVerified: true } });
  });

  it('fails closed without a session, Auth or factors', async () => {
    expect((await getMfaOverview(setup({ cookie: null }).deps)).ok).toBe(false);
    const { deps } = setup();
    const notConfigured = await getMfaOverview({ ...deps, supabase: null });
    expect(!notConfigured.ok && notConfigured.error.code).toBe('NOT_CONFIGURED');
    const gone = await getMfaOverview(setup({ listError: { status: 401 } }).deps);
    expect(!gone.ok && gone.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('startTotpSetup', () => {
  it('removes unfinished set-ups, then asks Auth for a TOTP factor with our issuer', async () => {
    const { deps, auth, calls } = setup({ factors: [unfinished] });
    const result = await startTotpSetup(deps);
    expect(result).toEqual({
      ok: true,
      value: { factorId: 'f-new', qrCode: 'data:image/svg+xml;utf-8,<svg/>', secret: 'SECRETKEY' },
    });
    expect(calls).toEqual(['unenroll:f-unverified', 'enroll']);
    expect(auth.mfa.enroll).toHaveBeenCalledWith(
      expect.objectContaining({ factorType: 'totp', issuer: TOTP_ISSUER }),
    );
    expect(auth.getUser).toHaveBeenCalled(); // strict: confirmed with Auth
  });

  it('keeps an app already in use', async () => {
    const result = await startTotpSetup(setup({ factors: [verifiedApp] }).deps);
    expect(!result.ok && result.error.code).toBe('MFA_ALREADY_SET_UP');
  });

  it('logs (without details) an unfinished set-up it could not remove, and goes on', async () => {
    const { deps, calls } = setup({ factors: [unfinished], unenrollError: { status: 400 } });
    expect((await startTotpSetup(deps)).ok).toBe(true);
    expect(calls).toEqual(['unenroll:f-unverified', 'enroll']);
    expect(deps.logWarning).toHaveBeenCalledWith(
      'could not remove an unfinished authenticator set-up',
      { action: 'platform.auth.mfa_setup', status: 400 },
    );
  });

  it('maps Auth refusals', async () => {
    const cases: [{ status?: number; code?: string }, string][] = [
      [{ status: 429 }, 'RATE_LIMITED'],
      [{ status: 422, code: 'mfa_factor_name_conflict' }, 'MFA_ALREADY_SET_UP'],
      [{ status: 403, code: 'insufficient_aal' }, 'STEP_UP_REQUIRED'],
      [{ status: 401 }, 'UNAUTHENTICATED'],
      [{ status: 422, code: 'too_many_enrolled_mfa_factors' }, 'MFA_SETUP_EXPIRED'],
    ];
    for (const [enrollError, code] of cases) {
      const result = await startTotpSetup(setup({ enrollError }).deps);
      expect(!result.ok && result.error.code).toBe(code);
    }
    await expect(
      startTotpSetup(setup({ enrollError: { status: 503 } }).deps),
    ).rejects.toBeInstanceOf(AuthServiceError);
  });
});

describe('verifyTotpCode', () => {
  it('verifies the first code of a set-up: enrolled, audited with the upgraded (aal2) session', async () => {
    const { deps, calls, audited } = setup({ factors: [{ ...unfinished, id: 'f-new' }] });
    const result = await verifyTotpCode(deps, { code: '123456', factorId: 'f-new' });
    expect(result).toEqual({ ok: true, value: { enrolled: true } });
    expect(calls).toEqual(['verify:f-new']);
    expect(audited).toEqual(['platform.auth.mfa_enrolled']);
  });

  it("a code at sign-in uses the account's app; completing a refused sign-in also audits the sign-in", async () => {
    const { deps, calls, audited } = setup({
      factors: [phone, verifiedApp],
      access: 'mfa_challenge',
    });
    expect(await verifyTotpCode(deps, { code: '123456' })).toEqual({
      ok: true,
      value: { enrolled: false },
    });
    expect(calls).toEqual(['verify:f-verified']);
    expect(audited).toEqual(['platform.auth.mfa_verified', 'platform.auth.signed_in']);
  });

  it('a step-up code (session already allowed) is not a new sign-in', async () => {
    const { deps, audited } = setup({ factors: [verifiedApp], access: 'ok' });
    await verifyTotpCode(deps, { code: '123456' });
    expect(audited).toEqual(['platform.auth.mfa_verified']);
  });

  it('refuses wrong or expired codes with one answer, logged without the code', async () => {
    for (const code of [
      'mfa_verification_failed',
      'mfa_challenge_expired',
      'mfa_verification_rejected',
    ]) {
      const { deps, audited } = setup({
        factors: [verifiedApp],
        verifyError: { status: 422, code },
      });
      const result = await verifyTotpCode(deps, { code: '000000' });
      expect(!result.ok && result.error.code).toBe('MFA_CODE_INVALID');
      expect(audited).toEqual([]);
      expect(JSON.stringify(vi.mocked(deps.logWarning).mock.calls)).not.toContain('000000');
    }
  });

  it('needs an app, or a set-up that still exists', async () => {
    const none = await verifyTotpCode(setup({ factors: [unfinished] }).deps, { code: '123456' });
    expect(!none.ok && none.error.code).toBe('MFA_NOT_SET_UP');
    const gone = await verifyTotpCode(setup({ factors: [] }).deps, {
      code: '123456',
      factorId: 'f-old',
    });
    expect(!gone.ok && gone.error.code).toBe('MFA_SETUP_EXPIRED');
    const replaced = await verifyTotpCode(
      setup({ factors: [verifiedApp], verifyError: { status: 404, code: 'mfa_factor_not_found' } })
        .deps,
      { code: '123456' },
    );
    expect(!replaced.ok && replaced.error.code).toBe('MFA_SETUP_EXPIRED');
  });

  it('maps rate limits, a lost session and outages; never fails because of the audit', async () => {
    const limited = await verifyTotpCode(
      setup({ factors: [verifiedApp], verifyError: { status: 429 } }).deps,
      { code: '123456' },
    );
    expect(!limited.ok && limited.error.code).toBe('RATE_LIMITED');
    await expect(
      verifyTotpCode(setup({ factors: [verifiedApp], verifyError: { status: 500 } }).deps, {
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(AuthServiceError);
    const auditDown = setup({ factors: [verifiedApp], access: 'mfa_challenge', auditFails: true });
    expect((await verifyTotpCode(auditDown.deps, { code: '123456' })).ok).toBe(true);
    expect(auditDown.deps.logWarning).toHaveBeenCalled();
    const noSession = await verifyTotpCode(setup({ cookie: null }).deps, { code: '123456' });
    expect(!noSession.ok && noSession.error.code).toBe('UNAUTHENTICATED');
  });

  it('without an organization nothing is audited (no tenant to write in)', async () => {
    const { deps, audited } = setup({ cookie: 'no-tenant', factors: [verifiedApp] });
    // The upgraded token of this fake carries the tenant; the access check is skipped without one.
    await verifyTotpCode(deps, { code: '123456' });
    expect(deps.getSessionAccess).not.toHaveBeenCalled();
    expect(audited).toEqual(['platform.auth.mfa_verified']);
  });
});

describe('removeTotp', () => {
  it("needs a session that passed a code (Auth's own rule), then removes the app and audits it", async () => {
    const step = await removeTotp(setup({ factors: [verifiedApp] }).deps);
    expect(!step.ok && step.error.code).toBe('STEP_UP_REQUIRED');

    const { deps, calls, audited } = setup({ cookie: 'aal2', factors: [verifiedApp, unfinished] });
    expect(await removeTotp(deps)).toEqual({ ok: true, value: null });
    expect(calls).toEqual(['unenroll:f-verified']);
    expect(audited).toEqual(['platform.auth.mfa_removed']);
  });

  it('has nothing to remove without an app; maps Auth refusals', async () => {
    const none = await removeTotp(setup({ cookie: 'aal2', factors: [unfinished] }).deps);
    expect(!none.ok && none.error.code).toBe('MFA_NOT_SET_UP');
    const refused = await removeTotp(
      setup({
        cookie: 'aal2',
        factors: [verifiedApp],
        unenrollError: { status: 422, code: 'insufficient_aal' },
      }).deps,
    );
    expect(!refused.ok && refused.error.code).toBe('STEP_UP_REQUIRED');
    const { deps } = setup();
    const notConfigured = await removeTotp({ ...deps, supabase: null });
    expect(!notConfigured.ok && notConfigured.error.code).toBe('NOT_CONFIGURED');
  });
});
