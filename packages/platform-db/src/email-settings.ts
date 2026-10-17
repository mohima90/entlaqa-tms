import 'server-only';
import { sql } from 'drizzle-orm';
import type { ClaimsTx } from './claims-tx';
import { DomainError } from './domain-error';
import { pgError } from './pg-error';

/**
 * E-mail sending set up in the product — the web app's side (WP-ADM-01, migration 20261022100100;
 * FR-NTF-11, FR-ADM-17). Every helper runs inside the signed-in user's withUserTx and calls one reviewed
 * SECURITY DEFINER function, which checks the login role (app_server), the session and the caller's right
 * itself: the platform sender for Super Admins only, an organization's provider for its Organization Admins
 * (platform.tenant.manage; members with platform.tenant.read see it). Provider secrets arrive here already
 * sealed for the worker (platform-notifications sealCredentials) and are never read back: no helper returns
 * them. Before the migration exists (the app deploys first) the reads say "not set up".
 */

export type EmailSettingsErrorCode =
  /** Not allowed (not a Super Admin / no tenant.manage): the pages answer 404 / 403. */
  | 'EMAIL_SETTINGS_FORBIDDEN'
  /** Input refused by the database (`field`). */
  | 'EMAIL_SETTINGS_INVALID'
  /** The settings changed since the page was loaded. */
  | 'EMAIL_SETTINGS_CONFLICT'
  /** The secrets were sealed with another key than the worker's current one, or none is published. */
  | 'EMAIL_SETTINGS_KEY_CHANGED'
  /** Enabling an organization's provider before its test e-mail went out. */
  | 'EMAIL_SETTINGS_NOT_VERIFIED'
  /** No organization provider to test or switch. */
  | 'EMAIL_SETTINGS_NOT_CONFIGURED'
  /** A test e-mail too soon after the last one (one a minute; an organization: 20 a day). */
  | 'EMAIL_SETTINGS_TOO_SOON';

export type EmailSettingsField =
  | 'provider'
  | 'options'
  | 'credentials'
  | 'from_name'
  | 'from_address'
  | 'reply_to'
  | 'test_to'
  | 'enabled';

const FIELDS: readonly EmailSettingsField[] = [
  'provider',
  'options',
  'credentials',
  'from_name',
  'from_address',
  'reply_to',
  'test_to',
  'enabled',
];

export class EmailSettingsError extends DomainError<EmailSettingsErrorCode> {
  readonly field: EmailSettingsField | null;
  constructor(
    code: EmailSettingsErrorCode,
    options: { readonly cause?: unknown; readonly field?: EmailSettingsField | null } = {},
  ) {
    super(code, { cause: options.cause });
    this.field = options.field ?? null;
  }
}

/** The database's refusals as EmailSettingsErrors; anything else is returned as is. */
export function emailSettingsErrorOf(error: unknown): unknown {
  const pg = pgError(error);
  switch (pg?.code) {
    case '42501':
      return new EmailSettingsError('EMAIL_SETTINGS_FORBIDDEN', { cause: error });
    case 'JE001':
      return new EmailSettingsError('EMAIL_SETTINGS_INVALID', {
        cause: error,
        field: FIELDS.find((f) => f === pg.message) ?? null,
      });
    case 'JE002':
      return new EmailSettingsError('EMAIL_SETTINGS_CONFLICT', { cause: error });
    case 'JE003':
      return new EmailSettingsError('EMAIL_SETTINGS_KEY_CHANGED', { cause: error });
    case 'JE004':
      return new EmailSettingsError('EMAIL_SETTINGS_NOT_VERIFIED', { cause: error });
    case 'JE005':
      return new EmailSettingsError('EMAIL_SETTINGS_NOT_CONFIGURED', { cause: error });
    case 'JE006':
      return new EmailSettingsError('EMAIL_SETTINGS_TOO_SOON', { cause: error });
    default:
      return error;
  }
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw emailSettingsErrorOf(error);
  }
}

/** SQLSTATE undefined_function: the database is not migrated yet (the app deployed first). */
const UNDEFINED_FUNCTION = '42883';

/** A read that answers null before the migration (in a savepoint: the caller's transaction stays usable). */
async function readOrNull<T>(tx: ClaimsTx, fn: (tx: ClaimsTx) => Promise<T>): Promise<T | null> {
  try {
    return await tx.transaction((savepoint) => fn(savepoint));
  } catch (error) {
    if (pgError(error)?.code === UNDEFINED_FUNCTION) return null;
    throw emailSettingsErrorOf(error);
  }
}

const toDate = (value: Date | string | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value);

