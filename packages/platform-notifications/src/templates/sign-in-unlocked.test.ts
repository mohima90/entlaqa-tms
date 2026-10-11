import { describe, expect, it } from 'vitest';
import { type EmailVariables, renderEmail } from './index';

const unlocked: EmailVariables<'platform.sign_in_unlocked'> = {
  organizationName: { ar: 'شركة الراية', en: 'Al Raya Company' },
  forgotPasswordUrl: {
    ar: 'https://tms.example.com/ar/forgot-password',
    en: 'https://tms.example.com/en/forgot-password',
  },
  loginEmail: 'sara@raya.example',
};

/** Every href in the HTML, entities decoded. */
const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));

describe('sign-in unlocked e-mail (T-M2-11, security review M1)', () => {
  it('Arabic first: the organization ended the pause; what to do if unexpected', () => {
    const email = renderEmail('platform.sign_in_unlocked', 'ar', unlocked);
    expect(email.version).toBe(1);
    expect(email.subject).toBe(
      'أُلغي إيقاف تسجيل الدخول إلى حسابك · Sign-in to your account was unlocked',
    );
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html.indexOf('أُلغي إيقاف تسجيل الدخول')).toBeLessThan(
      email.html.indexOf('Sign-in to your account was unlocked'),
    );
    expect(email.text).toContain('ألغى مدير المنشأة في شركة الراية هذا الإيقاف');
    expect(email.text).toContain('an administrator of Al Raya Company has ended the pause');
    expect(email.text).toContain("If the attempts weren't yours, or you didn't ask for this");
    expect(email.html).toContain('Security notice sent to sara@raya.example.');
  });

  it('English first for an English-speaking member; its only links are the forgot-password page', () => {
    const email = renderEmail('platform.sign_in_unlocked', 'en', unlocked);
    expect(email.subject.startsWith('Sign-in to your account was unlocked')).toBe(true);
    expect(email.html.indexOf('Sign-in to your account was unlocked')).toBeLessThan(
      email.html.indexOf('أُلغي إيقاف تسجيل الدخول'),
    );
    expect(hrefs(email.html)).toEqual([
      unlocked.forgotPasswordUrl.en,
      unlocked.forgotPasswordUrl.ar,
    ]);
    for (const href of hrefs(email.html)) {
      const url = new URL(href);
      expect(url.pathname.endsWith('/forgot-password')).toBe(true);
      expect(url.search + url.hash).toBe('');
    }
  });

  it('an organization without an English name keeps its Arabic name in English', () => {
    const email = renderEmail('platform.sign_in_unlocked', 'en', {
      ...unlocked,
      organizationName: { ar: 'شركة الراية', en: null },
    });
    expect(email.text).toContain('an administrator of شركة الراية has ended the pause');
  });

  it('refuses unsafe variables and escapes names', () => {
    expect(() =>
      renderEmail('platform.sign_in_unlocked', 'ar', {
        ...unlocked,
        forgotPasswordUrl: { ar: 'javascript:alert(1)', en: unlocked.forgotPasswordUrl.en },
      }),
    ).toThrow();
    expect(() =>
      renderEmail('platform.sign_in_unlocked', 'ar', { ...unlocked, loginEmail: 'not an address' }),
    ).toThrow();
    const email = renderEmail('platform.sign_in_unlocked', 'en', {
      ...unlocked,
      organizationName: { ar: 'الراية', en: 'Raya <b>Co</b>' },
    });
    expect(email.html).not.toContain('<b>Co</b>');
    expect(email.html).toContain('Raya &lt;b&gt;Co&lt;/b&gt;');
  });
});
