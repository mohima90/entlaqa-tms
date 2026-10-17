import type { EmailTestState } from '@jadarat/platform-db';
import { reasonText } from '../../lib/email-reasons';

/**
 * The latest test e-mail of a sender, in one line (WP-ADM-01): waiting, being sent, sent, or not sent with
 * the reason in plain words (our error code, never the provider's text). Server component: dates are
 * formatted by the page. A polite live region, so the refreshed status is announced.
 */
export function EmailTestLine({
  test,
  texts,
  format,
}: {
  readonly test: EmailTestState;
  readonly texts: Readonly<Record<string, string>>;
  readonly format: (date: Date) => string;
}) {
  const recipient = test.recipientMasked ?? '';
  const fill = (key: string, values: Record<string, string>) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      texts[key] ?? key,
    );
  const line =
    test.status === 'sent'
      ? fill('testStatus.sent', { recipient, date: test.finishedAt ? format(test.finishedAt) : '' })
      : test.status === 'failed'
        ? fill('testStatus.failed', { recipient, reason: reasonText(test.errorCode, texts) })
        : fill(`testStatus.${test.status}`, { recipient });
  return (
    <p
      role="status"
      className={`m-0 text-sm ${test.status === 'failed' ? 'font-medium text-danger' : 'text-text-muted'}`}
      data-testid="email-test-status"
      data-status={test.status}
    >
      <bdi>{line}</bdi>
    </p>
  );
}
