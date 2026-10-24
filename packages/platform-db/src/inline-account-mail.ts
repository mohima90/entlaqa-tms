import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';

/**
 * Account e-mails sent the moment the action commits (WP-ADM-05 follow-up, PO 23 Oct 2026; migration
 * 20261026120000). The action still queues its account e-mail request as before (password changed,
 * authenticator set-up and removal, policy change, unlock, account locked, wrong codes) and, in the same
 * transaction, TAGS what it queued with the SHA-256 of a secret only that web request holds
 * (`tagInlineAccountMail`). After the response `claim` takes the requests one by one with the secret -
 * the database resolves who gets each one (the worker's own rules, one body of SQL) - `queue` writes the
 * delivery and removes the request in one step, and the delivery is sent under the lease it shares with the
 * worker. A request nobody finishes is the worker's again after two minutes. The Send Email hook's password
 * reset (type recovery) is queued the same way (`createInlineRecoveryApi`). Nothing here logs a secret, an
 * address or content.
 */

/** The request's key: the secret that alone can claim what the transaction tagged. */
export interface InlineAccountMailTicket {
  readonly secret: Buffer;
}

/**
 * In the action's transaction, after it created its account e-mail requests: tags them for an immediate
 * e-mail. Null when this transaction created none (nothing to send from here).
 */
export async function tagInlineAccountMail(tx: ClaimsTx): Promise<InlineAccountMailTicket | null> {
  const secret = randomBytes(32);
  const hash = createHash('sha256').update(secret).digest();
  const [row] = await tx.execute<{ tagged: number | string }>(
    sql`select private.inline_account_mail_tag(${hash}::bytea) as tagged`,
  );
  return Number(row?.tagged ?? 0) > 0 ? { secret } : null;
}

export const INLINE_ACCOUNT_MAIL_KINDS = [
  'password_changed',
  'mfa_factor_added',
  'mfa_factor_removed',
  'security_policy_changed',
  'security_digest',
  'account_locked',
  'sign_in_unlocked',
  'mfa_code_locked',
] as const;
export type InlineAccountMailKind = (typeof INLINE_ACCOUNT_MAIL_KINDS)[number];

/** Why a claimed request is not sent (the database has removed it already). */
export type InlineAccountMailSkip =
  'unknown_account' | 'banned' | 'too_soon' | 'no_membership' | 'held' | 'factor_gone';

export interface InlineAccountMailSend {
  readonly outcome: 'send';
  readonly requestId: string;
  readonly kind: InlineAccountMailKind;
  readonly userId: string;
  readonly tenantId: string;
  readonly personId: string;
  /** The account's address as Auth stores it. */
  readonly email: string;
  readonly locale: 'ar' | 'en';
  readonly attempt: number;
  readonly factorId: string | null;
  readonly mfaReason: string | null;
  readonly detail: unknown;
  readonly lockMinutes: number | null;
  readonly organizationName: { readonly ar: string; readonly en: string | null };
  readonly recipientName: { readonly ar: string; readonly en: string | null };
  /** E-mails of this kind's template queued for the person in the last hour / the quiet minutes; for the organization in the last hour. */
  readonly recentCount: number;
  readonly quietCount: number;
  readonly tenantRecentCount: number;
  /** The platform sender only: several organizations or a platform role (WP-ADM-05 security review M1). */
  readonly platformSender: boolean;
  /** security_policy_changed: who changed it. */
  readonly changedByName: { readonly ar: string; readonly en: string | null } | null;
  /** mfa_factor_added: when and with which browser the app was set up. */
  readonly setUpAt: Date | null;
  readonly setupUserAgent: string | null;
  readonly brand: {
    readonly actionColor: string | null;
    readonly linkColor: string | null;
    readonly logoAssetId: string | null;
  } | null;
}

export type InlineAccountMailClaim =
  | { readonly outcome: 'none' }
  | {
      readonly outcome: InlineAccountMailSkip;
      readonly requestId: string;
      readonly kind: InlineAccountMailKind;
    }
  | InlineAccountMailSend;

/** What the web app writes for a claimed request: the kind's own template, rendered. */
export interface InlineAccountMailToQueue {
  readonly template: string;
  readonly templateVersion: number;
  readonly locale: 'ar' | 'en';
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** mfa_factor_added: SHA-256 of the set-up code (with the factor id) and of the "not you" link's token. */
  readonly codeHash?: Buffer;
  readonly removeHash?: Buffer;
}

