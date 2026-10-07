import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ClaimsTx } from '../claims-tx';

/**
 * Invitation e-mails (FR-IAM-03, T-M2-07; migration 20261009090000): the mailer job (system claims)
 * loads what the e-mail needs and issues a new token — only its SHA-256 is stored; the database counts
 * the e-mail, stamps the issue time and gives the link 7 more days. A newer token replaces the older one.
 */
export interface InvitationForMail {
  readonly id: string;
  readonly status: 'pending' | 'accepted' | 'revoked';
  readonly sendCount: number;
  readonly email: string;
  readonly locale: 'ar' | 'en';
  readonly personId: string;
  readonly recipientName: { ar: string; en: string | null };
  /** The inviter's person in this organization; the organization's name when there is none. */
  readonly inviterName: { ar: string; en: string | null };
  readonly organizationName: { ar: string; en: string | null };
  readonly primaryRole: string;
}

/** Everything the invitation e-mail needs, or null when the invitation is unknown in this tenant. */
export async function loadInvitationForMail(
  tx: ClaimsTx,
  id: string,
): Promise<InvitationForMail | null> {
  const [row] = await tx.execute<{
    id: string;
    status: InvitationForMail['status'];
    send_count: number;
    email: string;
    locale: string;
    person_id: string;
    recipient_ar: string;
    recipient_en: string | null;
    inviter_ar: string | null;
    inviter_en: string | null;
    organization_ar: string;
    organization_en: string | null;
    primary_role: string;
  }>(sql`
    select i.id, i.status, i.send_count, i.email, i.locale, i.person_id,
           p.display_name_ar as recipient_ar, p.display_name_en as recipient_en,
           ip.display_name_ar as inviter_ar, ip.display_name_en as inviter_en,
           t.name_ar as organization_ar, t.name_en as organization_en, i.primary_role
    from platform.invitations i
    join platform.persons p on p.tenant_id = i.tenant_id and p.id = i.person_id
    join platform.tenants t on t.id = i.tenant_id
    left join platform.tenant_memberships m on m.tenant_id = i.tenant_id and m.user_id = i.invited_by
    left join platform.persons ip on ip.tenant_id = m.tenant_id and ip.id = m.person_id
    where i.id = ${id}::uuid`);
  if (!row) return null;
  const organizationName = { ar: row.organization_ar, en: row.organization_en };
  return {
    id: row.id,
    status: row.status,
    sendCount: row.send_count,
    email: row.email,
    locale: row.locale === 'en' ? 'en' : 'ar',
    personId: row.person_id,
    recipientName: { ar: row.recipient_ar, en: row.recipient_en },
    inviterName:
      row.inviter_ar === null ? organizationName : { ar: row.inviter_ar, en: row.inviter_en },
    organizationName,
    primaryRole: row.primary_role,
  };
}

const UserId = z.uuid();

/**
 * May this member (Auth user id) of the job's tenant manage the invitation NOW (security review M2)?
 * True for an active Organization Admin, or an active HR Manager when the invitation gives no privileged
 * role — the rules the database applied when they invited or asked for a resend, read again from their
 * current roles: the mailer sends nothing for a member who was revoked, suspended or demoted since.
 * False for an unknown invitation or a malformed id.
 */
export async function invitationActorMayManage(
  tx: ClaimsTx,
  id: string,
  userId: string,
): Promise<boolean> {
  if (!UserId.safeParse(userId).success) return false;
  const [row] = await tx.execute<{ allowed: boolean }>(sql`
    select 'tenant_admin' = any (r.codes)
           or ('hr_manager' = any (r.codes)
               and not exists (select 1 from platform.ref_roles x
                               where x.code = any (array[i.primary_role] || i.additional_roles)
                                 and x.is_privileged)) as allowed
    from platform.invitations i
    cross join lateral (select private.actor_role_codes(i.tenant_id, ${userId}::uuid) as codes) r
    where i.id = ${id}::uuid`);
  return row?.allowed === true;
}

/** Same limit as the request path (the database refuses a 5th e-mail). */
const MAX_SENDS = 4;

/**
 * Stores the SHA-256 of a new token for a pending invitation that has had fewer than 4 e-mails, and
 * returns the link's new expiry. Null when the invitation is not pending (accepted, revoked, unknown) or
 * the limit is reached: send nothing.
 */
export async function issueInvitationToken(
  tx: ClaimsTx,
  id: string,
  tokenHash: Buffer,
): Promise<{ expiresAt: Date } | null> {
  if (tokenHash.length !== 32) throw new Error('issueInvitationToken: expected a SHA-256 hash');
  const [row] = await tx.execute<{ expires_at: Date | string }>(sql`
    update platform.invitations set token_hash = ${tokenHash}::bytea
    where id = ${id}::uuid and status = 'pending' and send_count < ${MAX_SENDS}
    returning expires_at`);
  if (!row) return null;
  return {
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
  };
}
