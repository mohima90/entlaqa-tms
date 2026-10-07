import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';

/**
 * Account e-mails, worker side (T-M2-17; migration 20261010120000). The account-mail job leases a
 * request in a platform transaction (system claims without a tenant), learns whom to write in which
 * organization and language — or why nothing is sent — and finishes the request in the organization's
 * transaction that queues the e-mail. Only the definer functions reach the queue.
 */
export type AccountMailKind = 'password_reset' | 'password_changed';

/** Why no e-mail is sent for a request (decided by the database, never by the web app). */
export type AccountMailSkip = 'unknown_account' | 'banned' | 'too_soon' | 'no_membership';

interface RequestBase {
  readonly id: string;
  readonly kind: AccountMailKind;
  /** This attempt's number (1-based); the database removes a request after its 5th. */
  readonly attempt: number;
}

export type AccountMailRequest =
  | (RequestBase & {
      readonly outcome: 'send';
      /** The account's address as Auth stores it. */
      readonly email: string;
      readonly userId: string;
      readonly tenantId: string;
      readonly personId: string;
      readonly locale: 'ar' | 'en';
    })
  | (RequestBase & { readonly outcome: AccountMailSkip });

/** The last attempt the database allows (private.retry_account_mail_request). */
export const ACCOUNT_MAIL_MAX_ATTEMPTS = 5;

const SKIPS: ReadonlySet<string> = new Set<AccountMailSkip>([
  'unknown_account',
  'banned',
  'too_soon',
  'no_membership',
]);

/** Leases the oldest waiting request (5 minutes), or null when none waits. */
export async function claimAccountMailRequest(tx: ClaimsTx): Promise<AccountMailRequest | null> {
  const [row] = await tx.execute<{
    id: string;
    kind: string;
    outcome: string;
    email: string | null;
    user_id: string | null;
    tenant_id: string | null;
    person_id: string | null;
    locale: string | null;
    attempts: number;
  }>(sql`select * from private.claim_account_mail_request()`);
  if (!row) return null;
  if (row.kind !== 'password_reset' && row.kind !== 'password_changed') {
    throw new Error('claimAccountMailRequest: unknown request kind');
  }
  const base = { id: row.id, kind: row.kind, attempt: row.attempts } as const;
  if (row.outcome === 'send') {
    if (!row.email || !row.user_id || !row.tenant_id || !row.person_id) {
      throw new Error('claimAccountMailRequest: incomplete recipient');
    }
    return {
      ...base,
      outcome: 'send',
      email: row.email,
      userId: row.user_id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      locale: row.locale === 'en' ? 'en' : 'ar',
    };
  }
  if (!SKIPS.has(row.outcome)) throw new Error('claimAccountMailRequest: unknown outcome');
  return { ...base, outcome: row.outcome as AccountMailSkip };
}

/** Removes an answered request; false when it was already gone. */
export async function finishAccountMailRequest(tx: ClaimsTx, id: string): Promise<boolean> {
  const [row] = await tx.execute<{ done: boolean }>(
    sql`select private.finish_account_mail_request(${id}::uuid) as done`,
  );
  return row?.done === true;
}

/** Puts a request back after a temporary failure; false when it was removed (attempts used up). */
export async function retryAccountMailRequest(tx: ClaimsTx, id: string): Promise<boolean> {
  const [row] = await tx.execute<{ again: boolean }>(
    sql`select private.retry_account_mail_request(${id}::uuid) as again`,
  );
  return row?.again === true;
}

/** What an account e-mail shows of the organization and the person (tenant transaction, RLS). */
export interface AccountMailContext {
  readonly organizationName: { readonly ar: string; readonly en: string | null };
  readonly recipientName: { readonly ar: string; readonly en: string | null };
  /** Account e-mails of this template queued for the person in the last hour (a per-person cap). */
  readonly recentCount: number;
}

/**
 * The organization's and the person's names for an account e-mail, in the job's tenant transaction, and
 * how many e-mails of `template` the person was sent in the last hour. Null when the person is not
 * visible in this tenant.
 */
export async function loadAccountMailContext(
  tx: ClaimsTx,
  personId: string,
  template: string,
): Promise<AccountMailContext | null> {
  const [row] = await tx.execute<{
    organization_ar: string;
    organization_en: string | null;
    recipient_ar: string;
    recipient_en: string | null;
    recent: number | string;
  }>(sql`
    select t.name_ar as organization_ar, t.name_en as organization_en,
           p.display_name_ar as recipient_ar, p.display_name_en as recipient_en,
           (select count(*) from platform.message_deliveries d
            where d.tenant_id = p.tenant_id and d.recipient_person_id = p.id and d.template = ${template}
              and d.created_at > now() - interval '1 hour') as recent
    from platform.persons p
    join platform.tenants t on t.id = p.tenant_id
    where p.id = ${personId}::uuid`);
  if (!row) return null;
  return {
    organizationName: { ar: row.organization_ar, en: row.organization_en },
    recipientName: { ar: row.recipient_ar, en: row.recipient_en },
    recentCount: Number(row.recent),
  };
}
