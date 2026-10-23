import 'server-only';
import { type HttpProviderOptions, messageId, postToProvider } from './http-provider';
import type { EmailTransport } from './transport';

export const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

/**
 * SendGrid's v3 Mail Send API (WP-ADM-01; an organization's own provider or the platform sender). Click and
 * open tracking are switched off for every message: SendGrid would otherwise rewrite the links — an
 * invitation's sign-up link carries its code — through its own servers. SendGrid has no idempotency key.
 */
export function createSendGridTransport(
  options: { readonly apiKey: string } & HttpProviderOptions,
): EmailTransport {
  return {
    provider: 'sendgrid',
    async send(email) {
      const response = await postToProvider(
        SENDGRID_API_URL,
        {
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: email.to }] }],
            from: { email: email.from.address, name: email.from.name },
            ...(email.replyTo ? { reply_to: { email: email.replyTo } } : {}),
            subject: email.subject,
            // text/plain first, as the API requires.
            content: [
              { type: 'text/plain', value: email.text },
              { type: 'text/html', value: email.html },
            ],
            custom_args: { delivery_id: email.idempotencyKey },
            tracking_settings: {
              click_tracking: { enable: false, enable_text: false },
              open_tracking: { enable: false },
            },
          }),
        },
        options,
      );
      return { providerMessageId: messageId(response.headers.get('x-message-id')) };
    },
  };
}
