import nodemailer from 'nodemailer';
import { formatFrom } from './resend';
import { EmailSendError, type EmailTransport } from './transport';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS (smtps, port 465); otherwise STARTTLS, required for any non-local server. */
  readonly secure: boolean;
  readonly requireTls: boolean;
  readonly user: string | undefined;
  readonly password: string | undefined;
}

/**
 * `smtps://user:pass@host:465` (implicit TLS) or `smtp://user:pass@host:587` (STARTTLS, required unless
 * the server is local, e.g. Mailpit in development). No query parameters: the URL is the whole setting.
 */
export function parseSmtpUrl(url: string): SmtpSettings {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('SMTP_URL is not a valid URL');
  }
  if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') {
    throw new Error('SMTP_URL must start with smtp:// or smtps://');
  }
  if (parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
    throw new Error('SMTP_URL must not carry a path or parameters');
  }
  if (!parsed.hostname) throw new Error('SMTP_URL has no host');
  const secure = parsed.protocol === 'smtps:';
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : secure ? 465 : 587,
    secure,
    requireTls: !secure && !LOCAL_HOSTS.has(parsed.hostname),
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

/**
 * SMTP reply codes and nodemailer error codes → our codes; 5xx refusals of the message are final. TLS
 * and login failures are the relay's configuration, never the message's, whatever reply code they
 * carry (a server without STARTTLS answers the command with 502): fixing it lets the messages go out.
 */
export function classifySmtpError(error: unknown): EmailSendError {
  const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  if (code === 'ETLS') return new EmailSendError('TLS_FAILED', false);
  if (code === 'EAUTH') return new EmailSendError('PROVIDER_AUTH', false);
  if (typeof responseCode === 'number') {
    if ([530, 534, 535, 538].includes(responseCode))
      return new EmailSendError('PROVIDER_AUTH', false);
    if (responseCode >= 500) {
      return new EmailSendError(
        [550, 551, 553].includes(responseCode) ? 'ADDRESS_REJECTED' : 'PROVIDER_REJECTED',
        true,
      );
    }
    if (responseCode >= 400) return new EmailSendError('PROVIDER_UNAVAILABLE', false);
  }
  switch (code) {
    case 'EMESSAGE':
      return new EmailSendError('MESSAGE_INVALID', true);
    case 'ECONNECTION':
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'EDNS':
      return new EmailSendError('NETWORK_ERROR', false);
    default:
      return new EmailSendError('SEND_FAILED', false);
  }
}

/**
 * SMTP to the installation's relay (sovereign deployments, ADR 0008 §2) or Mailpit (development, CI).
 * TLS is verified (chain and host name) against the system roots or `caPem`. SMTP has no idempotency
 * key: a crash between the server's acceptance and our status update can send a message twice.
 */
export function createSmtpTransport(settings: SmtpSettings, caPem?: string): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTls,
    ...(settings.user ? { auth: { user: settings.user, pass: settings.password ?? '' } } : {}),
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      servername: settings.host,
      ...(caPem ? { ca: caPem } : {}),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    provider: 'smtp',
    async send(email) {
      try {
        const domain = email.from.address.slice(email.from.address.lastIndexOf('@') + 1);
        const info = await transporter.sendMail({
          from: formatFrom(email.from),
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          messageId: `<${email.idempotencyKey}@${domain}>`,
        });
        return { providerMessageId: info.messageId.slice(0, 300) };
      } catch (error) {
        throw classifySmtpError(error);
      }
    },
    close() {
      transporter.close();
      return Promise.resolve();
    },
  };
}
