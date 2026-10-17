import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';
import { pgError } from '../pg-error';

/**
 * E-mail sending set up in the product — the worker's side (WP-ADM-01, migration 20261022100100). Every
 * function calls one reviewed SECURITY DEFINER function, which checks the login role (app_worker) and the
 * system claims itself: a platform task (withPlatformTx) for the work across organizations, the job's own
 * organization (withSystemTx) for its route. Sealed provider secrets leave the database here only — they are
 * opened by the worker (platform-notifications jobs) and never logged.
 */

/** SQLSTATE undefined_function: the database is not migrated yet (the worker and the DB deploy in parallel). */
const UNDEFINED_FUNCTION = '42883';

/** True when `error` says the e-mail settings functions do not exist yet (expand-first deploy window). */
export function isEmailSettingsMissing(error: unknown): boolean {
  return pgError(error)?.code === UNDEFINED_FUNCTION;
}

/** Publishes the worker's public key; true when it changed. */
export async function publishEmailCredentialsKey(
  tx: ClaimsTx,
  key: { readonly keyId: string; readonly publicKey: string },
): Promise<boolean> {
  const [row] = await tx.execute<{ changed: boolean }>(sql`
    select private.publish_email_credentials_key(${key.keyId}, ${key.publicKey}) as changed`);
  return row?.changed === true;
}

/** The sender rule's inputs for the job's organization (private.email_route). */
export interface EmailRouteRow {
  readonly tenant: {
    readonly provider: string;
    readonly options: unknown;
    readonly credentialsSealed: string;
    readonly fromName: string;
    readonly fromAddress: string;
    readonly replyTo: string | null;
    /** Enabled AND verified. */
    readonly enabled: boolean;
    readonly version: number;
  } | null;
  readonly platform: {
    readonly provider: string;
    readonly options: unknown;
    readonly credentialsSealed: string;
    readonly fromAddress: string;
    readonly verified: boolean;
    readonly version: number;
  } | null;
  readonly brandNameAr: string;
  readonly brandNameEn: string | null;
  readonly defaultLocale: 'ar' | 'en';
}

export async function loadEmailRoute(tx: ClaimsTx): Promise<EmailRouteRow | null> {
  const [r] = await tx.execute<{
    tenant_provider: string | null;
    tenant_options: unknown;
    tenant_credentials_sealed: string | null;
    tenant_from_name: string | null;
    tenant_from_address: string | null;
    tenant_reply_to: string | null;
    tenant_enabled: boolean;
    tenant_version: number | null;
    platform_configured: boolean;
    platform_provider: string | null;
    platform_options: unknown;
    platform_credentials_sealed: string | null;
    platform_from_address: string | null;
    platform_verified: boolean;
    platform_version: number | null;
    brand_name_ar: string;
    brand_name_en: string | null;
    default_locale: string;
  }>(sql`select * from private.email_route()`);
  if (!r) return null;
  return {
    tenant:
      r.tenant_provider !== null &&
      r.tenant_credentials_sealed !== null &&
      r.tenant_from_name !== null &&
      r.tenant_from_address !== null
        ? {
            provider: r.tenant_provider,
            options: r.tenant_options,
            credentialsSealed: r.tenant_credentials_sealed,
            fromName: r.tenant_from_name,
            fromAddress: r.tenant_from_address,
            replyTo: r.tenant_reply_to,
            enabled: r.tenant_enabled,
            version: r.tenant_version ?? 0,
          }
        : null,
    platform:
      r.platform_configured &&
      r.platform_provider !== null &&
      r.platform_credentials_sealed !== null &&
      r.platform_from_address !== null
        ? {
            provider: r.platform_provider,
            options: r.platform_options,
            credentialsSealed: r.platform_credentials_sealed,
            fromAddress: r.platform_from_address,
            verified: r.platform_verified,
            version: r.platform_version ?? 0,
          }
        : null,
    brandNameAr: r.brand_name_ar,
    brandNameEn: r.brand_name_en,
    defaultLocale: r.default_locale === 'ar' ? 'ar' : 'en',
  };
}

/** A waiting test e-mail, claimed (tenantId null: the platform sender). The recipient is personal data. */
export interface EmailTestClaim {
  readonly tenantId: string | null;
  readonly recipient: string;
  readonly version: number;
  readonly provider: string;
  readonly options: unknown;
  readonly credentialsSealed: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
}

