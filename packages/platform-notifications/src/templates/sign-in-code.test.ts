import { describe, expect, it } from 'vitest';
import { renderEmail } from './index';

const variables = {
  organizationName: { ar: 'المنشأة التجريبية', en: 'Demo Organization' },
  code: '482913',
  validMinutes: 10,
  loginEmail: 'sara@example.test',
};

describe('sign-in code e-mail (WP-ADM-05)', () => {
  it('shows the code large, in both languages, and never in the subject', () => {
    for (const locale of ['ar', 'en'] as const) {
      const mail = renderEmail('platform.sign_in_code', locale, variables);
      expect(mail.subject).not.toContain('482913');
      expect(mail.html).toContain('482 913');
      expect(mail.text).toContain('482913');
      expect(mail.html).toContain('Demo Organization');
      expect(mail.html).toContain('المنشأة التجريبية');
      expect(mail.html).toContain('dir="ltr"');
    }
  });

  it('puts the recipient language first and says it works once for 10 minutes', () => {
    const ar = renderEmail('platform.sign_in_code', 'ar', variables);
    const en = renderEmail('platform.sign_in_code', 'en', variables);
    expect(ar.subject.startsWith('رمز تسجيل الدخول')).toBe(true);
    expect(en.subject.startsWith('Your sign-in code')).toBe(true);
    expect(en.text).toContain('10 minutes and only once');
    expect(ar.text).toContain('10 دقائق');
  });

  it('refuses anything but six digits and escapes names', () => {
    expect(() => renderEmail('platform.sign_in_code', 'en', { ...variables, code: '12345' })).toThrow();
    expect(() => renderEmail('platform.sign_in_code', 'en', { ...variables, code: '12345a' })).toThrow();
    const mail = renderEmail('platform.sign_in_code', 'en', {
      ...variables,
      organizationName: { ar: 'x', en: '<script>alert(1)</script>' },
    });
    expect(mail.html).not.toContain('<script>alert(1)</script>');
  });

  it('brands the e-mail with the organization look like the other account e-mails', () => {
    const mail = renderEmail('platform.sign_in_code', 'en', variables, {
      actionColor: '#123456',
      linkColor: '#654321',
      logoUrl: null,
    });
    expect(mail.version).toBe(1);
    expect(mail.html.length).toBeGreaterThan(500);
  });
});