export interface InlineAccountMailApi {
  /**
   * The next request this web request tagged, with everything the e-mail needs. `lockedQuietMinutes`: the
   * "account locked" e-mail's quiet period (at most one to a person within it). `none`: nothing waits.
   */
  claim(secret: Buffer, lockedQuietMinutes: number): Promise<InlineAccountMailClaim>;
  /** Writes the delivery and removes the request, in one step. Null: the request is no longer this claim's. */
  queue(secret: Buffer, requestId: string, mail: InlineAccountMailToQueue): Promise<string | null>;
  /** Removes a claimed request that will not be sent (over a cap, content refused). */
  done(secret: Buffer, requestId: string): Promise<boolean>;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKIPS: ReadonlySet<string> = new Set<InlineAccountMailSkip>([
  'unknown_account',
  'banned',
  'too_soon',
  'no_membership',
  'held',
  'factor_gone',
]);

interface ClaimSqlRow {
  outcome: string;
  request_id: string | null;
  kind: string | null;
  user_id: string | null;
  tenant_id: string | null;
  person_id: string | null;
  email: string | null;
  locale: string | null;
  attempts: number | null;
  factor_id: string | null;
  mfa_reason: string | null;
  detail: unknown;
  lock_minutes: number | null;
  organization_ar: string | null;
  organization_en: string | null;
  recipient_ar: string | null;
  recipient_en: string | null;
  recent_count: number | string | null;
  quiet_count: number | string | null;
  tenant_recent_count: number | string | null;
  platform_sender: boolean | null;
  changed_by_ar: string | null;
  changed_by_en: string | null;
  set_up_at: Date | string | null;
  setup_user_agent: string | null;
  action_color: string | null;
  link_color: string | null;
  logo_asset_id: string | null;
}

function kindOf(value: string | null): InlineAccountMailKind | null {
  return INLINE_ACCOUNT_MAIL_KINDS.find((k) => k === value) ?? null;
}

/** Over a database connected as `app_server`, in a transaction WITHOUT claims: the secret is the credential. */
export function createInlineAccountMailApi(getDb: () => AppDatabase): InlineAccountMailApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  return {
    async claim(secret, lockedQuietMinutes) {
      if (
        secret.length !== 32 ||
        !Number.isInteger(lockedQuietMinutes) ||
        lockedQuietMinutes < 0 ||
        lockedQuietMinutes > 1440
      ) {
        return { outcome: 'none' };
      }
      const [row] = await withoutClaims((tx) =>
        tx.execute<ClaimSqlRow & Record<string, unknown>>(
          sql`select * from private.inline_account_mail_claim(${secret}::bytea, ${lockedQuietMinutes}::integer)`,
        ),
      );
      if (!row || row.outcome === 'none') return { outcome: 'none' };
      const kind = kindOf(row.kind);
      if (SKIPS.has(row.outcome)) {
        if (!row.request_id || !kind) return { outcome: 'none' };
        return {
          outcome: row.outcome as InlineAccountMailSkip,
          requestId: row.request_id,
          kind,
        };
      }
      if (
        row.outcome !== 'send' ||
        !kind ||
        !row.request_id ||
        !row.user_id ||
        !row.tenant_id ||
        !row.person_id ||
        !row.email ||
        row.organization_ar === null ||
        row.recipient_ar === null
      ) {
        throw new Error('inline account e-mail: incomplete claim');
      }
      const colors =
        row.action_color !== null &&
        row.link_color !== null &&
        HEX.test(row.action_color) &&
        HEX.test(row.link_color);
      return {
        outcome: 'send',
        requestId: row.request_id,
        kind,
        userId: row.user_id,
        tenantId: row.tenant_id,
        personId: row.person_id,
        email: row.email,
        locale: row.locale === 'en' ? 'en' : 'ar',
        attempt: row.attempts ?? 1,
        factorId: row.factor_id,
        mfaReason: row.mfa_reason,
        detail: row.detail,
        lockMinutes: row.lock_minutes,
        organizationName: { ar: row.organization_ar, en: row.organization_en },
        recipientName: { ar: row.recipient_ar, en: row.recipient_en },
        recentCount: Number(row.recent_count ?? 0),
        quietCount: Number(row.quiet_count ?? 0),
        tenantRecentCount: Number(row.tenant_recent_count ?? 0),
        // Anything but a clear "no" is the safe answer.
        platformSender: row.platform_sender !== false,
        changedByName:
          row.changed_by_ar === null ? null : { ar: row.changed_by_ar, en: row.changed_by_en },
        setUpAt: row.set_up_at === null ? null : new Date(row.set_up_at),
        setupUserAgent: row.setup_user_agent,
        brand:
          colors || row.logo_asset_id
            ? {
                actionColor: colors ? row.action_color : null,
                linkColor: colors ? row.link_color : null,
                logoAssetId: row.logo_asset_id,
              }
            : null,
      };
    },
    async queue(secret, requestId, mail) {
      if (secret.length !== 32 || !UUID.test(requestId)) return null;
      const [row] = await withoutClaims((tx) =>
        tx.execute<{ id: string | null }>(sql`
          select private.inline_account_mail_queue(${secret}::bytea, ${requestId}::uuid, ${mail.template},
                                                    ${mail.templateVersion}::integer, ${mail.locale}, ${mail.subject},
                                                    ${mail.html}, ${mail.text}, ${mail.codeHash ?? null}::bytea,
                                                    ${mail.removeHash ?? null}::bytea) as id`),
      );
      return row?.id ?? null;
    },
    async done(secret, requestId) {
      if (secret.length !== 32 || !UUID.test(requestId)) return false;
      const [row] = await withoutClaims((tx) =>
        tx.execute<{ done: boolean }>(
          sql`select private.inline_account_mail_done(${secret}::bytea, ${requestId}::uuid) as done`,
        ),
      );
      return row?.done === true;
    },
  };
}

