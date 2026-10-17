import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
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
 * Ports an ORGANIZATION's relay may use (WP-ADM-01): the SMTP submission ports. The platform's and the
 * installation's relays (set by ENTLAQA's operators) may use any port.
 */
export const ORGANIZATION_SMTP_PORTS: ReadonlySet<number> = new Set([25, 465, 587, 2525]);

/** Addresses no organization's relay may point the worker at: its own and private networks (SSRF). */
const BLOCKED = new BlockList();
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const BLOCKED_V6: readonly (readonly [string, number])[] = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];
for (const [network, prefix] of BLOCKED_V4) BLOCKED.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of BLOCKED_V6) BLOCKED.addSubnet(network, prefix, 'ipv6');

/** True for an address on the public internet (IPv4-mapped IPv6 addresses are checked as IPv4). */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return isIP(mapped[1]) === 4 && !BLOCKED.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  if (family === 6) return !BLOCKED.check(address, 'ipv6');
  return false;
}

export type HostLookup = (host: string) => Promise<readonly { readonly address: string }[]>;
const systemLookup: HostLookup = (host) => dnsLookup(host, { all: true, verbatim: true });

function nodemailerTransport(settings: SmtpSettings, connectTo: string, caPem: string | undefined) {
  return nodemailer.createTransport({
    host: connectTo,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTls,
    ...(settings.user ? { auth: { user: settings.user, pass: settings.password ?? '' } } : {}),
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      // The certificate is checked against the configured host name, also when connecting by address.
      servername: settings.host,
      ...(caPem ? { ca: caPem } : {}),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/**
 * SMTP to a relay: the installation's (sovereign deployments, ADR 0008 §2), the platform sender's, an
 * organization's own (Email integration) or Mailpit (development, CI). TLS is verified (chain and host
 * name) against the system roots or `caPem`. SMTP has no idempotency key: a crash between the server's
 * acceptance and our status update can send a message twice.
 *
 * `publicOnly` (an organization's relay, WP-ADM-01): the host name is resolved before every send and the
 * worker connects to that address only when every address of the name is on the public internet and the
 * port is a submission port — an Organization Admin cannot point the worker at its own network (SSRF); the
 * refusal is SMTP_HOST_NOT_ALLOWED.
 */
export function createSmtpTransport(
  settings: SmtpSettings,
  caPem?: string,
  options: { readonly publicOnly?: boolean; readonly lookup?: HostLookup } = {},
): EmailTransport {
  const shared = options.publicOnly ? null : nodemailerTransport(settings, settings.host, caPem);
  const lookup = options.lookup ?? systemLookup;
  const connect = async () => {
    if (shared) return { transporter: shared, once: false };
    if (!ORGANIZATION_SMTP_PORTS.has(settings.port)) {
      throw new EmailSendError('SMTP_HOST_NOT_ALLOWED', false);
    }
    let addresses: readonly { readonly address: string }[];
    try {
      addresses = isIP(settings.host) ? [{ address: settings.host }] : await lookup(settings.host);
    } catch {
      throw new EmailSendError('NETWORK_ERROR', false);
    }
    const first = addresses[0];
    if (!first || addresses.some((a) => !isPublicAddress(a.address))) {
      throw new EmailSendError('SMTP_HOST_NOT_ALLOWED', false);
    }
    return { transporter: nodemailerTransport(settings, first.address, caPem), once: true };
  };
  return {
    provider: 'smtp',
    async send(email) {
      const { transporter, once } = await connect();
      try {
        const domain = email.from.address.slice(email.from.address.lastIndexOf('@') + 1);
        const info = await transporter.sendMail({
          from: formatFrom(email.from),
          to: email.to,
          ...(email.replyTo ? { replyTo: email.replyTo } : {}),
          subject: email.subject,
          html: email.html,
          text: email.text,
          messageId: `<${email.idempotencyKey}@${domain}>`,
        });
        return { providerMessageId: info.messageId.slice(0, 300) };
      } catch (error) {
        throw classifySmtpError(error);
      } finally {
        if (once) transporter.close();
      }
    },
    close() {
      shared?.close();
      return Promise.resolve();
    },
  };
}
