import { describe, expect, it } from 'vitest';
import { type EmailVariables, renderEmail } from './index';

const HASH = 'sample0token0hash'.padEnd(56, '0'); // shape only
const reset: EmailVariables<'platform.password_reset'> = {
  organizationName: { ar: 'شركة الراية', en: 'Al Raya Company' },
  resetUrl: {
    ar: `https://tms.example.com/ar/reset-password#token_hash=${HASH}&type=recovery`,
    en: `https://tms.example.com/en/reset-password#token_hash=${HASH}&type=recovery`,
  },
  validMinutes: 60,
  loginEmail: 'sara@raya.example',
};

const changed: EmailVariables<'platform.password_changed'> = {
  organizationName: { ar: 'شركة الراية', en: null },
  forgotPasswordUrl: {
    ar: 'https://tms.example.com/ar/forgot-password',
    en: 'https://tms.example.com/en/forgot-password',
  },
  loginEmail: 'sara@raya.example',
};

/** Every href in the HTML, entities decoded. */
const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));

describe('password-reset e-mail (T-M2-17, our notification service)', () => {
  it('Arabic first: organization header, button to the Arabic page, the English page below', () => {
    const email = renderEmail('platform.password_reset', 'ar', reset);
    expect(email.version).toBe(2);
    expect(email.subject).toBe('إعادة تعيين كلمة المرور · Reset your password');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html).toContain('شركة الراية');
    expect(email.html.indexOf('تعيين كلمة مرور جديدة')).toBeLessThan(
      email.html.indexOf('Set a new password'),
    );
    // One button (primary language), the other language as a plain link; nothing else is a link.
    expect(email.html.match(/background: #0F665F/g)).toHaveLength(1);
    expect(hrefs(email.html)).toEqual([reset.resetUrl.ar, reset.resetUrl.en]);
    // The 60-minute validity, in both languages.
    expect(email.html).toContain('<b>60 دقيقة</b>');
    expect(email.html).toContain('<b>60 minutes</b>');
    expect(email.text).toContain('الرابط صالح لمدة 60 دقيقة');
    expect(email.text).toContain('The link is valid for 60 minutes');
  });

  it('the token travels in the fragment only; no one-time code, no Auth /verify link', () => {
    for (const locale of ['ar', 'en'] as const) {
      const email = renderEmail('platform.password_reset', locale, reset);
      for (const body of [email.html, email.text]) {
        // No run of 6–10 digits (a one-time code) outside colour values.
        expect(/\/verify|[?&]token=|(?<![\w#])\d{6,10}(?!\w)/.exec(body)?.[0]).toBeUndefined();
      }
      for (const href of hrefs(email.html)) {
        const url = new URL(href);
        expect(url.search).toBe('');
        expect(url.hash).toBe(`#token_hash=${HASH}&type=recovery`);
      }
      // The plain-text part carries the same links, and only them.
      const links = email.text.match(/https?:\/\/\S+/g) ?? [];
      expect(links).toEqual(
        locale === 'ar'
          ? [reset.resetUrl.ar, reset.resetUrl.en]
          : [reset.resetUrl.en, reset.resetUrl.ar],
      );
    }
  });

  it('English first when the person prefers English', () => {
    const email = renderEmail('platform.password_reset', 'en', reset);
    expect(email.subject).toBe('Reset your password · إعادة تعيين كلمة المرور');
    expect(email.html).toContain('<html lang="en" dir="ltr">');
    expect(email.html).toContain('Al Raya Company');
    expect(email.html.indexOf('Set a new password')).toBeLessThan(
      email.html.indexOf('تعيين كلمة مرور جديدة'),
    );
    expect(email.text.split('———')[0]).toContain('Reset your password');
  });

  it('refuses unsafe links and values', () => {
    for (const ar of [
      'javascript:alert(1)',
      'http://tms.example.com/ar/reset-password#token_hash=x',
      'https://tms.example.com/a\nb',
    ]) {
      expect(() =>
        renderEmail('platform.password_reset', 'ar', {
          ...reset,
          resetUrl: { ...reset.resetUrl, ar },
        }),
      ).toThrow();
    }
    expect(() =>
      renderEmail('platform.password_reset', 'ar', { ...reset, loginEmail: 'not an address' }),
    ).toThrow();
    expect(() =>
      renderEmail('platform.password_reset', 'ar', {
        ...reset,
        organizationName: { ar: 'شركة‮الراية', en: null },
      }),
    ).toThrow();
    const escaped = renderEmail('platform.password_reset', 'ar', {
      ...reset,
      organizationName: { ar: '<b>X</b>', en: null },
    });
    expect(escaped.html).toContain('&lt;b&gt;X&lt;/b&gt;');
  });
});

describe('"password changed" notice (T-M2-17)', () => {
  it('bilingual, Arabic first; its only link is the forgot-password page in each language', () => {
    const email = renderEmail('platform.password_changed', 'ar', changed);
    expect(email.subject).toBe('تغيّرت كلمة المرور · Your password was changed');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html).toContain('وأُنهيت جلسات الدخول على الأجهزة الأخرى');
    expect(email.html).toContain('The password for sara@raya.example was changed');
    expect(hrefs(email.html)).toEqual([changed.forgotPasswordUrl.ar, changed.forgotPasswordUrl.en]);
    expect(email.html).not.toMatch(/background: #0F665F/);
    expect(email.text).toContain('رسالة أمان أُرسلت إلى sara@raya.example.');
    expect(email.text).toContain('Security notice sent to sara@raya.example.');
  });

  it('English first; the English organization name falls back to the Arabic one', () => {
    const email = renderEmail('platform.password_changed', 'en', changed);
    expect(email.subject).toBe('Your password was changed · تغيّرت كلمة المرور');
    expect(email.html).toContain('<html lang="en" dir="ltr">');
    expect(email.html.indexOf('Your password was changed')).toBeLessThan(
      email.html.indexOf('تغيّرت كلمة المرور للحساب'),
    );
    expect(email.html).toContain('شركة الراية');
  });
});
