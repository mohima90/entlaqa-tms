import 'server-only';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, type Socket, connect as netConnect, isIP } from 'node:net';
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
 * Ports a relay configured in the product may use (WP-ADM-01, security review): the SMTP submission ports
 * only (no 25: that is server-to-server relaying). An organization's relay always; the platform sender's
 * too, unless the operator allows internal relays (EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE=true, self-hosted). The
 * installation's relay (environment) may use any port.
 */
export const SUBMISSION_SMTP_PORTS: ReadonlySet<number> = new Set([465, 587, 2525]);

/** One send's hard limit: a server answering slowly (a tarpit) cannot hold the worker longer. */
export const SMTP_SEND_DEADLINE_MS = 60_000;
/** Opening the TCP connection (as nodemailer's connectionTimeout). */
const CONNECT_TIMEOUT_MS = 10_000;

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
  // IPv4-compatible (deprecated) addresses: ::a.b.c.d would reach an IPv4 address.
  ['::', 96],
  // NAT64 (well-known and local-use prefixes) and 6to4: they embed an IPv4 address.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2002::', 16],
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

function nodemailerTransport(
  settings: SmtpSettings,
  connectTo: string,
  caPem: string | undefined,
  sockets: Set<Socket>,
) {
  return nodemailer.createTransport({
    // We open the TCP connection ourselves and hand it to nodemailer (its `connection` option), keeping a
    // handle: on the send's deadline it is destroyed — closing a non-pooled transporter does not end a
    // connection in progress. nodemailer then upgrades it to TLS as usual (implicit TLS or STARTTLS), checking
    // the certificate against the configured host name.
    getSocket: (_options, callback) => {
      let settled = false;
      const finish = (error: Error | null, socket?: Socket) => {
        if (settled) return;
        settled = true;
        callback(error, socket ? { connection: socket } : false);
      };
      const socket = netConnect({ host: connectTo, port: settings.port });
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once('connect', () => {
        socket.setTimeout(0);
        finish(null, socket);
      });
      socket.once('timeout', () => {
        socket.destroy();
        finish(Object.assign(new Error('SMTP connection timed out'), { code: 'ETIMEDOUT' }));
      });
      socket.once('error', (cause) => {
        finish(
          Object.assign(new Error('SMTP connection failed', { cause }), { code: 'ECONNECTION' }),
        );
      });
    },
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
 * Every send has a hard deadline (`deadlineMs`, 60 seconds): past it the connection is destroyed and the
 * send fails with TIMEOUT (temporary) — a server that answers slowly forever cannot hold the worker.
 *
 * `publicOnly` (a relay configured in the product, WP-ADM-01): the host name is resolved before every send
 * and the worker connects to that address only when every address of the name is on the public internet and
 * the port is a submission port — an admin cannot point the worker at its own network (SSRF); the refusal is
 * SMTP_HOST_NOT_ALLOWED.
 */
export function createSmtpTransport(
  settings: SmtpSettings,
  caPem?: string,
  options: {
    readonly publicOnly?: boolean;
    readonly lookup?: HostLookup;
    readonly deadlineMs?: number;
  } = {},
): EmailTransport {
  const lookup = options.lookup ?? systemLookup;
  const deadlineMs = options.deadlineMs ?? SMTP_SEND_DEADLINE_MS;
  const connectTo = async (): Promise<string> => {
    if (!options.publicOnly) return settings.host;
    if (!SUBMISSION_SMTP_PORTS.has(settings.port)) {
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
    return first.address;
  };
  return {
    provider: 'smtp',
    async send(email) {
      // The deadline covers the host lookup too (review: the resolver has no timeout of its own).
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new EmailSendError('TIMEOUT', false));
        }, deadlineMs);
      });
      deadline.catch(() => undefined);
      let address: string;
      try {
        address = await Promise.race([connectTo(), deadline]);
      } catch (error) {
        clearTimeout(timer);
        throw error;
      }
      // One transporter per send (nodemailer opens one connection per message without a pool anyway).
      const sockets = new Set<Socket>();
      const transporter = nodemailerTransport(settings, address, caPem, sockets);
      const domain = email.from.address.slice(email.from.address.lastIndexOf('@') + 1);
      const sending = transporter.sendMail({
        from: formatFrom(email.from),
        to: email.to,
        ...(email.replyTo ? { replyTo: email.replyTo } : {}),
        subject: email.subject,
        html: email.html,
        text: email.text,
        messageId: `<${email.idempotencyKey}@${domain}>`,
      });
      // After the deadline the abandoned send still settles (with the destroyed socket's error): ignored.
      sending.catch(() => undefined);
      try {
        const info = await Promise.race([sending, deadline]);
        return { providerMessageId: info.messageId.slice(0, 300) };
      } catch (error) {
        throw error instanceof EmailSendError ? error : classifySmtpError(error);
      } finally {
        clearTimeout(timer);
        for (const socket of sockets) socket.destroy();
        transporter.close();
      }
    },
    close() {
      return Promise.resolve();
    },
  };
}
