import { createHash } from 'node:crypto';
import type { SessionAccess } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { AuthServiceError } from './auth-flow';
import {
  type FactorLike,
  type MfaDeps,
  TOTP_ISSUER,
  getMfaOverview,
  openMfaLink,
  removeTotp,
  requestMfaConfirmationMail,
  startTotpSetup,
  verifyTotpCode,
} from './mfa';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TENANT = 'a0000000-0000-4000-8000-000000000001';
const base = { sub: USER, role: 'authenticated', session_id: SESSION };
const now = () => Math.floor(Date.now() / 1000);
const tokens: Record<string, () => Record<string, unknown>> = {
  aal1: () => ({ ...base, aal: 'aal1', tenant_id: TENANT }),
  // A code passed just now, and one passed an hour ago (review L3: 15 minutes).
  aal2: () => ({
    ...base,
    aal: 'aal2',
    tenant_id: TENANT,
    amr: [{ method: 'totp', timestamp: now() }],
  }),
  'aal2-stale': () => ({
    ...base,
    aal: 'aal2',
    tenant_id: TENANT,
    amr: [{ method: 'totp', timestamp: now() - 3600 }],
  }),
  'no-tenant': () => ({ ...base, aal: 'aal1' }),
  'no-tenant-aal2': () => ({ ...base, aal: 'aal2', amr: [{ method: 'totp', timestamp: now() }] }),
};

type State = SessionAccess['state'];

interface Options {
  cookie?: string | null;
  /** The access token Auth answers a verified code with. */
  upgraded?: string;
  factors?: FactorLike[];
  listError?: { status?: number; code?: string };
  enrollError?: { status?: number; code?: string };
  verifyError?: { status?: number; code?: string };
  unenrollError?: { status?: number; code?: string };
  /** The session's state before the code, and after it. */
  access?: State;
  accessAfter?: State;
  /** The account's app is confirmed (database), and the session's code counts (effective AAL2). */
  confirmed?: boolean;
  aal2?: boolean;
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
      const claims = tokens[jwt ?? cookie ?? '']?.();
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
            : {
                data: { access_token: options.upgraded ?? 'aal2', refresh_token: 'refresh' },
                error: null,
              },
        );
      }),
      unenroll: vi.fn((params: { factorId: string }) => {
        calls.push(`unenroll:${params.factorId}`);
        return Promise.resolve({ data: null, error: options.unenrollError ?? null });
      }),
    },
  };
  let accessCalls = 0;
  const deps: MfaDeps = {
    supabase: { auth },
    withUserTx: ((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn('tx')) as MfaDeps['withUserTx'],
    insertAuditEvent: vi.fn((_tx, _actor, event: { action: string }) => {
      if (options.auditFails) return Promise.reject(new Error('db down'));
      audited.push(event.action);
      return Promise.resolve();
    }),
    getSessionAccess: vi.fn(() => {
      accessCalls += 1;
      const state = accessCalls === 1 ? (options.access ?? 'ok') : (options.accessAfter ?? 'ok');
      return Promise.resolve({
        state,
        mfaDeadline: null,
        usesApp: options.confirmed ?? false,
        mfaPending: false,
        aal2: options.aal2 ?? false,
      });
    }),
    requestMfaFactorMail: vi.fn((_tx, factorId: string | null) => {
      calls.push(`mail:added:${factorId ?? 'resend'}`);
      return Promise.resolve(true);
    }),
    requestMfaRemovedMail: vi.fn((_tx, factorId: string) => {
      calls.push(`mail:removed:${factorId}`);
      return Promise.resolve(true);
    }),
    applyDeviceLimit: vi.fn(() => {
      calls.push('device-limit');
      return Promise.resolve(0);
    }),
    logWarning: vi.fn(),
  };
  return { deps, auth, calls, audited };
}

