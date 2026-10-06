import { randomUUID } from 'node:crypto';
import { isEmailAddress } from '../address';
import { renderEmail } from '../templates/index';
import type { EmailTransport, OutgoingEmail } from './transport';

/**
 * Operators' check of the e-mail settings (worker `test-email` mode): sends a sample invitation with
 * made-up names, straight through the provider (no database). Returns the provider's message id.
 */
export async function sendTestEmail(
  transport: EmailTransport,
  from: OutgoingEmail['from'],
  to: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isEmailAddress(to)) throw new Error('EMAIL_TEST_TO must be an e-mail address');
  const email = renderEmail('platform.invitation', 'ar', {
    recipientName: { ar: 'زميلنا العزيز', en: 'Colleague' },
    inviterName: { ar: 'فريق جدارات', en: 'The Jadarat team' },
    organizationName: { ar: 'رسالة تجريبية', en: 'Test message' },
    roleName: { ar: 'متدرب', en: 'Learner' },
    acceptUrl: 'https://example.com/jadarat-test-email',
    expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    timeZone: 'Asia/Riyadh',
    loginEmail: to,
  });
  const result = await transport.send({
    from,
    to,
    subject: `[TEST] ${email.subject}`,
    html: email.html,
    text: email.text,
    idempotencyKey: randomUUID(),
  });
  return result.providerMessageId;
}
