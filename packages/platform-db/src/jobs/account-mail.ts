import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';

/**
 * Account e-mails, worker side (T-M2-17; migrations 20261010120000, 20261012110000). The account-mail job
 * leases a request in a platform transaction (system claims without a tenant), learns whom to write in
 * which organization and language — or why nothing is sent — and finishes the request in the
 * organization's transaction that queues the e-mail. Only the definer functions reach the queue. T-M2-10
 * adds the security notices: the authenticator set-up e-mail (its one-time code and "not you" link) and
 * removal notice, the policy-change notice, and the digest of the notices over an account's daily ceiling.
 */
export const ACCOUNT_MAIL_KINDS = [
  'password_reset',
  'password_changed',
  'mfa_factor_added',
  'mfa_factor_removed',
  'security_policy_changed',
  'security_digest',
] as const;
export type AccountMailKind = (typeof ACCOUNT_MAIL_KINDS)[number];

/**
 * The security notices the database merges into an account's digest once its daily ceiling is reached
 * (final re-review L1).
 */
export const DIGESTED_KINDS = [
  'mfa_factor_added',
  'mfa_factor_removed',
  'security_policy_changed',
  'password_changed',
] as const;
export type DigestedKind = (typeof DIGESTED_KINDS)[number];

/** A security digest: how many notices of each kind were held, since when. */
export interface SecurityDigest {
  readonly held: Readonly<Partial<Record<DigestedKind, number>>>;
  readonly since: Date;
}

function securityDigestOf(detail: unknown): SecurityDigest | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const { held, since } = detail as Record<string, unknown>;
  if (typeof held !== 'object' || held === null || typeof since !== 'string') return null;
  const counts: Partial<Record<DigestedKind, number>> = {};
  for (const [kind, count] of Object.entries(held as Record<string, unknown>)) {
    const known = DIGESTED_KINDS.find((k) => k === kind);
    if (!known || typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;
    counts[known] = count;
  }
  const at = new Date(since);
  if (Object.keys(counts).length === 0 || Number.isNaN(at.getTime())) return null;
  return { held: counts, since: at };
}

/** Why an authenticator app was removed (the removal notice says so). */
export const MFA_REMOVAL_REASONS = [
  'removed',
  'not_me',
  'admin_reset',
  'support_reset',
  'expired',
  'too_many_codes',
] as const;
export type MfaRemovalReason = (typeof MFA_REMOVAL_REASONS)[number];

/**
 * Why no e-mail is sent for a request now (decided by the database, never by the web app). `held`: a security
 * notice over the account's daily ceiling, merged into its hourly digest (final re-review L1).
 */
export type AccountMailSkip = 'unknown_account' | 'banned' | 'too_soon' | 'no_membership' | 'held';

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
  /** security_digest: the held notices by kind, since when. */
  readonly digest: SecurityDigest | null;
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
  'held',
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
  const digest = kind === 'security_digest' ? securityDigestOf(row.detail) : null;
  if (kind === 'security_digest' && !digest) {
    throw new Error('claimAccountMailRequest: security digest without its detail');
  }
  const base = {
    id: row.id,
    kind,
    attempt: row.attempts,
    factorId: row.factor_id,
    mfaReason: reason,
    policyChange,
    digest,
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

/** What the set-up e-mail states: the code's and link's lifetimes, when and with which browser. */
export interface MfaFactorTokens {
  readonly codeExpiresAt: Date;
  readonly removeExpiresAt: Date;
  readonly setUpAt: Date;
  /** The set-up session's browser (Auth's user agent): shown parsed in the e-mail, never logged. */
  readonly setupUserAgent: string | null;
}

/**
 * The worker stores the SHA-256 of the set-up e-mail's one-time code (with the factor id) and of its "not
 * you" link right before queueing it (each new e-mail replaces the previous code and link and resets the
 * tries; re-review N1). Null when the app is gone or already confirmed: nothing to send.
 */
export async function issueMfaFactorTokens(
  tx: ClaimsTx,
  factorId: string,
  userId: string,
  codeHash: Buffer,
  removeHash: Buffer,
): Promise<MfaFactorTokens | null> {
  const [row] = await tx.execute<{
    code_expires_at: Date | string | null;
    remove_expires_at: Date | string | null;
    set_up_at: Date | string | null;
    setup_user_agent: string | null;
  }>(sql`select code_expires_at, remove_expires_at, set_up_at, setup_user_agent
         from private.issue_mfa_factor_tokens(${factorId}::uuid, ${userId}::uuid, ${codeHash}::bytea,
                                              ${removeHash}::bytea)`);
  if (!row?.code_expires_at || !row.remove_expires_at) return null;
  return {
    codeExpiresAt: new Date(row.code_expires_at),
    removeExpiresAt: new Date(row.remove_expires_at),
    setUpAt: new Date(row.set_up_at ?? row.code_expires_at),
    setupUserAgent: row.setup_user_agent ?? null,
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

/**
 * Authenticator apps nobody confirmed within 72 hours (re-review N2) are removed: the sessions that passed
 * their code end, the account is e-mailed (reason "expired") and the removal audited — a waiting app never
 * blocks its owner (Auth asks a code from every verified app). At most `limit`; returns how many.
 */
export async function purgeUnconfirmedMfaApps(tx: ClaimsTx, limit: number): Promise<number> {
  const [row] = await tx.execute<{ purged: number | string }>(
    sql`select private.purge_unconfirmed_mfa_apps(${limit}::integer) as purged`,
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