export async function claimEmailTests(tx: ClaimsTx, limit: number): Promise<EmailTestClaim[]> {
  const rows = await tx.execute<{
    tenant_id: string | null;
    recipient: string;
    version: number;
    provider: string;
    options: unknown;
    credentials_sealed: string;
    from_name: string;
    from_address: string;
    reply_to: string | null;
  }>(sql`select * from private.claim_email_tests(${limit})`);
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    recipient: r.recipient,
    version: r.version,
    provider: r.provider,
    options: r.options,
    credentialsSealed: r.credentials_sealed,
    fromName: r.from_name,
    fromAddress: r.from_address,
    replyTo: r.reply_to,
  }));
}

/** Records a test e-mail's outcome; true when the settings became verified. */
export async function finishEmailTest(
  tx: ClaimsTx,
  test: { readonly tenantId: string | null; readonly version: number },
  outcome: { readonly sent: true } | { readonly sent: false; readonly errorCode: string },
): Promise<boolean> {
  const [row] = await tx.execute<{ verified: boolean }>(sql`
    select private.finish_email_test(${test.tenantId}::uuid, ${test.version}, ${outcome.sent},
                                     ${outcome.sent ? null : outcome.errorCode}) as verified`);
  return row?.verified === true;
}

/** Served organizations with messages waiting for a sender, oldest first. */
export async function listTenantsWaitingForSender(
  tx: ClaimsTx,
): Promise<{ readonly tenantId: string; readonly waiting: number }[]> {
  const rows = await tx.execute<{ tenant_id: string; waiting: number | string }>(
    sql`select tenant_id, waiting from private.email_tenants_waiting()`,
  );
  return rows.map((r) => ({ tenantId: r.tenant_id, waiting: Number(r.waiting) }));
}

/** Reasons a delivery waits for a sender (as private.email_waiting_codes()). */
export const EMAIL_WAITING_CODES = ['NO_SENDER', 'CREDENTIALS_UNAVAILABLE'] as const;

/**
 * Takes up to `limit` of the job organization's messages waiting for a sender off the waiting list (their
 * reason is cleared; they stay queued with their content) and returns their ids, to be queued again.
 */
export async function takeWaitingDeliveries(tx: ClaimsTx, limit: number): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    update platform.message_deliveries d set error_code = null
    where d.id in (
      select x.id from platform.message_deliveries x
      where x.status = 'queued' and x.error_code in ('NO_SENDER', 'CREDENTIALS_UNAVAILABLE')
      order by x.created_at, x.id
      limit ${limit}
      for update skip locked)
    returning d.id`);
  return rows.map((r) => r.id);
}

/**
 * The delivery log's housekeeping (T-M2-48): stale, long-waiting and expired rows; test e-mails left unsent
 * for 7 days (`testsExpired`).
 */
export async function sweepEmailDeliveries(
  tx: ClaimsTx,
  batch: number,
): Promise<{
  readonly stale: number;
  readonly expired: number;
  readonly purged: number;
  readonly testsExpired: number;
}> {
  const [row] = await tx.execute<{
    stale: number | string;
    expired: number | string;
    purged: number | string;
    tests_expired: number | string;
  }>(
    sql`select stale, expired, purged, tests_expired from private.sweep_email_deliveries(${batch})`,
  );
  return {
    stale: Number(row?.stale ?? 0),
    expired: Number(row?.expired ?? 0),
    purged: Number(row?.purged ?? 0),
    testsExpired: Number(row?.tests_expired ?? 0),
  };
}

/**
 * The invitation mailer did not queue an invitation's e-mail (T-M2-20): remembered for its current code, so
 * the users list says it was not sent. False when there is nothing to remember (or before the migration —
 * in a savepoint, so the mailer's transaction stays usable).
 */
export async function noteInvitationMailSkipped(
  tx: ClaimsTx,
  invitationId: string,
): Promise<boolean> {
  try {
    return await tx.transaction(async (savepoint) => {
      const [row] = await savepoint.execute<{ noted: boolean }>(
        sql`select private.note_invitation_mail_skipped(${invitationId}::uuid) as noted`,
      );
      return row?.noted === true;
    });
  } catch (error) {
    if (isEmailSettingsMissing(error)) return false;
    throw error;
  }
}
