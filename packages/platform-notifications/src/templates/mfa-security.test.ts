import { describe, expect, it } from 'vitest';
import { type EmailVariables, renderEmail } from './index';

/** Every href in the HTML, entities decoded. */
const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));

const TOKEN = 'sample-token-of-the-right-shape-only'; // shape only, never a real token
const organizationName = { ar: 'شركة الراية', en: 'Al Raya Company' };

const added: EmailVariables<'platform.mfa_factor_added'> = {
  organizationName,
  confirmUrl: {
    ar: `https://tms.example.com/ar/mfa/confirm#token=${TOKEN}`,
    en: `https://tms.example.com/en/mfa/confirm#token=${TOKEN}`,
  },
  removeUrl: {
    ar: `https://tms.example.com/ar/mfa/remove#token=${TOKEN}-r`,
    en: `https://tms.example.com/en/mfa/remove#token=${TOKEN}-r`,
  },
  confirmValidHours: 72,
  removeValidDays: 7,
  loginEmail: 'sara@raya.example',
};

const forgotPasswordUrl = {
  ar: 'https://tms.example.com/ar/forgot-password',
  en: 'https://tms.example.com/en/forgot-password',
};

describe('authenticator app set-up e-mail (T-M2-10, review H1)', () => {
  it('Arabic first: a confirmation button, the "not you" link, both languages', () => {
    const email = renderEmail('platform.mfa_factor_added', 'ar', added);
    expect(email.subject).toBe('تأكيد تطبيق المصادقة · Confirm your authenticator app');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    // One button (the Arabic confirmation); the links: confirm and remove in each language.
    expect(hrefs(email.html)).toEqual([
      added.confirmUrl.ar,
      added.removeUrl.ar,
      added.confirmUrl.en,
      added.removeUrl.en,
    ]);
    expect(email.html.match(/background: #0F665F/g)).toHaveLength(1);
    expect(email.html).toContain('<b>72 ساعة</b>');
    expect(email.html).toContain('<b>72 hours</b>');
    for (const url of [...Object.values(added.confirmUrl), ...Object.values(added.removeUrl)]) {
      expect(email.text).toContain(url);
      // The token travels in the fragment only.
      expect(new URL(url).search).toBe('');
    }
  });

  it('English first for an English-speaking person; refuses unsafe links', () => {
    const email = renderEmail('platform.mfa_factor_added', 'en', added);
    expect(email.subject).toBe('Confirm your authenticator app · تأكيد تطبيق المصادقة');
    expect(email.html.indexOf('Confirm the app')).toBeLessThan(email.html.indexOf('تأكيد التطبيق'));
    expect(() =>
      renderEmail('platform.mfa_factor_added', 'en', {
        ...added,
        confirmUrl: { ...added.confirmUrl, en: 'javascript:alert(1)' },
      }),
    ).toThrow();
  });
});

describe('authenticator app removed notice (T-M2-10)', () => {
  it('says why, in both languages; its only link is the forgot-password page', () => {
    const cases = [
      ['removed', 'أُزيل تطبيق المصادقة من الحساب', 'The authenticator app was removed from'],
      ['not_me', 'بناءً على طلبك', 'As you asked'],
      ['admin_reset', 'أعاد مدير المنشأة ضبط', 'administrator reset the authenticator app'],
      ['support_reset', 'أعاد دعم ENTLAQA ضبط', 'ENTLAQA support reset'],
    ] as const;
    for (const [reason, ar, en] of cases) {
      const email = renderEmail('platform.mfa_factor_removed', 'ar', {
        organizationName,
        reason,
        forgotPasswordUrl,
        loginEmail: 'sara@raya.example',
      });
      expect(email.subject).toBe('أُزيل تطبيق المصادقة · Authenticator app removed');
      expect(email.html).toContain(ar);
      expect(email.html).toContain(en);
      expect(email.text).toContain(ar);
      expect(hrefs(email.html)).toEqual([forgotPasswordUrl.ar, forgotPasswordUrl.en]);
    }
    expect(() =>
      renderEmail('platform.mfa_factor_removed', 'ar', {
        organizationName,
        reason: 'whim' as never,
        forgotPasswordUrl,
        loginEmail: 'sara@raya.example',
      }),
    ).toThrow();
  });
});

describe('security settings changed notice (T-M2-10, T-IAM-24)', () => {
  const changed: EmailVariables<'platform.security_policy_changed'> = {
    organizationName,
    changedBy: { ar: 'محمد العتيبي', en: 'Mohammed Alotaibi' },
    changed: ['mfaMode', 'passwordMinLength'],
    changedAt: '2026-10-11T09:30:00Z',
    timeZone: 'Asia/Riyadh',
    settingsUrl: {
      ar: 'https://tms.example.com/ar/suite/admin/security',
      en: 'https://tms.example.com/en/suite/admin/security',
    },
    loginEmail: 'admin@raya.example',
  };

  it('names the settings (never values), who and when; links to the settings page', () => {
    const email = renderEmail('platform.security_policy_changed', 'ar', changed);
    expect(email.subject).toBe('تغيّرت إعدادات الأمان · Security settings changed');
    for (const label of [
      'التحقق متعدد العوامل',
      'أقل طول لكلمة المرور',
      'Multi-factor authentication',
      'Minimum password length',
      'محمد العتيبي',
      'Mohammed Alotaibi',
      '11 أكتوبر 2026',
      '11 October 2026',
    ]) {
      expect(email.html).toContain(label);
    }
    expect(email.html).not.toContain('Lockout duration');
    expect(hrefs(email.html)).toEqual([changed.settingsUrl.ar, changed.settingsUrl.en]);
    expect(email.text).toContain('- أقل طول لكلمة المرور');
  });

  it('without an editor (platform), English first; unknown setting names are refused', () => {
    const email = renderEmail('platform.security_policy_changed', 'en', {
      ...changed,
      changedBy: null,
    });
    expect(email.html).toContain('were changed on');
    expect(email.text).toContain('were changed on');
    expect(() =>
      renderEmail('platform.security_policy_changed', 'en', {
        ...changed,
        changed: ['secretKey' as never],
      }),
    ).toThrow();
    expect(() =>
      renderEmail('platform.security_policy_changed', 'en', { ...changed, changed: [] }),
    ).toThrow();
  });
});

describe('password-reset e-mail for an account with an app (T-M2-10)', () => {
  it('says the page will ask for the code', () => {
    const email = renderEmail('platform.password_reset', 'ar', {
      organizationName,
      resetUrl: {
        ar: 'https://tms.example.com/ar/reset-password#token_hash=x&type=recovery&mfa=1',
        en: 'https://tms.example.com/en/reset-password#token_hash=x&type=recovery&mfa=1',
      },
      validMinutes: 60,
      loginEmail: 'sara@raya.example',
      codeNeeded: true,
    });
    expect(email.html).toContain('يستخدم حسابك تطبيق مصادقة');
    expect(email.text).toContain('Your account uses an authenticator app');
  });
});
