import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ClaimsTx } from '../claims-tx';
import { customRolesExist } from '../custom-roles-present';

/**
 * Invitation e-mails (FR-IAM-03, T-M2-07; migrations 20261009090000 and 20261018090000): the mailer job
 * (system claims) loads what the e-mail needs, including the invitation's current CODE — issued by the
 * database when the member invited or resent (or when a held import invitation was released) — and
 * e-mails that code's link. The mailer issues no token: the database already counted the code and gave
 * the link its 7 days.
 */
export interface InvitationForMail {
  readonly id: string;
  readonly status: 'pending' | 'accepted' | 'revoked';
  readonly sendCount: number;
  readonly email: string;
  readonly locale: 'ar' | 'en';
  readonly personId: string;
  readonly recipientName: { ar: string; en: string | null };
  /**
   * The inviter's person in this organization — for a held invitation sent on request, the member who
   * asked to send it (integration review M2) — or the organization's name when there is none.
   */
  readonly inviterName: { ar: string; en: string | null };
  readonly organizationName: { ar: string; en: string | null };
  readonly primaryRole: string;
  /** The names of a custom role (EP-ROLES); null for a standard role (named by the caller). */
  readonly primaryRoleName: { readonly ar: string; readonly en: string } | null;
  /** The member who invited (an import's importer). */
  readonly invitedBy: string | null;
  /**
   * The member who asked to send this held import invitation from the users list (integration review
   * M2): its release and e-mail act for them. Null when the import sent it (for the importer).
   */
  readonly sendRequestedBy: string | null;
  /** Not sent yet (T-M2-12): held invitations are never mailed. */
  readonly mailHeld: boolean;
  /** When the current code (link) expires. */
  readonly expiresAt: Date;
}

/** Everything the invitation e-mail needs, or null when the invitation is unknown in this tenant. */
export async function loadInvitationForMail(
  tx: ClaimsTx,
  id: string,
): Promise<InvitationForMail | null> {
  // The worker deploys with the app, ahead of the database: a custom role's names once its table exists.
  const customNames = await customRolesExist(tx);
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
    role_name_ar: string | null;
    role_name_en: string | null;
    invited_by: string | null;
    send_requested_by: string | null;
    mail_held: boolean;
    expires_at: Date | string;
  }>(sql`
    select i.id, i.status, i.send_count, i.email, i.locale, i.person_id, i.invited_by,
           i.send_requested_by, i.mail_held, i.expires_at,
           -- A person may have an English name only (PO 17 Oct 2026): the Arabic e-mail then names them in English.
           coalesce(p.display_name_ar, p.display_name_en) as recipient_ar, p.display_name_en as recipient_en,
           coalesce(ip.display_name_ar, ip.display_name_en) as inviter_ar, ip.display_name_en as inviter_en,
           t.name_ar as organization_ar, t.name_en as organization_en, i.primary_role,
           ${customNames ? sql`cr.name_ar` : sql`null::text`} as role_name_ar,
           ${customNames ? sql`cr.name_en` : sql`null::text`} as role_name_en
    from platform.invitations i
    join platform.persons p on p.tenant_id = i.tenant_id and p.id = i.person_id
    join platform.tenants t on t.id = i.tenant_id
    left join platform.tenant_memberships m
           on m.tenant_id = i.tenant_id and m.user_id = coalesce(i.send_requested_by, i.invited_by)
    left join platform.persons ip on ip.tenant_id = m.tenant_id and ip.id = m.person_id
    ${customNames ? sql`left join platform.custom_roles cr on cr.tenant_id = i.tenant_id and cr.code = i.primary_role` : sql``}
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
    primaryRoleName:
      row.role_name_ar !== null && row.role_name_en !== null
        ? { ar: row.role_name_ar, en: row.role_name_en }
        : null,
    invitedBy: row.invited_by,
    sendRequestedBy: row.send_requested_by,
    mailHeld: row.mail_held,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
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

/**
 * The current code of a pending, sent invitation of the job's organization (private.invitation_code_for_mail:
 * app_worker system claims only), or null — revoked, accepted, held, another organization's, or a link
 * e-mailed before codes. The code is a credential: never log it.
 */
export async function invitationCodeForMail(tx: ClaimsTx, id: string): Promise<string | null> {
  const [row] = await tx.execute<{ code: string | null }>(sql`
    select private.invitation_code_for_mail(${id}::uuid) as code`);
  return row?.code ?? null;
}