describe('getMfaOverview', () => {
  it('says whether the account uses an app, whether this session passed a code, and how recently', async () => {
    expect(await getMfaOverview(setup({ factors: [verifiedApp] }).deps)).toEqual({
      ok: true,
      value: { usesApp: true, sessionVerified: false, codeFresh: false },
    });
    expect(
      await getMfaOverview(setup({ cookie: 'aal2', factors: [unfinished, phone] }).deps),
    ).toEqual({ ok: true, value: { usesApp: false, sessionVerified: true, codeFresh: true } });
    expect(
      await getMfaOverview(setup({ cookie: 'aal2-stale', factors: [verifiedApp] }).deps),
    ).toEqual({ ok: true, value: { usesApp: true, sessionVerified: true, codeFresh: false } });
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
  it('the first code of a set-up: the app waits for its e-mailed confirmation (review H1), nothing more yet', async () => {
    const { deps, calls, audited } = setup({
      factors: [{ ...unfinished, id: 'f-new' }],
      access: 'mfa_enrol',
      accessAfter: 'mfa_enrol',
    });
    const result = await verifyTotpCode(deps, { code: '123456', factorId: 'f-new' });
    expect(result).toEqual({ ok: true, value: { enrolled: true } });
    // The database records, audits and e-mails the set-up; the session stays refused until confirmed.
    expect(calls).toEqual(['verify:f-new', 'mail:added:f-new']);
    expect(audited).toEqual([]);
  });

  it('a set-up without an organization is e-mailed too', async () => {
    const { deps, calls } = setup({
      cookie: 'no-tenant',
      upgraded: 'no-tenant-aal2',
      factors: [{ ...unfinished, id: 'f-new' }],
    });
    expect((await verifyTotpCode(deps, { code: '123456', factorId: 'f-new' })).ok).toBe(true);
    expect(calls).toEqual(['verify:f-new', 'mail:added:f-new']);
    expect(deps.getSessionAccess).not.toHaveBeenCalled();
  });

  it("a code at sign-in uses the account's app; completing a refused sign-in audits it and applies the device limit", async () => {
    const { deps, calls, audited } = setup({
      factors: [phone, verifiedApp],
      access: 'mfa_challenge',
      accessAfter: 'ok',
    });
    expect(await verifyTotpCode(deps, { code: '123456' })).toEqual({
      ok: true,
      value: { enrolled: false },
    });
    expect(calls).toEqual(['verify:f-verified', 'device-limit']);
    expect(audited).toEqual(['platform.auth.mfa_verified', 'platform.auth.signed_in']);
  });

  it('a step-up code (session already allowed) is not a new sign-in', async () => {
    const { deps, audited, calls } = setup({ factors: [verifiedApp], access: 'ok' });
    await verifyTotpCode(deps, { code: '123456' });
    expect(audited).toEqual(['platform.auth.mfa_verified']);
    expect(calls).not.toContain('device-limit');
  });

  it('a code from an app still waiting for its confirmation leaves a refused session refused', async () => {
    const { deps, audited, calls } = setup({
      factors: [verifiedApp],
      access: 'mfa_enrol',
      accessAfter: 'mfa_enrol',
    });
    expect((await verifyTotpCode(deps, { code: '123456' })).ok).toBe(true);
    expect(audited).toEqual([]);
    expect(calls).toEqual(['verify:f-verified']);
  });

  it('refuses wrong or expired codes with one answer, logged with a stable code and without the code (review M3)', async () => {
    for (const code of [
      'mfa_verification_failed',
      'mfa_challenge_expired',
      'mfa_verification_rejected',
    ]) {
      const { deps, audited } = setup({
        factors: [verifiedApp],
        verifyError: { status: 422, code },
      });
      const result = await verifyTotpCode(deps, { code: '987654' });
      expect(!result.ok && result.error.code).toBe('MFA_CODE_INVALID');
      expect(audited).toEqual([]);
      expect(deps.logWarning).toHaveBeenCalledWith('authenticator code refused', {
        action: 'platform.auth.mfa_verify',
        outcome: 'failure',
        errorCode: 'MFA_CODE_INVALID',
        status: 422,
        tenantId: TENANT,
      });
      expect(JSON.stringify(vi.mocked(deps.logWarning).mock.calls)).not.toContain('987654');
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

  it('maps rate limits, a lost session and outages; never fails because of the audit or the e-mail', async () => {
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
    const mailDown = setup({ factors: [{ ...unfinished, id: 'f-new' }] });
    vi.mocked(mailDown.deps.requestMfaFactorMail).mockRejectedValueOnce(new Error('db down'));
    expect((await verifyTotpCode(mailDown.deps, { code: '123456', factorId: 'f-new' })).ok).toBe(
      true,
    );
    expect(mailDown.deps.logWarning).toHaveBeenCalledWith(
      'could not record an authenticator event',
      {
        action: 'platform.auth.mfa_enrolled',
      },
    );
    const noSession = await verifyTotpCode(setup({ cookie: null }).deps, { code: '123456' });
    expect(!noSession.ok && noSession.error.code).toBe('UNAUTHENTICATED');
  });

  it('without an organization before the code, it is no completed sign-in', async () => {
    const { deps, audited, calls } = setup({ cookie: 'no-tenant', factors: [verifiedApp] });
    // The upgraded token of this fake carries the tenant: only the state after the code is read.
    await verifyTotpCode(deps, { code: '123456' });
    expect(deps.getSessionAccess).toHaveBeenCalledTimes(1);
    expect(audited).toEqual(['platform.auth.mfa_verified']);
    expect(calls).not.toContain('device-limit');
  });
});

describe('requestMfaConfirmationMail', () => {
  it('asks the database for a new set-up e-mail for the waiting app', async () => {
    const { deps, calls } = setup();
    expect(await requestMfaConfirmationMail(deps)).toEqual({
      ok: true,
      value: { requested: true },
    });
    expect(calls).toEqual(['mail:added:resend']);
    const none = await requestMfaConfirmationMail(setup({ cookie: null }).deps);
    expect(!none.ok && none.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('removeTotp', () => {
  it("needs a session that passed a code (Auth's own rule), then removes the app; the database e-mails and audits it", async () => {
    const step = await removeTotp(setup({ factors: [verifiedApp] }).deps);
    expect(!step.ok && step.error.code).toBe('STEP_UP_REQUIRED');

    const { deps, calls, audited } = setup({ cookie: 'aal2', factors: [verifiedApp, unfinished] });
    expect(await removeTotp(deps)).toEqual({ ok: true, value: null });
    expect(calls).toEqual(['unenroll:f-verified', 'mail:removed:f-verified']);
    expect(audited).toEqual([]);
  });

  it('a confirmed app: only with a recent code from it (review H1/L3)', async () => {
    // A code from an unconfirmed app (Auth aal2, not the database's).
    const unconfirmed = await removeTotp(
      setup({ cookie: 'aal2', factors: [verifiedApp], confirmed: true, aal2: false }).deps,
    );
    expect(!unconfirmed.ok && unconfirmed.error.code).toBe('STEP_UP_REQUIRED');
    const stale = await removeTotp(
      setup({ cookie: 'aal2-stale', factors: [verifiedApp], confirmed: true, aal2: true }).deps,
    );
    expect(!stale.ok && stale.error.code).toBe('STEP_UP_REQUIRED');
    const fresh = setup({ cookie: 'aal2', factors: [verifiedApp], confirmed: true, aal2: true });
    expect((await removeTotp(fresh.deps)).ok).toBe(true);
    expect(fresh.calls).toEqual(['unenroll:f-verified', 'mail:removed:f-verified']);
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

describe('openMfaLink (the set-up e-mail links, review H1)', () => {
  const TOKEN = 'sample-link-token-of-the-right-length-00000'; // shape only (43 characters)

  function linkDeps() {
    return {
      confirmMfaFactor: vi.fn(() => Promise.resolve('confirmed' as const)),
      rejectMfaFactor: vi.fn(() => Promise.resolve('removed' as const)),
      logInfo: vi.fn(),
    };
  }

  it('hands the database the SHA-256 of the token only; logs the outcome, never the token', async () => {
    expect(TOKEN).toHaveLength(43);
    const deps = linkDeps();
    expect(await openMfaLink(deps, 'confirm', TOKEN)).toBe('confirmed');
    const hash = createHash('sha256').update(TOKEN, 'utf8').digest();
    expect(deps.confirmMfaFactor).toHaveBeenCalledWith(hash);
    expect(await openMfaLink(deps, 'remove', TOKEN)).toBe('removed');
    expect(deps.rejectMfaFactor).toHaveBeenCalledWith(hash);
    expect(deps.logInfo).toHaveBeenCalledWith('authenticator e-mail link opened', {
      action: 'platform.auth.mfa_confirmed',
      reason: 'confirmed',
    });
    expect(JSON.stringify(deps.logInfo.mock.calls)).not.toContain(TOKEN);
  });

  it('a malformed token never reaches the database', async () => {
    const deps = linkDeps();
    for (const token of ['', 'short', `${TOKEN}x`, `${TOKEN.slice(0, 42)}!`]) {
      expect(await openMfaLink(deps, 'confirm', token)).toBe('invalid');
    }
    expect(deps.confirmMfaFactor).not.toHaveBeenCalled();
  });
});
