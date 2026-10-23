import 'server-only';
import { createHash } from 'node:crypto';
import type { EmailRouteRow } from '@jadarat/platform-db';
import { type CredentialsScope, credentialsContext } from '../credentials-seal';
import { isEmailProvider } from '../providers';
import { CredentialsError, type CredentialsKeyPair } from './credentials';
import { createProviderTransport } from './factory';
import type { HostLookup } from './smtp';
import { EmailSendError, type EmailRoute, type EmailTransport } from './transport';

/** Where the sender rule reports an unusable setting (a code only; never an address or a secret). */
export type SendLog = (level: 'error' | 'warning' | 'info' | 'debug', message: string) => void;

/**
 * The installation's sender from the worker's environment (EMAIL_PROVIDER, SMTP_URL / RESEND_API_KEY,
 * EMAIL_FROM_ADDRESS): self-hosted installations whose operator runs the relay. Used only while the platform
 * sender has never been saved in the product — once the Super Admin saved one, the product's settings win.
 */
export interface InstallationSender {
  readonly transport: EmailTransport;
  readonly address: string;
  /** Display name when the organization's brand name is not known (the database not migrated yet). */
  readonly name: string;
}

/** The sender rule over sender settings already read (the worker adds `resolve`, jobs/router.ts). */
export interface InlineEmailRouter {
  /** The sender rule over `row`. */
  fromRow(
    row: EmailRouteRow | null,
    tenantId: string,
    options?: { readonly platformOnly?: boolean },
  ): EmailRoute;
  /** Closes the cached transports. */
  close(): Promise<void>;
}

/** Transports are reused for a minute: a changed setting takes effect within that time. */
const TRANSPORT_TTL_MS = 60_000;

export function brandName(
  row: Pick<EmailRouteRow, 'brandNameAr' | 'brandNameEn' | 'defaultLocale'>,
): string {
  const name = row.defaultLocale === 'ar' ? row.brandNameAr : (row.brandNameEn ?? row.brandNameAr);
  // The database checks names; a display name stays one line of at most 100 characters.
  return name
    .replace(/[\p{Cc}]/gu, ' ')
    .trim()
    .slice(0, 100);
}

/**
 * The sender rule (WP-ADM-01, FR-NTF-11; Kawadir sender-rule.ts) over the settings in the database:
 *   1. the organization's own provider, when configured AND enabled (enabled implies verified) - not for the
 *      messages that ask for the platform sender only (`platformOnly`);
 *   2. else the platform sender, once verified by its test e-mail — sent with the ORGANIZATION's brand name
 *      as display name and the platform's address;
 *   3. else, while the platform sender was never saved in the product, the installation's sender
 *      (self-hosted, environment);
 *   4. else the message waits (NO_SENDER) — nothing is lost; the Super Admin sees a warning.
 * No automatic fallback: an enabled organization provider whose secrets cannot be used (a new worker key)
 * makes the message wait for that organization; its delivery failures are recorded as the organization's.
 */
export function createSenderRule(options: {
  readonly keys: CredentialsKeyPair | null;
  readonly installation: InstallationSender | null;
  readonly log: SendLog;
  readonly smtpCaPem?: string | undefined;
  /** EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE=true: the platform sender's SMTP relay may be internal. */
  readonly allowPrivatePlatformSmtp?: boolean;
  readonly lookup?: HostLookup;
  readonly transportFor?: typeof createProviderTransport;
  readonly now?: () => number;
}): InlineEmailRouter {
  const { keys, installation, log } = options;
  const transportFor = options.transportFor ?? createProviderTransport;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { readonly transport: EmailTransport; readonly at: number }>();

  /** Expired entries go (closed): settings changed or organizations no longer sending leave nothing behind. */
  function evictExpired(): void {
    const t = now();
    for (const [key, entry] of cache) {
      if (t - entry.at >= TRANSPORT_TTL_MS) {
        cache.delete(key);
        void entry.transport.close?.().catch(() => undefined);
      }
    }
  }

  function transport(
    scope: CredentialsScope,
    settings: {
      readonly provider: string;
      readonly options: unknown;
      readonly credentialsSealed: string;
      readonly version: number;
    },
  ): EmailTransport {
    const owner = scope.kind === 'platform' ? 'platform' : scope.tenantId;
    const fingerprint = createHash('sha256').update(settings.credentialsSealed).digest('base64url');
    const key = `${owner}|${settings.provider}|${String(settings.version)}|${fingerprint}`;
    evictExpired();
    const hit = cache.get(key);
    if (hit) return hit.transport;
    if (!keys) throw new CredentialsError('CREDENTIALS_KEY_MISSING');
    if (!isEmailProvider(settings.provider))
      throw new EmailSendError('PROVIDER_SETTINGS_INVALID', false);
    const secrets = keys.open(
      settings.credentialsSealed,
      credentialsContext(scope, settings.provider, settings.options),
    );
    const created = transportFor(settings.provider, settings.options, secrets, {
      organization: scope.kind === 'tenant',
      allowPrivatePlatformSmtp: options.allowPrivatePlatformSmtp === true,
      smtpCaPem: options.smtpCaPem,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    });
    cache.set(key, { transport: created, at: now() });
    return created;
  }

  function unusable(error: unknown, whose: string): EmailRoute {
    const code =
      error instanceof CredentialsError || error instanceof EmailSendError ? error.code : 'UNKNOWN';
    log('error', `${whose} e-mail settings cannot be used (${code}); messages wait`);
    return { kind: 'wait', code: 'CREDENTIALS_UNAVAILABLE' };
  }

  /** The sender rule over settings already read. */
  function fromRow(
    row: EmailRouteRow | null,
    tenantId: string,
    resolveOptions?: { readonly platformOnly?: boolean },
  ): EmailRoute {
    if (!row) return { kind: 'wait', code: 'NO_SENDER' };
    if (row.tenant?.enabled && resolveOptions?.platformOnly !== true) {
      try {
        return {
          kind: 'send',
          transport: transport({ kind: 'tenant', tenantId }, row.tenant),
          from: { name: row.tenant.fromName, address: row.tenant.fromAddress },
          replyTo: row.tenant.replyTo ?? undefined,
          sender: 'organization',
        };
      } catch (error) {
        return unusable(error, "the organization's");
      }
    }
    const name = brandName(row);
    if (row.platform) {
      if (!row.platform.verified) return { kind: 'wait', code: 'NO_SENDER' };
      try {
        return {
          kind: 'send',
          transport: transport({ kind: 'platform' }, row.platform),
          from: { name, address: row.platform.fromAddress },
          sender: 'platform',
        };
      } catch (error) {
        return unusable(error, "the platform sender's");
      }
    }
    if (installation) {
      return {
        kind: 'send',
        transport: installation.transport,
        from: { name, address: installation.address },
        sender: 'installation',
      };
    }
    return { kind: 'wait', code: 'NO_SENDER' };
  }

  return {
    fromRow,
    async close() {
      const open = [...cache.values()];
      cache.clear();
      await Promise.all(
        open.map(async (entry) => {
          await entry.transport.close?.().catch(() => undefined);
        }),
      );
    },
  };
}
