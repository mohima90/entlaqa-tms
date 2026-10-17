import {
  EMAIL_PROVIDER_OPTIONS,
  EMAIL_PROVIDER_SECRETS,
  type EmailProviderId,
  isEmailProvider,
} from '../providers';
import type { HttpProviderOptions } from './http-provider';
import { createMailgunTransport } from './mailgun';
import { createMicrosoftGraphTransport } from './microsoft-graph';
import { createResendTransport } from './resend';
import { createSendGridTransport } from './sendgrid';
import { type HostLookup, createSmtpTransport } from './smtp';
import { EmailSendError, type EmailTransport } from './transport';

/**
 * The transport of a provider configured in the product (WP-ADM-01): the platform sender or an organization's
 * own provider. `options` (stored in clear) and `secrets` (just opened from their sealed form) are validated
 * again here — a value the worker cannot use is PROVIDER_SETTINGS_INVALID, never a crash or a log line with
 * the value. An SMTP relay configured in the product must be on the public internet and use a submission port
 * (465, 587, 2525; SSRF) — an organization's own always; the platform sender's too, unless the operator allows
 * internal relays for it (`allowPrivatePlatformSmtp`: EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE=true, self-hosted).
 */
export function createProviderTransport(
  provider: string,
  options: unknown,
  secrets: unknown,
  context: {
    readonly organization: boolean;
    /** The platform sender's SMTP relay may be internal, on any port (operator setting). */
    readonly allowPrivatePlatformSmtp?: boolean;
    readonly http?: HttpProviderOptions;
    readonly lookup?: HostLookup;
    /** PEM of an extra certificate authority for the platform's own SMTP relay (SMTP_CA_CERT). */
    readonly smtpCaPem?: string | undefined;
  },
): EmailTransport {
  if (!isEmailProvider(provider)) throw new EmailSendError('PROVIDER_SETTINGS_INVALID', false);
  const parsedOptions = EMAIL_PROVIDER_OPTIONS[provider].safeParse(options);
  const parsedSecrets = EMAIL_PROVIDER_SECRETS[provider].safeParse(secrets);
  if (!parsedOptions.success || !parsedSecrets.success) {
    throw new EmailSendError('PROVIDER_SETTINGS_INVALID', false);
  }
  return build(provider, parsedOptions.data, parsedSecrets.data, context);
}

function build(
  provider: EmailProviderId,
  options: Record<string, unknown>,
  secrets: Record<string, unknown>,
  context: Parameters<typeof createProviderTransport>[3],
): EmailTransport {
  const http = context.http ?? {};
  const text = (record: Record<string, unknown>, key: string): string => {
    const value = record[key];
    return typeof value === 'string' ? value : '';
  };
  switch (provider) {
    case 'resend':
      return createResendTransport({ apiKey: text(secrets, 'apiKey'), ...http });
    case 'sendgrid':
      return createSendGridTransport({ apiKey: text(secrets, 'apiKey'), ...http });
    case 'mailgun':
      return createMailgunTransport({
        apiKey: text(secrets, 'apiKey'),
        domain: text(options, 'domain'),
        region: options.region === 'eu' ? 'eu' : 'us',
        ...http,
      });
    case 'microsoft_graph':
      return createMicrosoftGraphTransport({
        tenantId: text(options, 'tenantId'),
        clientId: text(options, 'clientId'),
        clientSecret: text(secrets, 'clientSecret'),
        ...http,
      });
    case 'smtp': {
      const username = text(options, 'username');
      const secure = options.security === 'tls';
      return createSmtpTransport(
        {
          host: text(options, 'host'),
          port: Number(options.port),
          secure,
          // STARTTLS is always required for a relay configured in the product (never plain text).
          requireTls: !secure,
          user: username === '' ? undefined : username,
          password: username === '' ? undefined : text(secrets, 'password'),
        },
        context.organization ? undefined : context.smtpCaPem,
        {
          publicOnly: context.organization || context.allowPrivatePlatformSmtp !== true,
          ...(context.lookup ? { lookup: context.lookup } : {}),
        },
      );
    }
  }
}