/** The worker's public key (null: e-mail sending is not set up — no worker has published one yet). */
export async function getEmailCredentialsPublicKey(
  tx: ClaimsTx,
): Promise<{ readonly keyId: string; readonly publicKey: string } | null> {
  const rows = await readOrNull(tx, (t) =>
    t.execute<{ key_id: string; public_key: string }>(
      sql`select key_id, public_key from private.email_credentials_public_key()`,
    ),
  );
  const row = rows?.[0];
  return row ? { keyId: row.key_id, publicKey: row.public_key } : null;
}

/** The latest test e-mail of a sender (masked recipient, our error code). */
export interface EmailTestState {
  readonly status: 'queued' | 'sending' | 'sent' | 'failed';
  readonly recipientMasked: string | null;
  readonly errorCode: string | null;
  readonly requestedAt: Date | null;
  readonly finishedAt: Date | null;
}

/** What a settings page shows of a sender — never its secrets. */
export interface EmailSenderSettings {
  readonly provider: string;
  readonly options: Record<string, unknown>;
  /** The secrets were sealed with the worker's current key (else they must be entered again). */
  readonly credentialsCurrent: boolean;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly status: 'unverified' | 'verified';
  readonly verifiedAt: Date | null;
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly test: EmailTestState | null;
}

interface SenderRow extends Record<string, unknown> {
  configured: boolean;
  provider: string | null;
  options: Record<string, unknown> | null;
  credentials_key_id: string | null;
  current_key_id: string | null;
  from_name: string | null;
  from_address: string | null;
  status: string;
  verified_at: Date | string | null;
  version: number | null;
  updated_at: Date | string | null;
  test_status: string | null;
  test_recipient_masked: string | null;
  test_error_code: string | null;
  test_requested_at: Date | string | null;
  test_finished_at: Date | string | null;
}

const TEST_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const;

function sender(r: SenderRow): EmailSenderSettings | null {
  if (!r.configured || !r.provider || !r.from_name || !r.from_address) return null;
  const testStatus = TEST_STATUSES.find((s) => s === r.test_status);
  return {
    provider: r.provider,
    options: r.options ?? {},
    credentialsCurrent: r.credentials_key_id !== null && r.credentials_key_id === r.current_key_id,
    fromName: r.from_name,
    fromAddress: r.from_address,
    status: r.status === 'verified' ? 'verified' : 'unverified',
    verifiedAt: toDate(r.verified_at),
    version: r.version ?? 1,
    updatedAt: toDate(r.updated_at),
    test: testStatus
      ? {
          status: testStatus,
          recipientMasked: r.test_recipient_masked,
          errorCode: r.test_error_code,
          requestedAt: toDate(r.test_requested_at),
          finishedAt: toDate(r.test_finished_at),
        }
      : null,
  };
}

/** The Super Admin's page: the platform sender and the messages waiting for a sender (warning). */
export interface PlatformEmailView {
  /** False before the migration: the page says e-mail sending is not set up. */
  readonly available: boolean;
  /** The worker published its key: secrets can be saved. */
  readonly keyReady: boolean;
  readonly sender: EmailSenderSettings | null;
  readonly waitingCount: number;
  readonly oldestWaitingAt: Date | null;
  /** Deliveries sent with the platform sender that failed in the last 24 hours (all organizations). */
  readonly platformFailed24h: number;
}

/** Throws EMAIL_SETTINGS_FORBIDDEN for anyone but a Super Admin. */
export async function getPlatformEmailSettings(tx: ClaimsTx): Promise<PlatformEmailView> {
  const rows = await readOrNull(tx, (t) =>
    t.execute<
      SenderRow & {
        waiting_count: number | string;
        oldest_waiting_at: Date | string | null;
        platform_failed_24h?: number | string | null;
      }
    >(sql`select * from private.platform_email_settings_view()`),
  );
  const row = rows?.[0];
  if (!row)
    return {
      available: false,
      keyReady: false,
      sender: null,
      waitingCount: 0,
      oldestWaitingAt: null,
      platformFailed24h: 0,
    };
  return {
    available: true,
    keyReady: row.current_key_id !== null,
    sender: sender(row),
    waitingCount: Number(row.waiting_count),
    oldestWaitingAt: toDate(row.oldest_waiting_at),
    platformFailed24h: Number(row.platform_failed_24h ?? 0),
  };
}

export interface SaveSenderInput {
  readonly provider: string;
  readonly options: Record<string, unknown>;
  /** Sealed for the worker; null keeps the saved secrets (same provider only). */
  readonly credentialsSealed: string | null;
  readonly fromName: string;
  readonly fromAddress: string;
  /** The version the page showed (null when nothing was saved yet). */
  readonly version: number | null;
}

