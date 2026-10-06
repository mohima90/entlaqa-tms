import { describe, expect, it, vi } from 'vitest';
import { sendTestEmail } from './test-email';
import type { EmailTransport } from './transport';

describe('sendTestEmail', () => {
  it('sends a sample invitation marked as a test to the given address', async () => {
    const send = vi.fn<EmailTransport['send']>(() =>
      Promise.resolve({ providerMessageId: 'msg_9' }),
    );
    const id = await sendTestEmail(
      { provider: 'resend', send },
      { name: 'ENTLAQA LMS', address: 'noreply@lms.entlaqa.com' },
      'po@example.com',
      new Date('2026-10-06T10:00:00Z'),
    );
    expect(id).toBe('msg_9');
    const email = send.mock.calls[0]?.[0];
    expect(email?.to).toBe('po@example.com');
    expect(email?.subject).toBe('[TEST] دعوة للانضمام إلى نظام التدريب في رسالة تجريبية');
    expect(email?.html).toContain('الثلاثاء، 13 أكتوبر 2026');
    expect(email?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      sendTestEmail({ provider: 'resend', send }, { name: 'x', address: 'a@b.co' }, 'nope'),
    ).rejects.toThrow('EMAIL_TEST_TO');
  });
});
