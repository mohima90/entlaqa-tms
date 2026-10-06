import { describe, expect, it } from 'vitest';
import { renderEmail } from './index';
import type { EmailVariables } from './index';

const variables: EmailVariables<'platform.invitation'> = {
  recipientName: { ar: 'نورة', en: 'Noura' },
  inviterName: { ar: 'محمد العتيبي', en: 'Mohammed Alotaibi' },
  organizationName: { ar: 'شركة الراية', en: 'Al Raya Company' },
  roleName: { ar: 'منسق التدريب', en: 'Training Coordinator' },
  acceptUrl: 'https://raya.jadarat.example/ar/invite/accept?token=abc123',
  expiresAt: '2026-10-11T09:00:00+03:00',
  timeZone: 'Asia/Riyadh',
  loginEmail: 'n.aldossari@alraya.example',
};

describe('invitation e-mail', () => {
  it('Arabic first: subject, both languages, button, expiry in the organization time zone', () => {
    const email = renderEmail('platform.invitation', 'ar', variables);
    expect(email.version).toBe(1);
    expect(email.subject).toBe('دعوة للانضمام إلى نظام التدريب في شركة الراية');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html).toContain('مرحبًا نورة،');
    expect(email.html).toContain('لديك دعوة من <b>محمد العتيبي</b>');
    expect(email.html).toContain('بدور <b>منسق التدريب</b>');
    expect(email.html).toContain('الأحد، 11 أكتوبر 2026');
    expect(email.html).toContain('<td lang="en" dir="ltr"');
    expect(email.html).toContain('Sunday, 11 October 2026');
    // The action is a button in the primary language and a plain link in the other.
    expect(email.html.indexOf('قبول الدعوة')).toBeLessThan(email.html.indexOf('Accept invitation'));
    expect(email.html.match(/background: #0F665F/g)).toHaveLength(1);
    expect(email.html).toContain(
      'href="https://raya.jadarat.example/ar/invite/accept?token=abc123"',
    );
    expect(email.text.split('———')[0]).toContain('مرحبًا نورة،');
    expect(email.text).toContain('Hello Noura,');
    expect(email.text).not.toContain('<');
  });

  it('English first when the invitation is in English; names fall back to Arabic', () => {
    const email = renderEmail('platform.invitation', 'en', {
      ...variables,
      recipientName: { ar: 'نورة', en: null },
      organizationName: { ar: 'شركة الراية', en: null },
    });
    expect(email.subject).toBe('Invitation to join the training system of شركة الراية');
    expect(email.html).toContain('<html lang="en" dir="ltr">');
    expect(email.html).toContain('Hello نورة,');
    expect(email.html.indexOf('Accept invitation')).toBeLessThan(email.html.indexOf('قبول الدعوة'));
  });

  it('escapes every value and refuses unsafe links or values', () => {
    const email = renderEmail('platform.invitation', 'ar', {
      ...variables,
      inviterName: { ar: '<script>alert(1)</script>', en: '"><img src=x onerror=alert(1)>' },
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).not.toContain('<img');
    for (const acceptUrl of [
      'javascript:alert(1)',
      'http://raya.jadarat.example/accept',
      'https://user:pass@raya.example/x',
      'not a url',
      // The parser would strip or encode these, but the template outputs the string as given.
      'https://raya.example/a\nExtra line',
      ' https://raya.example/a',
      'https://raya.example/a\tb',
      'https://raya.example/a\u202eb',
    ]) {
      expect(() => renderEmail('platform.invitation', 'ar', { ...variables, acceptUrl })).toThrow();
    }
    expect(() =>
      renderEmail('platform.invitation', 'ar', {
        ...variables,
        recipientName: { ar: 'نورة\nBcc: x@y.z', en: null },
      }),
    ).toThrow();
    for (const ar of ['نورة\u202Eأحمد', 'نورة\u2066x\u2069', 'نورة\u2028x', 'نورة\u0000']) {
      expect(() =>
        renderEmail('platform.invitation', 'ar', { ...variables, inviterName: { ar, en: null } }),
      ).toThrow();
    }
    // Joiners and direction marks used in Arabic text are fine.
    expect(() =>
      renderEmail('platform.invitation', 'ar', {
        ...variables,
        organizationName: { ar: 'شركة\u200Cالراية\u200F', en: null },
      }),
    ).not.toThrow();
    expect(() =>
      renderEmail('platform.invitation', 'ar', { ...variables, timeZone: 'Mars/Olympus' }),
    ).toThrow();
    expect(() =>
      renderEmail('platform.invitation', 'ar', { ...variables, loginEmail: 'a <b@c.d>' }),
    ).toThrow();
  });

  it('accepts a local development link', () => {
    expect(() =>
      renderEmail('platform.invitation', 'ar', {
        ...variables,
        acceptUrl: 'http://localhost:3000/ar/invite/accept?token=x',
      }),
    ).not.toThrow();
  });
});
