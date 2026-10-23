import { renderEmail } from '@jadarat/platform-notifications';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_MAIL_HOURLY_CAP,
  type AccountMailKind,
  MFA_CODE_VALID_HOURS,
  MFA_REMOVE_VALID_DAYS,
  RESET_LINK_VALID_MINUTES,
  SECURITY_NOTICE_KINDS,
  accountMailVerdict,
  appPages,
  composeAccountNotice,
  composeMfaSetUp,
  composeReset,
  hashLinkToken,
  hashMfaSetupCode,
  newMfaRemoveToken,
  newMfaSetupCode,
  quietMinutesFor,
} from './account-mail-compose';

const CAPS = { personQuietHours: 24, tenantPerHour: 50 };
const BASE = 'https://tms.example.com';
const ORG = { ar: 'شركة الراية', en: 'Al Raya' };
const EMAIL = 'noura@raya.example';
const none = { recentCount: 0, quietCount: 0, tenantRecentCount: 0 };

describe('may this e-mail go now?', () => {
  it('the quiet period: a day for the lockout e-mail, the pause for the wrong-codes notice, none for the rest', () => {
    expect(quietMinutesFor('account_locked', 15, CAPS)).toBe(24 * 60);
    expect(quietMinutesFor('mfa_code_locked', 15, CAPS)).toBe(15);
    expect(quietMinutesFor('mfa_code_locked', null, CAPS)).toBe(1);
    expect(quietMinutesFor('mfa_code_locked', 99_999, CAPS)).toBe(1440);
    expect(quietMinutesFor('password_changed', 15, CAPS)).toBe(0);
  });

  it('a notice that is not a security notice stops at the hourly cap; a security notice is sent anyway and flagged', () => {
    const capped = { ...none, recentCount: ACCOUNT_MAIL_HOURLY_CAP };
    expect(accountMailVerdict('sign_in_unlocked', capped, CAPS)).toEqual({
      send: false,
      reason: 'hourly_cap',
    });
    expect(accountMailVerdict('account_locked', capped, CAPS)).toEqual({
      send: false,
      reason: 'hourly_cap',
    });
    for (const kind of SECURITY_NOTICE_KINDS) {
      expect(accountMailVerdict(kind, capped, CAPS)).toEqual({ send: true, overCap: true });
    }
    expect(accountMailVerdict('password_changed', { ...none, recentCount: 4 }, CAPS)).toEqual({
      send: true,
      overCap: false,
    });
  });

  it('the lockout e-mail: one a day per person and a ceiling per organization; the wrong-codes notice one per pause', () => {
    expect(accountMailVerdict('account_locked', { ...none, quietCount: 1 }, CAPS)).toEqual({
      send: false,
      reason: 'already_notified',
    });
    expect(accountMailVerdict('account_locked', { ...none, tenantRecentCount: 50 }, CAPS)).toEqual({
      send: false,
      reason: 'organization_hourly_cap',
    });
    expect(accountMailVerdict('account_locked', { ...none, tenantRecentCount: 49 }, CAPS)).toEqual({
      send: true,
      overCap: false,
    });
    expect(accountMailVerdict('mfa_code_locked', { ...none, quietCount: 1 }, CAPS)).toEqual({
      send: false,
      reason: 'already_notified',
    });
    // The other kinds do not look at the quiet period or the organization's ceiling.
    expect(
      accountMailVerdict(
        'password_changed',
        { recentCount: 0, quietCount: 3, tenantRecentCount: 999 },
        CAPS,
      ),
    ).toEqual({ send: true, overCap: false });
  });
});

