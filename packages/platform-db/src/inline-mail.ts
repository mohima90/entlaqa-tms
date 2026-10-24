import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { type EmailRouteRow, type EmailRouteSqlRow, toEmailRouteRow } from './email-route';

/**
 * E-mail sent the moment the action commits (WP-ADM-05 follow-up, PO 23 Oct 2026; migration 20261026110000).
 * The web app queues the message INSIDE the action's transaction (`queueInlineEmail`, which also makes the
 * request's secret), and after the response claims it with that secret (`claim`), sends it and records the
 * outcome (`finish`) - under the same lease the worker's sender uses, so the message goes out once whoever
 * gets it; the worker's rescue sends what nobody finished. Every function checks the login role and, where
 * a member acts, the caller's authority itself. Nothing here logs a secret, an address or content.
 */

/** What an invitation e-mail needs, for a member who may manage the invitation (private.inline_invitation_prepare). */
export interface InlineInvitationFacts {
  readonly invitationId: string;
  readonly sendCount: number;
  readonly email: string;
  readonly locale: 'ar' | 'en';
  readonly personId: string;
  /** The invitation's CURRENT code. */
  readonly code: string;
  readonly recipientName: { readonly ar: string; readonly en: string | null };
  /** The inviter (the caller); the organization's name when they have none. */
  readonly inviterName: { readonly ar: string; readonly en: string | null };
  readonly organizationName: { readonly ar: string; readonly en: string | null };
  readonly primaryRole: string;
  /** A custom role's names (null: a standard role, named by the catalogue). */
  readonly primaryRoleName: { readonly ar: string; readonly en: string } | null;
  readonly expiresAt: Date;
  /** `invitation:<id>:<code number>`: one message per code. */
  readonly sourceKey: string;
  readonly brand: {
    readonly actionColor: string | null;
    readonly linkColor: string | null;
    readonly logoAssetId: string | null;
  } | null;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Null: nothing to e-mail (not pending, not sent, not the caller's to manage, another organization's). */
export async function prepareInlineInvitation(
  tx: ClaimsTx,
  invitationId: string,
): Promise<InlineInvitationFacts | null> {
  const [row] = await tx.execute<{
    invitation_id: string;
    send_count: number;
    email: string;
    locale: string;
    person_id: string;
    invite_code: string;
    recipient_ar: string;
    recipient_en: string | null;
    inviter_ar: string | null;
    inviter_en: string | null;
    organization_ar: string;
    organization_en: string | null;
    primary_role: string;
    role_name_ar: string | null;
    role_name_en: string | null;
    expires_at: Date | string;
    source_key: string;
    action_color: string | null;
    link_color: string | null;
    logo_asset_id: string | null;
  }>(sql`select * from private.inline_invitation_prepare(${invitationId}::uuid)`);
  if (!row) return null;
  const organizationName = { ar: row.organization_ar, en: row.organization_en };
  const colors =
    row.action_color !== null &&
    row.link_color !== null &&
    HEX.test(row.action_color) &&
    HEX.test(row.link_color);
  return {
    invitationId: row.invitation_id,
    sendCount: row.send_count,
    email: row.email,
    locale: row.locale === 'en' ? 'en' : 'ar',
    personId: row.person_id,
    code: row.invite_code,
    recipientName: { ar: row.recipient_ar, en: row.recipient_en },
    inviterName:
      row.inviter_ar === null ? organizationName : { ar: row.inviter_ar, en: row.inviter_en },
    organizationName,
    primaryRole: row.primary_role,
    primaryRoleName:
      row.role_name_ar !== null && row.role_name_en !== null
        ? { ar: row.role_name_ar, en: row.role_name_en }
        : null,
    expiresAt: new Date(row.expires_at),
    sourceKey: row.source_key,
    brand:
      colors || row.logo_asset_id
        ? {
            actionColor: colors ? row.action_color : null,
            linkColor: colors ? row.link_color : null,
            logoAssetId: row.logo_asset_id,
          }
        : null,
  };
}

/** The kinds of message the database knows how to authorize (private.inline_mail_queue). */
export type InlineMailKind = 'invitation';

export interface InlineMailToQueue {
  readonly kind: InlineMailKind;
  /** The thing the message answers (the invitation's id). */
  readonly ref: string;
  readonly template: string;
  readonly templateVersion: number;
  readonly locale: 'ar' | 'en';
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly sourceKey: string;
}

/** The request's claim on a queued message: its id and the secret that alone can claim it. */
export interface InlineMailTicket {
  readonly id: string;
  readonly secret: Buffer;
}

/**
 * Queues one message in the caller's transaction (the action's). Null: the same message was queued already
 * (the worker's mailer or an earlier request) - nothing to send from here.
 */
export async function queueInlineEmail(
  tx: ClaimsTx,
  mail: InlineMailToQueue,
): Promise<InlineMailTicket | null> {
  const secret = randomBytes(32);
  const hash = createHash('sha256').update(secret).digest();
  const [row] = await tx.execute<{ id: string | null }>(sql`
    select private.inline_mail_queue(${mail.kind}, ${mail.ref}::uuid, ${mail.template}, ${mail.templateVersion}::integer,
                                      ${mail.locale}, ${mail.to}, ${mail.subject}, ${mail.html}, ${mail.text},
                                      ${mail.sourceKey}, ${hash}::bytea) as id`);
  return row?.id ? { id: row.id, secret } : null;
}

/** A message claimed for an immediate send, with the organization's sender settings. */
export interface ClaimedInlineMail {
  readonly tenantId: string;
  readonly template: string;
  readonly destination: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attempts: number;
  readonly route: EmailRouteRow;
}

export type InlineClaim =
  | { readonly outcome: 'claimed'; readonly mail: ClaimedInlineMail }
  /** Another sender holds the lease (the worker's rescue): it will record the outcome. */
  | { readonly outcome: 'busy' }
  /** Final, unknown, not this request's, or the organization is not served: nothing to do. */
  | { readonly outcome: 'gone' };

export type InlineOutcome =
  | {
      readonly status: 'sent';
      readonly provider: string;
      readonly providerMessageId: string | null;
      readonly sender: 'organization' | 'platform' | 'installation';
    }
  | {
      readonly status: 'failed';
      readonly errorCode: string;
      readonly provider: string | null;
      readonly sender: 'organization' | 'platform' | 'installation' | null;
    }
  /** Temporary failure or no sender ready: back to the queue (content kept) with the reason. */
  | { readonly status: 'retry'; readonly errorCode: string };

export interface InlineMailApi {
  claim(id: string, secret: Buffer): Promise<InlineClaim>;
  /** False when the message is no longer being sent by this claim (finished elsewhere). */
  finish(id: string, secret: Buffer, outcome: InlineOutcome): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ClaimSqlRow extends EmailRouteSqlRow {
  outcome: string;
  tenant_id: string | null;
  template: string | null;
  destination: string | null;
  subject: string | null;
  html: string | null;
  text_body: string | null;
  attempts: number | null;
}

/** Over a database connected as `app_server`, in a transaction WITHOUT claims: the secret is the credential. */
export function createInlineMailApi(getDb: () => AppDatabase): InlineMailApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  return {
    async claim(id, secret) {
      if (!UUID.test(id) || secret.length !== 32) return { outcome: 'gone' };
      const [row] = await withoutClaims((tx) =>
        tx.execute<ClaimSqlRow & Record<string, unknown>>(
          sql`select * from private.inline_mail_claim(${id}::uuid, ${secret}::bytea)`,
        ),
      );
      if (!row || row.outcome === 'gone') return { outcome: 'gone' };
      if (row.outcome === 'busy') return { outcome: 'busy' };
      if (
        row.outcome !== 'claimed' ||
        row.tenant_id === null ||
        row.template === null ||
        row.destination === null ||
        row.subject === null ||
        row.html === null ||
        row.text_body === null
      ) {
        return { outcome: 'gone' };
      }
      return {
        outcome: 'claimed',
        mail: {
          tenantId: row.tenant_id,
          template: row.template,
          destination: row.destination,
          subject: row.subject,
          html: row.html,
          text: row.text_body,
          attempts: row.attempts ?? 1,
          route: toEmailRouteRow(row),
        },
      };
    },
    async finish(id, secret, outcome) {
      if (!UUID.test(id) || secret.length !== 32) return false;
      const status = outcome.status;
      const errorCode = status === 'sent' ? null : outcome.errorCode;
      const provider = status === 'retry' ? null : outcome.provider;
      const messageId = status === 'sent' ? outcome.providerMessageId : null;
      const sender = status === 'retry' ? null : outcome.sender;
      const [row] = await withoutClaims((tx) =>
        tx.execute<{ done: boolean }>(sql`
          select private.inline_mail_finish(${id}::uuid, ${secret}::bytea, ${status}, ${errorCode}, ${provider},
                                            ${messageId}, ${sender}) as done`),
      );
      return row?.done === true;
    },
  };
}

/** The default API over the web app's `app_server` connection. */
export const inlineMailApi = createInlineMailApi(() => getDatabase('app_server'));
