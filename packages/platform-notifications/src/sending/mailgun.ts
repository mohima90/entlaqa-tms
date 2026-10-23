import 'server-only';
import { formatFrom } from './resend';
import { type HttpProviderOptions, messageId, postToProvider } from './http-provider';
import type { EmailTransport } from './transport';

export const MAILGUN_API_ORIGINS = {
  us: 'https://api.mailgun.net',
  eu: 'https://api.eu.mailgun.net',
} as const;

/**
 * Mailgun's Messages API (WP-ADM-01): the sending domain's endpoint in the US or EU region. Tracking is off
 * for every message (links carry invitation codes). The delivery id travels as a custom variable; Mailgun has
 * no idempotency key.
 */
export function createMailgunTransport(
  options: {
    readonly apiKey: string;
    readonly domain: string;
    readonly region: 'us' | 'eu';
  } & HttpProviderOptions,
): EmailTransport {
  const url = `${MAILGUN_API_ORIGINS[options.region]}/v3/${encodeURIComponent(options.domain)}/messages`;
  const auth = Buffer.from(`api:${options.apiKey}`, 'utf8').toString('base64');
  return {
    provider: 'mailgun',
    async send(email) {
      const form = new URLSearchParams({
        from: formatFrom(email.from),
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        'o:tracking': 'no',
        'o:tracking-clicks': 'no',
        'o:tracking-opens': 'no',
        'v:delivery_id': email.idempotencyKey,
      });
      if (email.replyTo) form.set('h:Reply-To', email.replyTo);
      const response = await postToProvider(
        url,
        {
          headers: {
            authorization: `Basic ${auth}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        },
        options,
      );
      const body = (await response.json().catch(() => ({}))) as { id?: unknown };
      return { providerMessageId: messageId(body.id) };
    },
  };
}