/** The default API over the web app's `app_server` connection. */
export const inlineAccountMailApi = createInlineAccountMailApi(() => getDatabase('app_server'));

// ---------------------------------------------------------------------------------------------------------
// The reset e-mail of Auth's Send Email hook (type recovery)
// ---------------------------------------------------------------------------------------------------------

/** What the reset e-mail needs about the account Auth is e-mailing (private.inline_recovery_facts). */
export interface InlineRecoveryFacts {
  readonly email: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly locale: 'ar' | 'en';
  readonly platformSender: boolean;
  /** The account has an authenticator app: the reset page asks for its code. */
  readonly hasApp: boolean;
  readonly organizationName: { readonly ar: string; readonly en: string | null };
  readonly brand: {
    readonly actionColor: string | null;
    readonly linkColor: string | null;
    readonly logoAssetId: string | null;
  } | null;
}

export interface InlineRecoveryToQueue {
  readonly userId: string;
  readonly template: string;
  readonly templateVersion: number;
  readonly locale: 'ar' | 'en';
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** `recovery:<hex>`: one delivery per webhook call. */
  readonly sourceKey: string;
}

export interface InlineRecoveryApi {
  /** Null: no account, a banned one, no usable membership - nothing to send. */
  facts(userId: string): Promise<InlineRecoveryFacts | null>;
  /**
   * Queues the reset e-mail as a delivery the web app then sends (its id and the secret that claims it).
   * Null: over the hourly cap, no usable account, or the same webhook queued already.
   */
  queue(
    mail: InlineRecoveryToQueue,
  ): Promise<{ readonly id: string; readonly secret: Buffer } | null>;
}

export function createInlineRecoveryApi(getDb: () => AppDatabase): InlineRecoveryApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  return {
    async facts(userId) {
      if (!UUID.test(userId)) return null;
      const [row] = await withoutClaims((tx) =>
        tx.execute<{
          email: string;
          tenant_id: string;
          person_id: string;
          locale: string;
          platform_sender: boolean | null;
          has_app: boolean | null;
          organization_ar: string;
          organization_en: string | null;
          action_color: string | null;
          link_color: string | null;
          logo_asset_id: string | null;
        }>(sql`select * from private.inline_recovery_facts(${userId}::uuid)`),
      );
      if (!row) return null;
      const colors =
        row.action_color !== null &&
        row.link_color !== null &&
        HEX.test(row.action_color) &&
        HEX.test(row.link_color);
      return {
        email: row.email,
        tenantId: row.tenant_id,
        personId: row.person_id,
        locale: row.locale === 'en' ? 'en' : 'ar',
        platformSender: row.platform_sender !== false,
        hasApp: row.has_app === true,
        organizationName: { ar: row.organization_ar, en: row.organization_en },
        brand:
          colors || row.logo_asset_id
            ? {
                actionColor: colors ? row.action_color : null,
                linkColor: colors ? row.link_color : null,
                logoAssetId: row.logo_asset_id,
              }
            : null,
      };
    },
    async queue(mail) {
      if (!UUID.test(mail.userId)) return null;
      const secret = randomBytes(32);
      const hash = createHash('sha256').update(secret).digest();
      const [row] = await withoutClaims((tx) =>
        tx.execute<{ id: string | null }>(sql`
          select private.inline_recovery_queue(${mail.userId}::uuid, ${mail.template}, ${mail.templateVersion}::integer,
                                                ${mail.locale}, ${mail.to}, ${mail.subject}, ${mail.html}, ${mail.text},
                                                ${mail.sourceKey}, ${hash}::bytea) as id`),
      );
      return row?.id ? { id: row.id, secret } : null;
    },
  };
}

export const inlineRecoveryApi = createInlineRecoveryApi(() => getDatabase('app_server'));
