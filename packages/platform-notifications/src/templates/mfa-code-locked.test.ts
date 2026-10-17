import { describe, expect, it } from 'vitest';
import { type EmailVariables, renderEmail } from './index';

const paused: EmailVariables<'platform.mfa_code_locked'> = {
  organizationName: { ar: 'شركة الراية', en: 'Al Raya Company' },
  lockMinutes: 15,
  forgotPasswordUrl: {
    ar: 'https://tms.example.com/ar/forgot-password',
    en: 'https://tms.example.com/en/forgot-password',
  },
  loginEmail: 'sara@raya.example',
};

/** Every href in the HTML, entities decoded. */
const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));

describe('"wrong codes after your password" e-mail (integration review T-M2-11 M1)', () => {
  it('Arabic first: someone knows the password, code checks paused, set a new password, whom to tell', () => {
    const email = renderEmail('platform.mfa_code_locked', 'ar', paused);
    expect(email.version).toBe(1);
    expect(email.subject).toBe(
      'رموز تحقق خاطئة بعد إدخال كلمة مرورك · Wrong codes after your password was entered',
    );
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html.indexOf('رموز تحقق خاطئة')).toBeLessThan(
      email.html.indexOf('Wrong codes after your password'),
    );
    expect(email.text).toContain(
      'أُدخلت كلمة مرور الحساب sara@raya.example صحيحة، ثم عدة رموز تحقق خاطئة.',
    );
    expect(email.text).toContain('أوقفنا التحقق من الرموز لهذا الحساب مؤقتًا لمدة 15 دقيقة');
    expect(email.text).toContain('So we paused code checks for this account for 15 minutes.');
    // The plain advice: someone else knows the password — set a new one now, tell the administrator; the
    // reset page's own code check is not paused.
    expect(email.text).toContain(
      'فكلمة مرورك معروفة لغيرك: عيّن كلمة مرور جديدة الآن وأبلغ مدير المنظمة',
    );
    expect(email.text).toContain(
      "someone else knows your password: set a new password now and tell your organization's administrator",
    );
    expect(email.text).toContain('you can do it right away');
    // A legitimate try works again after the pause; one notice per pause.
    expect(email.text).toContain('try again after 15 minutes');
    expect(email.text).toContain('نرسل هذا التنبيه مرة واحدة على الأكثر في كل إيقاف.');
    expect(email.html).toContain('We send this notice at most once per pause.');
    expect(email.html).toContain('Security notice sent to sara@raya.example.');
    // One button (primary language), the other language as a plain link; nothing else is a link.
    expect(email.html.match(/background: #0F665F/g)).toHaveLength(1);
    expect(hrefs(email.html)).toEqual([paused.forgotPasswordUrl.ar, paused.forgotPasswordUrl.en]);
  });

  it('English first for an English-speaking member; Arabic minutes agree with their number', () => {
    const email = renderEmail('platform.mfa_code_locked', 'en', { ...paused, lockMinutes: 10 });
    expect(email.subject.startsWith('Wrong codes after your password was entered')).toBe(true);
    expect(email.html.indexOf('Wrong codes after your password')).toBeLessThan(
      email.html.indexOf('رموز تحقق خاطئة'),
    );
    expect(email.text).toContain('لمدة 10 دقائق');
    expect(email.text).toContain('for 10 minutes');
    for (const href of hrefs(email.html)) {
      const url = new URL(href);
      expect(url.pathname.endsWith('/forgot-password')).toBe(true);
      expect(url.search + url.hash).toBe('');
    }
  });

  it('refuses unsafe variables', () => {
    expect(() =>
      renderEmail('platform.mfa_code_locked', 'ar', { ...paused, lockMinutes: 0 }),
    ).toThrow();
    expect(() =>
      renderEmail('platform.mfa_code_locked', 'ar', {
        ...paused,
        forgotPasswordUrl: { ar: 'javascript:alert(1)', en: paused.forgotPasswordUrl.en },
      }),
    ).toThrow();
    expect(() =>
      renderEmail('platform.mfa_code_locked', 'ar', { ...paused, loginEmail: 'not an address' }),
    ).toThrow();
  });
});
