import { describe, expect, it } from 'vitest';
import { arabicMinutes } from './account-locked';
import { type EmailVariables, renderEmail } from './index';

const locked: EmailVariables<'platform.account_locked'> = {
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

describe('account locked e-mail (T-M2-11, PO decision 9 Oct 2026)', () => {
  it('Arabic first: what happened, when it lifts, the reset page, and whom to tell', () => {
    const email = renderEmail('platform.account_locked', 'ar', locked);
    expect(email.version).toBe(1);
    expect(email.subject).toBe(
      'أُوقف تسجيل الدخول إلى حسابك مؤقتًا · Sign-in to your account was paused',
    );
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html.indexOf('أُوقف تسجيل الدخول')).toBeLessThan(
      email.html.indexOf('Sign-in to your account was paused'),
    );
    expect(email.html).toContain('<b>15 دقيقة</b>');
    expect(email.html).toContain('<b>15 minutes</b>');
    expect(email.html).toContain('مدير المنظمة');
    expect(email.html).toContain('administrator');
    expect(email.text).toContain('يُرفع الإيقاف تلقائيًا بعد 15 دقيقة');
    expect(email.text).toContain('The pause ends by itself after 15 minutes');
    // Remembered browsers (opt-in) still sign in; a new password ends the pause at once (security review
    // M2); at most one notice a day (M3).
    expect(email.text).toContain('«تذكّر هذا المتصفح»');
    expect(email.text).toContain('“Remember this browser” can still sign in');
    // Re-review N1: the reset trusts its browser for a day, or 30 days with the box ticked.
    expect(email.text).toContain(
      'يُنهي الإيقاف فورًا، ويبقى بإمكان المتصفح الذي تستخدمه لذلك الدخول يومًا واحدًا إن أُوقف تسجيل الدخول من جديد، أو 30 يومًا إن اخترت فيه «تذكّر هذا المتصفح»',
    );
    expect(email.text).toContain(
      'The browser you use for it can still sign in for a day if sign-in is paused again — or for 30 days if you tick “Remember this browser” there; other browsers need to sign in again.',
    );
    expect(email.text).not.toContain('The browser you use for it is remembered;');
    expect(email.text).toContain('نرسل هذا التنبيه مرة واحدة في اليوم على الأكثر.');
    expect(email.html).toContain('We send this notice at most once a day.');
    // No promise for browsers that merely signed in before (trust is opt-in).
    expect(email.text).not.toContain('signed in with before');
    // One button (primary language), the other language as a plain link; nothing else is a link.
    expect(email.html.match(/background: #0F665F/g)).toHaveLength(1);
    expect(hrefs(email.html)).toEqual([locked.forgotPasswordUrl.ar, locked.forgotPasswordUrl.en]);
  });

  it('English first for an English-speaking member; links never sign anyone in', () => {
    const email = renderEmail('platform.account_locked', 'en', locked);
    expect(email.subject.startsWith('Sign-in to your account was paused')).toBe(true);
    expect(email.html.indexOf('Sign-in to your account was paused')).toBeLessThan(
      email.html.indexOf('أُوقف تسجيل الدخول'),
    );
    for (const href of hrefs(email.html)) {
      const url = new URL(href);
      expect(url.pathname.endsWith('/forgot-password')).toBe(true);
      expect(url.search + url.hash).toBe('');
    }
  });

  it('refuses unsafe variables', () => {
    expect(() =>
      renderEmail('platform.account_locked', 'ar', { ...locked, lockMinutes: 0 }),
    ).toThrow();
    expect(() =>
      renderEmail('platform.account_locked', 'ar', {
        ...locked,
        forgotPasswordUrl: { ar: 'javascript:alert(1)', en: locked.forgotPasswordUrl.en },
      }),
    ).toThrow();
    expect(() =>
      renderEmail('platform.account_locked', 'ar', { ...locked, loginEmail: 'not an address' }),
    ).toThrow();
  });

  it('counts minutes in Arabic with the right agreement', () => {
    expect(arabicMinutes(1)).toBe('دقيقة واحدة');
    expect(arabicMinutes(2)).toBe('دقيقتين');
    expect(arabicMinutes(3)).toBe('3 دقائق');
    expect(arabicMinutes(10)).toBe('10 دقائق');
    expect(arabicMinutes(11)).toBe('11 دقيقة');
    expect(arabicMinutes(15)).toBe('15 دقيقة');
    expect(arabicMinutes(60)).toBe('60 دقيقة');
    expect(arabicMinutes(103)).toBe('103 دقائق');
  });
});