describe('what each account e-mail says', () => {
  const input = {
    organizationName: ORG,
    loginEmail: EMAIL,
    appBase: BASE,
    lockMinutes: 15,
    mfaReason: null,
    policyChange: null,
    changedByName: null,
    digest: null,
  } as const;

  it("every notice renders in both languages with the worker's variables", () => {
    const kinds: Exclude<AccountMailKind, 'password_reset' | 'mfa_factor_added'>[] = [
      'password_changed',
      'sign_in_unlocked',
      'account_locked',
      'mfa_code_locked',
    ];
    for (const kind of kinds) {
      const plan = composeAccountNotice({ ...input, kind });
      for (const locale of ['ar', 'en'] as const) {
        const rendered = renderEmail(plan.template, locale, plan.variables as never);
        expect(rendered.subject.length).toBeGreaterThan(0);
        expect(rendered.text).toContain(`${BASE}/${locale}/forgot-password`);
        expect(rendered.text).toContain(EMAIL);
      }
    }
    const locked = composeAccountNotice({ ...input, kind: 'account_locked', lockMinutes: 30 });
    expect(locked.variables).toMatchObject({ lockMinutes: 30 });
    // No minutes stated: the default of the lock.
    expect(
      composeAccountNotice({ ...input, kind: 'account_locked', lockMinutes: null }).variables,
    ).toMatchObject({ lockMinutes: 15 });
  });

  it('the removal notice says why (removed unless told otherwise)', () => {
    const named = composeAccountNotice({
      ...input,
      kind: 'mfa_factor_removed',
      mfaReason: 'not_me',
    });
    expect(named.variables).toMatchObject({ reason: 'not_me' });
    renderEmail(named.template, 'en', named.variables as never);
    expect(composeAccountNotice({ ...input, kind: 'mfa_factor_removed' }).variables).toMatchObject({
      reason: 'removed',
    });
  });

  it('the policy-change notice needs what changed; who changed it and when are shown', () => {
    expect(() => composeAccountNotice({ ...input, kind: 'security_policy_changed' })).toThrow(
      'policy change without its detail',
    );
    const plan = composeAccountNotice({
      ...input,
      kind: 'security_policy_changed',
      policyChange: {
        changed: ['lockoutThreshold'],
        changedByPersonId: 'p1',
        changedAt: new Date('2026-10-23T10:00:00.000Z'),
      },
      changedByName: { ar: 'مدير', en: 'Admin' },
    });
    expect(plan.variables).toMatchObject({
      changedBy: { ar: 'مدير', en: 'Admin' },
      changedAt: '2026-10-23T10:00:00.000Z',
      settingsUrl: { ar: `${BASE}/ar/suite/admin/security`, en: `${BASE}/en/suite/admin/security` },
    });
    renderEmail(plan.template, 'en', plan.variables as never);
    try {
      composeAccountNotice({ ...input, kind: 'security_policy_changed' });
    } catch (error) {
      // A request a retry cannot fix: the caller removes it.
      expect(error).toMatchObject({ code: 'POLICY_CHANGE_DETAIL_MISSING', temporary: false });
    }
  });

  it('the digest needs the held notices', () => {
    expect(() => composeAccountNotice({ ...input, kind: 'security_digest' })).toThrow(
      'security digest without its detail',
    );
    const plan = composeAccountNotice({
      ...input,
      kind: 'security_digest',
      digest: { held: { password_changed: 2 }, since: new Date('2026-10-23T09:00:00.000Z') },
    });
    renderEmail(plan.template, 'en', plan.variables as never);
    expect(plan.variables).toMatchObject({ held: { password_changed: 2 } });
  });

  it('the authenticator set-up e-mail: the code, the browser, the "not you" link with its token in the fragment', () => {
    const variables = composeMfaSetUp({
      organizationName: ORG,
      loginEmail: EMAIL,
      appBase: BASE,
      code: '12345678',
      removeToken: 'tok-1',
      setUpAt: new Date('2026-10-23T10:00:00.000Z'),
      browser: 'Chrome',
      system: 'Windows',
    });
    expect(variables).toMatchObject({
      code: '12345678',
      setUpAt: '2026-10-23T10:00:00.000Z',
      removeUrl: {
        ar: `${BASE}/ar/mfa/remove#token=tok-1`,
        en: `${BASE}/en/mfa/remove#token=tok-1`,
      },
      codeValidHours: MFA_CODE_VALID_HOURS,
      removeValidDays: MFA_REMOVE_VALID_DAYS,
    });
    renderEmail('platform.mfa_factor_added', 'en', variables);
    renderEmail('platform.mfa_factor_added_platform', 'ar', variables);
  });

  it("the reset e-mail: Auth's token hash in the fragment, a code flag for an account with an app, the link's lifetime", () => {
    const plain = composeReset({
      organizationName: ORG,
      loginEmail: EMAIL,
      appBase: BASE,
      tokenHash: 'ab12cd34ef56ab12cd34ef56',
      codeNeeded: false,
    });
    expect(plain).toMatchObject({
      resetUrl: {
        ar: `${BASE}/ar/reset-password#token_hash=ab12cd34ef56ab12cd34ef56&type=recovery`,
        en: `${BASE}/en/reset-password#token_hash=ab12cd34ef56ab12cd34ef56&type=recovery`,
      },
      validMinutes: RESET_LINK_VALID_MINUTES,
      codeNeeded: false,
    });
    const withApp = composeReset({
      organizationName: ORG,
      loginEmail: EMAIL,
      appBase: BASE,
      tokenHash: 'ab12cd34ef56ab12cd34ef56',
      codeNeeded: true,
    });
    expect(withApp.resetUrl.en.endsWith('&type=recovery&mfa=1')).toBe(true);
    renderEmail('platform.password_reset', 'en', withApp);
  });

  it('pages of the app in both languages', () => {
    expect(appPages(BASE)('forgot-password')).toEqual({
      ar: `${BASE}/ar/forgot-password`,
      en: `${BASE}/en/forgot-password`,
    });
  });
});

describe('codes and hashes', () => {
  it('a set-up code is eight digits, a link token 43 URL-safe characters; fresh each time', () => {
    expect(newMfaSetupCode()).toMatch(/^\d{8}$/);
    expect(newMfaRemoveToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newMfaRemoveToken()).not.toBe(newMfaRemoveToken());
  });

  it("the code's hash is bound to its app, as the database checks it", () => {
    const factor = 'f3000000-0000-4000-8000-0000000000a1';
    expect(hashMfaSetupCode(factor, '12345678')).toHaveLength(32);
    expect(hashMfaSetupCode(factor, '12345678')).toEqual(
      hashMfaSetupCode(factor.toUpperCase(), '12345678'),
    );
    expect(hashMfaSetupCode(factor, '12345678')).not.toEqual(
      hashMfaSetupCode('f3000000-0000-4000-8000-0000000000a2', '12345678'),
    );
    expect(hashLinkToken('tok-1')).toHaveLength(32);
    expect(hashLinkToken('tok-1')).not.toEqual(hashLinkToken('tok-2'));
  });
});
