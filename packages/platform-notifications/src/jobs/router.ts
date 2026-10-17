import { createHash } from 'node:crypto';
import { type EmailRouteRow, type SystemTx, loadEmailRoute } from '@jadarat/platform-db/jobs';
import type { WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { type CredentialsScope, credentialsContext } from '../credentials-seal';
import { isEmailProvider } from '../providers';
import { CredentialsError, type CredentialsKeyPair } from './credentials';
import { createProviderTransport } from './factory';
import type { HostLookup } from './smtp';
import { EmailSendError, type EmailRoute, type EmailTransport } from './transport';

type Log = (level: WorkerLogLevel, message: string) => void;

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

export interface EmailRouter {
  /**
   * The sender rule for the job's organization, in its transaction (`tenantId`: the job's organization — the
   * organization's sealed secrets are bound to it). Settings that cannot be used make the message WAIT
   * (CREDENTIALS_UNAVAILABLE, logged with its code) — never another sender.
   */
  resolve(tx: SystemTx, tenantId: string): Promise<EmailRoute>;
  /** Closes the cached transports (worker stop). */
  close(): Promise<void>;
}

/** Transports are reused for a minute: a changed setting takes effect within that time. */
const TRANSPORT_TTL_MS = 60_000;

/** SQLSTATE undefined_function: the database is not migrated yet. */
const UNDEFINED_FUNCTION = '42883';

function isMissingFunction(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === UNDEFINED_FUNCTION) return true;
  }
  return false;
}

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
 *   1. the organization's own provider, when configured AND enabled (enabled implies verified);
 *   2. else the platform sender, once verified by its test e-mail — sent with the ORGANIZATION's brand name
 *      as display name and the platform's address;
 *   3. else, while the platform sender was never saved in the product, the installation's sender
 *      (self-hosted, environment);
 *   4. else the message waits (NO_SENDER) — nothing is lost; the Super Admin sees a warning.
 * No automatic fallback: an enabled organization provider whose secrets cannot be used (a new worker key)
 * makes the message wait for that organization; its delivery failures are recorded as the organization's.
 */
export function createEmailRouter(options: {
  readonly keys: CredentialsKeyPair | null;
  readonly installation: InstallationSender | null;
  readonly log: Log;
  readonly smtpCaPem?: string | undefined;
  readonly lookup?: HostLookup;
  readonly transportFor?: typeof createProviderTransport;
  readonly now?: () => number;
}): EmailRouter {
  const { keys, installation, log } = options;
  const transportFor = options.transportFor ?? createProviderTransport;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { readonly transport: EmailTransport; readonly at: number }>();

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
    const hit = cache.get(key);
    if (hit && now() - hit.at < TRANSPORT_TTL_MS) return hit.transport;
    if (hit) {
      cache.delete(key);
      void hit.transport.close?.().catch(() => undefined);
    }
    if (!keys) throw new CredentialsError('CREDENTIALS_KEY_MISSING');
    if (!isEmailProvider(settings.provider))
      throw new EmailSendError('PROVIDER_SETTINGS_INVALID', false);
    const secrets = keys.open(
      settings.credentialsSealed,
      credentialsContext(scope, settings.provider),
    );
    const created = transportFor(settings.provider, settings.options, secrets, {
      organization: scope.kind === 'tenant',
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

  return {
    async resolve(tx, tenantId) {
      let row: EmailRouteRow | null;
      try {
        row = await tx.transaction((savepoint) => loadEmailRoute(savepoint));
      } catch (error) {
        if (!isMissingFunction(error)) throw error;
        // The database is not migrated yet: the installation's sender (if any), as before.
        return installation
          ? {
              kind: 'send',
              transport: installation.transport,
              from: { name: installation.name, address: installation.address },
              sender: 'installation',
            }
          : { kind: 'wait', code: 'NO_SENDER' };
      }
      if (!row) return { kind: 'wait', code: 'NO_SENDER' };
      if (row.tenant?.enabled) {
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
    },
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
