import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';

/**
 * Account e-mails, worker side (T-M2-17; migrations 20261010120000, 20261012110000). The account-mail job
 * leases a request in a platform transaction (system claims without a tenant), learns whom to write in
 * which organization and language — or why nothing is sent — and finishes the request in the
 * organization's transaction that queues the e-mail. Only the definer functions reach the queue. T-M2-10
 * adds the authenticator notices: the set-up e-mail (with its confirmation and "not you" links, review H1)
 * and the removal notice.
 */
export const ACCOUNT_MAIL_KINDS = [
  'password_reset',
  'password_changed',
  'mfa_factor_added',
  'mfa_factor_removed',
  'security_policy_changed',
] as const;
export type AccountMailKind = (typeof ACCOUNT_MAIL_KINDS)[number];

/** Why an authenticator app was removed (the removal notice says so). */
export const MFA_REMOVAL_REASONS = ['removed', 'not_me', 'admin_reset', 'support_reset'] as const;
export type MfaRemovalReason = (typeof MFA_REMOVAL_REASONS)[number];

/** Why no e-mail is sent for a request (decided by the database, never by the web app). */
export type AccountMailSkip = 'unknown_account' | 'banned' | 'too_soon' | 'no_membership';

interface RequestBase {
  readonly id: string;
  readonly kind: AccountMailKind;
  /** This attempt's number (1-based); the database removes a request after its 5th. */
  readonly attempt: number;
  /** mfa_factor_added: the app to confirm; mfa_factor_removed: the app removed (null: all, a reset). */
  readonly factorId: string | null;
  /** mfa_factor_removed: why. */
  readonly mfaReason: MfaRemovalReason | null;
  /** security_policy_changed: the settings that changed (names only) and who changed them. */
  readonly policyChange: PolicyChange | null;
}

/** What a policy-change notice says (T-IAM-24): setting names, the editor's person, when. */
export interface PolicyChange {
  readonly changed: readonly string[];
  readonly changedByPersonId: string | null;
  readonly changedAt: Date;
}

const SETTING_NAME = /^[a-zA-Z]{2,40}$/;

function policyChangeOf(detail: unknown): PolicyChange | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const { changed, changed_by: by, changed_at: at } = detail as Record<string, unknown>;
  if (!Array.isArray(changed) || changed.length === 0) return null;
  const names = changed.filter((n): n is string => typeof n === 'string' && SETTING_NAME.test(n));
  if (names.length !== changed.length || typeof at !== 'string') return null;
  return {
    changed: names,
    changedByPersonId: typeof by === 'string' ? by : null,
    changedAt: new Date(at),
  };
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
    factor_id: string | null;
    mfa_reason: string | null;
    detail: unknown;
  }>(sql`select * from private.claim_account_mail_request()`);
  if (!row) return null;
  const kind = ACCOUNT_MAIL_KINDS.find((k) => k === row.kind);
  if (!kind) throw new Error('claimAccountMailRequest: unknown request kind');
  const reason = MFA_REMOVAL_REASONS.find((r) => r === row.mfa_reason) ?? null;
  if (kind === 'mfa_factor_removed' && !reason) {
    throw new Error('claimAccountMailRequest: removal without a reason');
  }
  const policyChange = kind === 'security_policy_changed' ? policyChangeOf(row.detail) : null;
  if (kind === 'security_policy_changed' && !policyChange) {
    throw new Error('claimAccountMailRequest: policy change without its detail');
  }
  const base = {
    id: row.id,
    kind,
    attempt: row.attempts,
    factorId: row.factor_id,
    mfaReason: reason,
    policyChange,
  } as const;
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

/**
 * The worker stores the SHA-256 of the set-up e-mail's confirmation and "not you" links right before
 * queueing it (each new e-mail replaces the previous links). Null when the app is gone or already confirmed:
 * nothing to send.
 */
export async function issueMfaFactorTokens(
  tx: ClaimsTx,
  factorId: string,
  userId: string,
  confirmHash: Buffer,
  removeHash: Buffer,
): Promise<{ readonly confirmExpiresAt: Date; readonly removeExpiresAt: Date } | null> {
  const [row] = await tx.execute<{
    confirm_expires_at: Date | string | null;
    remove_expires_at: Date | string | null;
  }>(sql`select confirm_expires_at, remove_expires_at
         from private.issue_mfa_factor_tokens(${factorId}::uuid, ${userId}::uuid, ${confirmHash}::bytea,
                                              ${removeHash}::bytea)`);
  if (!row?.confirm_expires_at || !row.remove_expires_at) return null;
  return {
    confirmExpiresAt: new Date(row.confirm_expires_at),
    removeExpiresAt: new Date(row.remove_expires_at),
  };
}

/** Does the account have a verified authenticator app? The reset e-mail then says a code will be asked. */
export async function accountHasApp(tx: ClaimsTx, userId: string): Promise<boolean> {
  const [row] = await tx.execute<{ has_app: boolean }>(
    sql`select private.account_has_app(${userId}::uuid) as has_app`,
  );
  return row?.has_app === true;
}

/**
 * Auth forgets sessions that ended (security review M1): with a revocation marker, older than the
 * platform's 24 hours, or ended by their organization's inactivity or maximum length. At most `limit`;
 * returns how many.
 */
export async function purgeEndedSessions(tx: ClaimsTx, limit: number): Promise<number> {
  const [row] = await tx.execute<{ purged: number | string }>(
    sql`select private.purge_ended_sessions(${limit}::integer) as purged`,
  );
  return Number(row?.purged ?? 0);
}

/** A person's names in the job's tenant (RLS), or null — e.g. who changed the security policy. */
export async function loadPersonName(
  tx: ClaimsTx,
  personId: string,
): Promise<{ readonly ar: string; readonly en: string | null } | null> {
  const [row] = await tx.execute<{ name_ar: string; name_en: string | null }>(
    sql`select display_name_ar as name_ar, display_name_en as name_en
        from platform.persons where id = ${personId}::uuid`,
  );
  return row ? { ar: row.name_ar, en: row.name_en } : null;
}
