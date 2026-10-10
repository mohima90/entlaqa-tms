import { createHash } from 'node:crypto';
import type {
  MfaAppRemoval,
  MfaFactorMailOutcome,
  MfaSetupConfirmation,
  MyMfaApp,
  SessionAccess,
} from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { AuthServiceError } from './auth-flow';
import {
  type FactorLike,
  type MfaDeps,
  MFA_EMAIL_CODE_PATTERN,
  TOTP_ISSUER,
  confirmMfaSetup,
  getMfaOverview,
  openMfaRemoveLink,
  removeMfaApp,
  resendMfaSetupMail,
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
  /** The session's state before the code, and after it. */
  access?: State;
  accessAfter?: State;
  /** The account's apps as the database shows them to this session (re-review N1). */
  apps?: MyMfaApp[];
  mailOutcome?: MfaFactorMailOutcome;
  confirmOutcome?: MfaSetupConfirmation;
  removeOutcome?: MfaAppRemoval;
  auditFails?: boolean;
}

const verifiedApp: FactorLike = { id: 'f-verified', factor_type: 'totp', status: 'verified' };
const unfinished: FactorLike = { id: 'f-unverified', factor_type: 'totp', status: 'unverified' };
const phone: FactorLike = { id: 'f-phone', factor_type: 'phone', status: 'verified' };
const SET_UP_AT = new Date('2026-10-09T08:00:00Z');
const confirmedApp: MyMfaApp = {
  factorId: 'f-verified',
  confirmed: true,
  here: false,
  setUpAt: SET_UP_AT,
  userAgent: null,
};
/** Waiting for the e-mailed code, set up by THIS session / by another sign-in. */
const waitingHere: MyMfaApp = {
  factorId: 'f-waiting',
  confirmed: false,
  here: true,
  setUpAt: SET_UP_AT,
  userAgent: 'Mozilla/5.0 Firefox/131.0',
};
const waitingElsewhere: MyMfaApp = { ...waitingHere, factorId: 'f-elsewhere', here: false };

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
      enroll: vi.fn((_params: { factorType: 'totp'; issuer?: string; friendlyName?: string }) => {
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
        usesApp: (options.apps ?? []).some((app) => app.confirmed),
        mfaPending: false,
        aal2: false,
      });
    }),
    listMyMfaApps: vi.fn(() => Promise.resolve(options.apps ?? [])),
    requestMfaFactorMail: vi.fn((_tx, factorId: string) => {
      calls.push(`mail:added:${factorId}`);
      return Promise.resolve(options.mailOutcome ?? 'queued');
    }),
    confirmMfaSetup: vi.fn((_tx, factorId: string, code: string) => {
      calls.push(`confirm:${factorId}:${code}`);
      return Promise.resolve(options.confirmOutcome ?? 'confirmed');
    }),
    removeMfaApp: vi.fn((_tx, factorId: string) => {
      calls.push(`remove:${factorId}`);
      return Promise.resolve(options.removeOutcome ?? 'removed');
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
    expect(
      await getMfaOverview(setup({ factors: [verifiedApp], apps: [confirmedApp] }).deps),
    ).toEqual({
      ok: true,
      value: { usesApp: true, sessionVerified: false, codeFresh: false, apps: [confirmedApp] },
    });
    expect(
      await getMfaOverview(setup({ cookie: 'aal2', factors: [unfinished, phone] }).deps),
    ).toEqual({
      ok: true,
      value: { usesApp: false, sessionVerified: true, codeFresh: true, apps: [] },
    });
    expect(
      await getMfaOverview(
        setup({ cookie: 'aal2-stale', factors: [verifiedApp], apps: [waitingElsewhere] }).deps,
      ),
    ).toEqual({
      ok: true,
      value: {
        usesApp: true,
        sessionVerified: true,
        codeFresh: false,
        apps: [waitingElsewhere],
      },
    });
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
  it('asks Auth for a TOTP factor with our issuer and a unique name; never removes unfinished set-ups (re-review N1)', async () => {
    const { deps, auth, calls } = setup({ factors: [unfinished] });
    const result = await startTotpSetup(deps);
    expect(result).toEqual({
      ok: true,
      value: { factorId: 'f-new', qrCode: 'data:image/svg+xml;utf-8,<svg/>', secret: 'SECRETKEY' },
    });
    // An unfinished set-up may be another sign-in's: an AAL1 session must not cancel it.
    expect(calls).toEqual(['enroll']);
    expect(auth.mfa.enroll).toHaveBeenCalledWith(
      expect.objectContaining({
        factorType: 'totp',
        issuer: TOTP_ISSUER,
        friendlyName: expect.stringMatching(/^Jadarat authenticator [0-9a-f]{8}$/) as unknown,
      }),
    );
    expect(auth.getUser).toHaveBeenCalled(); // strict: confirmed with Auth
    await startTotpSetup(deps);
    const names = vi.mocked(auth.mfa.enroll).mock.calls.map(([params]) => params.friendlyName);
    expect(new Set(names).size).toBe(2);
  });

  it('keeps an app the account already has — confirmed, waiting, or added elsewhere', async () => {
    const result = await startTotpSetup(setup({ factors: [verifiedApp] }).deps);
    expect(!result.ok && result.error.code).toBe('MFA_ALREADY_SET_UP');
  });

  it('maps Auth refusals', async () => {
    const cases: [{ status?: number; code?: string }, string][] = [
      [{ status: 429 }, 'RATE_LIMITED'],
      [{ status: 422, code: 'mfa_factor_name_conflict' }, 'MFA_SETUP_EXPIRED'],
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
  it('the first code of a set-up: the app waits for its e-mailed code (re-review N1), nothing more yet', async () => {
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

  it('a set-up names an UNFINISHED factor of the account: never a verified one', async () => {
    const result = await verifyTotpCode(setup({ factors: [verifiedApp] }).deps, {
      code: '123456',
      factorId: 'f-verified',
    });
    expect(!result.ok && result.error.code).toBe('MFA_SETUP_EXPIRED');
  });

  it('logs (without details) a set-up the database did not record; "send again" records it later', async () => {
    const { deps } = setup({ factors: [{ ...unfinished, id: 'f-new' }], mailOutcome: 'refused' });
    expect((await verifyTotpCode(deps, { code: '123456', factorId: 'f-new' })).ok).toBe(true);
    expect(deps.logWarning).toHaveBeenCalledWith('the new authenticator app was not recorded', {
      action: 'platform.auth.mfa_enrolled',
      reason: 'refused',
    });
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

  it("a code at sign-in uses the account's CONFIRMED app; completing a refused sign-in audits it and applies the device limit", async () => {
    const { deps, calls, audited } = setup({
      factors: [phone, verifiedApp],
      apps: [confirmedApp],
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
    const { deps, audited, calls } = setup({ apps: [confirmedApp], access: 'ok' });
    await verifyTotpCode(deps, { code: '123456' });
    expect(audited).toEqual(['platform.auth.mfa_verified']);
    expect(calls).not.toContain('device-limit');
  });

  it('never challenges an app nobody confirmed — waiting here or added from another sign-in (re-review)', async () => {
    for (const apps of [[waitingHere], [waitingElsewhere], []]) {
      const { deps, calls } = setup({ factors: [verifiedApp], apps, access: 'mfa_challenge' });
      const result = await verifyTotpCode(deps, { code: '123456' });
      expect(!result.ok && result.error.code).toBe('MFA_NOT_SET_UP');
      expect(calls).toEqual([]);
    }
  });

  it('a code that leaves the session refused records nothing more', async () => {
    const { deps, audited, calls } = setup({
      apps: [confirmedApp],
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
        apps: [confirmedApp],
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
      setup({ apps: [confirmedApp], verifyError: { status: 404, code: 'mfa_factor_not_found' } })
        .deps,
      { code: '123456' },
    );
    expect(!replaced.ok && replaced.error.code).toBe('MFA_SETUP_EXPIRED');
  });

  it('maps rate limits, a lost session and outages; never fails because of the audit or the e-mail', async () => {
    const limited = await verifyTotpCode(
      setup({ apps: [confirmedApp], verifyError: { status: 429 } }).deps,
      { code: '123456' },
    );
    expect(!limited.ok && limited.error.code).toBe('RATE_LIMITED');
    await expect(
      verifyTotpCode(setup({ apps: [confirmedApp], verifyError: { status: 500 } }).deps, {
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(AuthServiceError);
    const auditDown = setup({ apps: [confirmedApp], access: 'mfa_challenge', auditFails: true });
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
    const { deps, audited, calls } = setup({ cookie: 'no-tenant', apps: [confirmedApp] });
    // The upgraded token of this fake carries the tenant: only the state after the code is read.
    await verifyTotpCode(deps, { code: '123456' });
    expect(deps.getSessionAccess).toHaveBeenCalledTimes(1);
    expect(audited).toEqual(['platform.auth.mfa_verified']);
    expect(calls).not.toContain('device-limit');
  });
});

describe('confirmMfaSetup (the e-mailed code, re-review N1)', () => {
  it("sends this window's waiting app and the code to the database; a refused session completes its sign-in", async () => {
    const { deps, calls, audited } = setup({
      cookie: 'aal2',
      apps: [waitingHere],
      access: 'mfa_enrol',
      accessAfter: 'ok',
    });
    expect(await confirmMfaSetup(deps, { code: '40718263' })).toEqual({
      ok: true,
      value: { confirmed: true },
    });
    expect(calls).toEqual(['confirm:f-waiting:40718263', 'device-limit']);
    // The database audits the confirmation; the completed sign-in is audited here.
    expect(audited).toEqual(['platform.auth.signed_in']);
  });

  it('a window that did not set the app up has nothing to confirm (the attack: the owner confirms an app someone else added)', async () => {
    const { deps, calls } = setup({ cookie: 'aal2', apps: [waitingElsewhere] });
    const result = await confirmMfaSetup(deps, { code: '40718263' });
    expect(!result.ok && result.error.code).toBe('MFA_SET_UP_ELSEWHERE');
    expect(calls).toEqual([]);
    const none = await confirmMfaSetup(setup({ cookie: 'aal2', apps: [confirmedApp] }).deps, {
      code: '40718263',
    });
    expect(!none.ok && none.error.code).toBe('MFA_NOT_SET_UP');
  });

  it("maps the database's refusals and logs them without the code", async () => {
    const cases: [MfaSetupConfirmation, string][] = [
      ['invalid', 'MFA_EMAIL_CODE_INVALID'],
      ['expired', 'MFA_EMAIL_CODE_EXPIRED'],
      ['locked', 'MFA_EMAIL_CODE_LOCKED'],
      ['refused', 'MFA_SET_UP_ELSEWHERE'],
    ];
    for (const [confirmOutcome, code] of cases) {
      const { deps, audited } = setup({ cookie: 'aal2', apps: [waitingHere], confirmOutcome });
      const result = await confirmMfaSetup(deps, { code: '11112222' });
      expect(!result.ok && result.error.code).toBe(code);
      expect(audited).toEqual([]);
      expect(deps.logWarning).toHaveBeenCalledWith('e-mailed authenticator set-up code refused', {
        action: 'platform.auth.mfa_confirm',
        outcome: 'failure',
        errorCode: code,
        tenantId: TENANT,
      });
      expect(JSON.stringify(vi.mocked(deps.logWarning).mock.calls)).not.toContain('11112222');
    }
    const noSession = await confirmMfaSetup(setup({ cookie: null }).deps, { code: '40718263' });
    expect(!noSession.ok && noSession.error.code).toBe('UNAUTHENTICATED');
    expect(MFA_EMAIL_CODE_PATTERN.test('40718263')).toBe(true);
    expect(MFA_EMAIL_CODE_PATTERN.test('4071826')).toBe(false);
  });
});

describe('resendMfaSetupMail ("send the e-mail again", re-review N1)', () => {
  it("asks the database for a new e-mail for this window's waiting app", async () => {
    const { deps, calls } = setup({ apps: [waitingHere] });
    expect(await resendMfaSetupMail(deps)).toEqual({ ok: true, value: { sent: true } });
    expect(calls).toEqual(['mail:added:f-waiting']);
    const waiting = await resendMfaSetupMail(
      setup({ apps: [waitingHere], mailOutcome: 'waiting' }).deps,
    );
    expect(waiting).toEqual({ ok: true, value: { sent: false } });
  });

  it('too soon, another window, nothing waiting, no session', async () => {
    const soon = await resendMfaSetupMail(
      setup({ apps: [waitingHere], mailOutcome: 'too_soon' }).deps,
    );
    expect(!soon.ok && soon.error.code).toBe('MFA_RESEND_TOO_SOON');
    const elsewhere = setup({ apps: [waitingElsewhere] });
    const other = await resendMfaSetupMail(elsewhere.deps);
    expect(!other.ok && other.error.code).toBe('MFA_SET_UP_ELSEWHERE');
    expect(elsewhere.calls).toEqual([]);
    const refused = await resendMfaSetupMail(
      setup({ apps: [waitingHere], mailOutcome: 'refused' }).deps,
    );
    expect(!refused.ok && refused.error.code).toBe('MFA_SET_UP_ELSEWHERE');
    const none = await resendMfaSetupMail(setup({ apps: [] }).deps);
    expect(!none.ok && none.error.code).toBe('MFA_NOT_SET_UP');
    const noSession = await resendMfaSetupMail(setup({ cookie: null }).deps);
    expect(!noSession.ok && noSession.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('removeMfaApp (through the database, re-review N1)', () => {
  it('names the app; the database decides, audits and e-mails', async () => {
    const { deps, calls, audited } = setup({ apps: [waitingElsewhere] });
    expect(await removeMfaApp(deps, { factorId: 'f-elsewhere' })).toEqual({
      ok: true,
      value: null,
    });
    expect(calls).toEqual(['remove:f-elsewhere']);
    expect(audited).toEqual([]);
  });

  it('a confirmed app needs a recent code; nothing to remove otherwise; needs Auth', async () => {
    const step = await removeMfaApp(setup({ removeOutcome: 'step_up' }).deps, {
      factorId: 'f-verified',
    });
    expect(!step.ok && step.error.code).toBe('STEP_UP_REQUIRED');
    const refused = await removeMfaApp(setup({ removeOutcome: 'refused' }).deps, {
      factorId: 'f-other',
    });
    expect(!refused.ok && refused.error.code).toBe('MFA_NOT_SET_UP');
    const { deps } = setup();
    const notConfigured = await removeMfaApp({ ...deps, supabase: null }, { factorId: 'f' });
    expect(!notConfigured.ok && notConfigured.error.code).toBe('NOT_CONFIGURED');
    const noSession = await removeMfaApp(setup({ cookie: null }).deps, { factorId: 'f' });
    expect(!noSession.ok && noSession.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('openMfaRemoveLink (the set-up e-mail\'s "not you" link, review H1)', () => {
  const TOKEN = 'sample-link-token-of-the-right-length-00000'; // shape only (43 characters)

  function linkDeps() {
    return {
      rejectMfaFactor: vi.fn(() => Promise.resolve('removed' as const)),
      logInfo: vi.fn(),
    };
  }

  it('hands the database the SHA-256 of the token only; logs the outcome, never the token', async () => {
    expect(TOKEN).toHaveLength(43);
    const deps = linkDeps();
    expect(await openMfaRemoveLink(deps, TOKEN)).toBe('removed');
    const hash = createHash('sha256').update(TOKEN, 'utf8').digest();
    expect(deps.rejectMfaFactor).toHaveBeenCalledWith(hash);
    expect(deps.logInfo).toHaveBeenCalledWith('authenticator e-mail link opened', {
      action: 'platform.auth.mfa_removed',
      reason: 'removed',
    });
    expect(JSON.stringify(deps.logInfo.mock.calls)).not.toContain(TOKEN);
  });

  it('a malformed token never reaches the database', async () => {
    const deps = linkDeps();
    for (const token of ['', 'short', `${TOKEN}x`, `${TOKEN.slice(0, 42)}!`]) {
      expect(await openMfaRemoveLink(deps, token)).toBe('invalid');
    }
    expect(deps.rejectMfaFactor).not.toHaveBeenCalled();
  });
});
