import { describe, expect, it } from 'vitest';
import { renderEmail } from './index';

describe('test e-mail of the sender settings (WP-ADM-01)', () => {
  it('both languages, the primary first, the sender and provider named, no link', () => {
    const email = renderEmail('platform.email_test', 'en', {
      senderOwner: { ar: 'الراية', en: 'Al Raya' },
      provider: 'microsoft_graph',
      fromAddress: 'training@raya.example',
    });
    expect(email.subject).toBe('Test message · رسالة تجريبية');
    expect(email.html.indexOf('Your e-mail sending settings work')).toBeLessThan(
      email.html.indexOf('إعدادات إرسال البريد تعمل'),
    );
    expect(email.html).toContain('Microsoft 365');
    expect(email.html).toContain('training@raya.example');
    expect(email.html).not.toContain('href=');
    expect(email.text).toContain('from the e-mail settings of Al Raya');
    expect(email.text).toContain('في الراية');
    expect(
      renderEmail('platform.email_test', 'ar', {
        senderOwner: { ar: 'جدارات', en: 'Jadarat' },
        provider: 'smtp',
        fromAddress: 'no-reply@jadarat.example',
      }).subject,
    ).toBe('رسالة تجريبية · Test message');
  });

  it('escapes what admins typed', () => {
    const email = renderEmail('platform.email_test', 'en', {
      senderOwner: { ar: '<b>x</b>', en: '<script>x</script>' },
      provider: 'resend',
      fromAddress: 'a@x.example',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