/** Saves the platform sender and queues its test e-mail; returns the new version. */
export async function savePlatformEmailSettings(
  tx: ClaimsTx,
  input: SaveSenderInput & { readonly testTo: string },
): Promise<number> {
  const rows = await run(() =>
    tx.execute<{ version: number }>(sql`
      select private.platform_save_email_settings(
        ${input.provider}, ${JSON.stringify(input.options)}::jsonb, ${input.credentialsSealed},
        ${input.fromName}, ${input.fromAddress}, ${input.testTo}, ${input.version}::integer) as version`),
  );
  const version = rows[0]?.version;
  if (typeof version !== 'number')
    throw new Error('savePlatformEmailSettings: no version returned');
  return version;
}

/** The Email integration page: the organization's provider (if any) and its waiting messages. */
export interface TenantEmailView {
  readonly available: boolean;
  readonly keyReady: boolean;
  readonly sender:
    (EmailSenderSettings & { readonly replyTo: string | null; readonly enabled: boolean }) | null;
  readonly platformSenderVerified: boolean;
  readonly waitingCount: number;
}

/** Throws EMAIL_SETTINGS_FORBIDDEN for members without platform.tenant.read / .manage. */
export async function getTenantEmailSettings(tx: ClaimsTx): Promise<TenantEmailView> {
  const rows = await readOrNull(tx, (t) =>
    t.execute<
      SenderRow & {
        reply_to: string | null;
        enabled: boolean;
        platform_sender_verified: boolean;
        waiting_count: number | string;
      }
    >(sql`select * from private.tenant_email_settings_view()`),
  );
  const row = rows?.[0];
  if (!row) {
    return {
      available: false,
      keyReady: false,
      sender: null,
      platformSenderVerified: false,
      waitingCount: 0,
    };
  }
  const base = sender(row);
  return {
    available: true,
    keyReady: row.current_key_id !== null,
    sender: base ? { ...base, replyTo: row.reply_to, enabled: row.enabled } : null,
    platformSenderVerified: row.platform_sender_verified,
    waitingCount: Number(row.waiting_count),
  };
}

/** One recent delivery error of the organization (no address beyond the recipient's domain). */
export interface TenantEmailFailure {
  readonly template: string;
  readonly errorCode: string | null;
  readonly sender: 'organization' | 'platform' | 'installation' | null;
  readonly recipientDomain: string | null;
  readonly failedAt: Date;
}

const SENDERS = ['organization', 'platform', 'installation'] as const;

export async function listTenantEmailFailures(
  tx: ClaimsTx,
  limit = 20,
): Promise<TenantEmailFailure[]> {
  const rows = await readOrNull(tx, (t) =>
    t.execute<{
      template: string;
      error_code: string | null;
      sender: string | null;
      recipient_domain: string | null;
      failed_at: Date | string;
    }>(sql`select * from private.tenant_email_failures(${limit})`),
  );
  return (rows ?? []).map((r) => ({
    template: r.template,
    errorCode: r.error_code,
    sender: SENDERS.find((s) => s === r.sender) ?? null,
    recipientDomain: r.recipient_domain,
    failedAt: toDate(r.failed_at) ?? new Date(0),
  }));
}

/** Saves the organization's provider; the changed fields are for the audit record. */
export async function saveTenantEmailSettings(
  tx: ClaimsTx,
  input: SaveSenderInput & { readonly replyTo: string | null },
): Promise<{
  readonly version: number;
  readonly changed: readonly string[];
  readonly reverify: boolean;
}> {
  const rows = await run(() =>
    tx.execute<{ version: number; changed: string[]; reverify: boolean }>(sql`
      select version, changed, reverify from private.save_tenant_email_settings(
        ${input.provider}, ${JSON.stringify(input.options)}::jsonb, ${input.credentialsSealed},
        ${input.fromName}, ${input.fromAddress}, ${input.replyTo}, ${input.version}::integer)`),
  );
  const row = rows[0];
  if (!row) throw new Error('saveTenantEmailSettings: no row returned');
  return { version: row.version, changed: row.changed, reverify: row.reverify };
}

/** Queues a test e-mail through the organization's provider; returns the provider. */
export async function requestTenantEmailTest(tx: ClaimsTx, recipient: string): Promise<string> {
  const rows = await run(() =>
    tx.execute<{ provider: string }>(
      sql`select private.request_tenant_email_test(${recipient}) as provider`,
    ),
  );
  const provider = rows[0]?.provider;
  if (!provider) throw new Error('requestTenantEmailTest: no provider returned');
  return provider;
}

/** Switches the organization's provider on (verified only) or off; returns the version. */
export async function setTenantEmailEnabled(
  tx: ClaimsTx,
  enabled: boolean,
  version: number,
): Promise<number> {
  const rows = await run(() =>
    tx.execute<{ version: number }>(
      sql`select private.set_tenant_email_enabled(${enabled}, ${version}::integer) as version`,
    ),
  );
  const result = rows[0]?.version;
  if (typeof result !== 'number') throw new Error('setTenantEmailEnabled: no version returned');
  return result;
}
