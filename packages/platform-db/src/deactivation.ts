import 'server-only';
import { sql } from 'drizzle-orm';
import { emitEvent } from './events';
import { revokeInvitation } from './invitations';
import { listManagerOptions, pgError } from './user-admin';
import type { UserTx } from './with-user-tx';

/**
 * Deactivate / reactivate a member (T-M2-09, FR-IAM-05; approved screen 4; migrations 20261011090000 and
 * 20261011090100). Request-path helpers that run inside the signed-in member's withUserTx: the caller holds
 * `platform.user.deactivate` for the person (defineAction resource); the database guards have the final
 * word — who may change a membership or a person record, never oneself, never the last Organization Admin
 * without an end date, reactivation only through private.reactivate_membership (privileged members:
 * Organization Admin with AAL2). A deactivation keeps every record: the person becomes inactive, the
 * membership `suspended`, roles and placement stay; the member's sign-in sessions in this organization end
 * (database trigger) and the worker bans the Auth account once it signs in nowhere (ban queue).
 * Audit records are the calling action's job (defineAction); these helpers emit the domain events.
 */

export const MEMBER_EVENTS = {
  deactivated: 'com.entlaqa.platform.user.deactivated',
  reactivated: 'com.entlaqa.platform.user.reactivated',
} as const;

export type MembershipState = 'invited' | 'active' | 'suspended' | 'revoked';

/** What the deactivate / reactivate screens and actions need to know about the person. */
export interface MemberLifecycleTarget {
  readonly personId: string;
  readonly displayNameAr: string;
  readonly displayNameEn: string | null;
  readonly personStatus: 'active' | 'inactive';
  /** Null when the person has no sign-in account in this organization. */
  readonly membershipId: string | null;
  readonly membershipStatus: MembershipState | null;
  /** The signed-in member's own membership: nobody deactivates or reactivates themselves. */
  readonly isSelf: boolean;
  /** Same rule as the database guards (private.actor_may_manage_person). */
  readonly mayManage: boolean;
  /** Holds a privileged role (now or later): reactivation needs the Organization Admin with AAL2. */
  readonly privileged: boolean;
  /**
   * Deactivating this active member would leave the organization without an active Organization Admin
   * whose role has no end date (the database refuses it: private.check_last_admin_membership).
   */
  readonly lastAdmin: boolean;
}

export async function getMemberLifecycleTarget(
  tx: UserTx,
  personId: string,
): Promise<MemberLifecycleTarget | null> {
  const [row] = await tx.execute<{
    person_id: string;
    display_name_ar: string;
    display_name_en: string | null;
    person_status: 'active' | 'inactive';
    membership_id: string | null;
    membership_status: MembershipState | null;
    is_self: boolean;
    may_manage: boolean;
    privileged: boolean;
    last_admin: boolean;
  }>(sql`
    select p.id as person_id, p.display_name_ar, p.display_name_en, p.status as person_status,
           m.id as membership_id, m.status as membership_status,
           coalesce(m.user_id = private.request_user_id(), false) as is_self,
           private.actor_may_manage_person(p.tenant_id, p.id) as may_manage,
           coalesce(private.membership_is_privileged(m.tenant_id, m.id), false) as privileged,
           coalesce(m.status = 'active'
             and exists (select 1 from platform.role_assignments ra
                         where ra.membership_id = m.id and ra.role_code = 'tenant_admin')
             and not exists (
               select 1 from platform.role_assignments ra
               join platform.tenant_memberships o on o.tenant_id = ra.tenant_id and o.id = ra.membership_id
               where o.id <> m.id and o.status = 'active' and ra.role_code = 'tenant_admin'
                 and (ra.valid_from is null or ra.valid_from <= now()) and ra.valid_until is null),
             false) as last_admin
    from platform.persons p
    left join platform.tenant_memberships m on m.tenant_id = p.tenant_id and m.person_id = p.id
    where p.id = ${personId}::uuid`);
  if (!row) return null;
  return {
    personId: row.person_id,
    displayNameAr: row.display_name_ar,
    displayNameEn: row.display_name_en,
    personStatus: row.person_status,
    membershipId: row.membership_id,
    membershipStatus: row.membership_status,
    isSelf: row.is_self,
    mayManage: row.may_manage,
    privileged: row.privileged,
    lastAdmin: row.last_admin,
  };
}

/**
 * Serialises the deactivation with every change of direct managers, department heads, roles and
 * memberships of the organization, in the global lock order (person_employment, then role_assignments;
 * migration 20261011090000). Call before reading what the person is responsible for.
 */
export async function lockMemberLifecycle(tx: UserTx): Promise<void> {
  await tx.execute(sql`select private.lock_person_employment(private.current_tenant_id())`);
  await tx.execute(sql`select private.lock_tenant_roles(private.current_tenant_id())`);
}

/** Something the person is responsible for (a direct report, a department they head). */
export interface ResponsibilityItem {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** The signed-in member may move this item (e.g. a privileged report: Organization Admin only). */
  readonly movable: boolean;
}

export type ReassignRefusal =
  /** The database refused the actor for an item (e.g. an HR Manager and a privileged report). */
  | 'not_allowed'
  /** The new owner is not an active person of the organization, or is the person themselves. */
  | 'owner_invalid'
  /** The new owner reports (directly or not) to someone they would now manage: a loop. */
  | 'owner_reports_to_person';

export type ReassignOutcome =
  | { readonly ok: true; readonly moved: readonly string[] }
  | { readonly ok: false; readonly refusal: ReassignRefusal };

/** Maps the database refusals of a reassignment; rethrows anything else. */
export function reassignRefusalOf(error: unknown): ReassignRefusal {
  const pg = pgError(error);
  if (pg?.code === '42501') return 'not_allowed';
  if (pg?.code === '23514' && pg.message.includes('manager chain'))
    return 'owner_reports_to_person';
  if (pg?.code === '23514' || pg?.code === '23503') return 'owner_invalid';
  throw error;
}

/** The person's ACTIVE direct reports (inactive ones keep their last manager as history). */
export async function listDirectReports(
  tx: UserTx,
  personId: string,
): Promise<readonly ResponsibilityItem[]> {
  const rows = await tx.execute<{
    id: string;
    name_ar: string;
    name_en: string | null;
    movable: boolean;
  }>(sql`
    select p.id, p.display_name_ar as name_ar, p.display_name_en as name_en,
           private.actor_may_manage_person(p.tenant_id, p.id) as movable
    from platform.person_employment e
    join platform.persons p on p.tenant_id = e.tenant_id and p.id = e.person_id
    where e.manager_person_id = ${personId}::uuid and p.status = 'active'
    order by p.display_name_ar, p.id`);
  return rows.map((r) => ({ id: r.id, nameAr: r.name_ar, nameEn: r.name_en, movable: r.movable }));
}

/**
 * Moves the person's active direct reports to `toPersonId`. When the new manager is one of those reports,
 * they take over the team and report to the person's own manager instead (when active), else to nobody.
 * One row at a time, so the manager-chain check sees each move. A refusal leaves the transaction aborted.
 */
export async function reassignDirectReports(
  tx: UserTx,
  fromPersonId: string,
  toPersonId: string,
): Promise<ReassignOutcome> {
  if (fromPersonId === toPersonId) return { ok: false, refusal: 'owner_invalid' };
  const reports = await listDirectReports(tx, fromPersonId);
  const moved: string[] = [];
  try {
    if (reports.some((r) => r.id === toPersonId)) {
      await tx.execute(sql`
        update platform.person_employment e
        set manager_person_id = (
          select x.manager_person_id
          from platform.person_employment x
          join platform.persons up on up.tenant_id = x.tenant_id and up.id = x.manager_person_id
          where x.person_id = ${fromPersonId}::uuid and up.status = 'active'
            and x.manager_person_id <> ${toPersonId}::uuid)
        where e.person_id = ${toPersonId}::uuid and e.manager_person_id = ${fromPersonId}::uuid`);
      moved.push(toPersonId);
    }
    for (const report of reports) {
      if (report.id === toPersonId) continue;
      await tx.execute(sql`
        update platform.person_employment set manager_person_id = ${toPersonId}::uuid
        where person_id = ${report.id}::uuid and manager_person_id = ${fromPersonId}::uuid`);
      moved.push(report.id);
    }
  } catch (error) {
    return { ok: false, refusal: reassignRefusalOf(error) };
  }
  return { ok: true, moved };
}

/** The live departments the person heads. */
export async function listHeadedDepartments(
  tx: UserTx,
  personId: string,
): Promise<readonly ResponsibilityItem[]> {
  const rows = await tx.execute<{ id: string; name_ar: string; name_en: string | null }>(sql`
    select d.id, d.name_ar, d.name_en from platform.departments d
    where d.head_person_id = ${personId}::uuid and d.deleted_at is null
    order by d.name_ar, d.id`);
  return rows.map((r) => ({ id: r.id, nameAr: r.name_ar, nameEn: r.name_en, movable: true }));
}

/** Makes `toPersonId` the head of every live department the person heads. */
export async function reassignHeadedDepartments(
  tx: UserTx,
  fromPersonId: string,
  toPersonId: string,
): Promise<ReassignOutcome> {
  if (fromPersonId === toPersonId) return { ok: false, refusal: 'owner_invalid' };
  try {
    const rows = await tx.execute<{ id: string }>(sql`
      update platform.departments set head_person_id = ${toPersonId}::uuid
      where head_person_id = ${fromPersonId}::uuid and deleted_at is null
      returning id`);
    return { ok: true, moved: rows.map((r) => r.id) };
  } catch (error) {
    return { ok: false, refusal: reassignRefusalOf(error) };
  }
}

/** Someone who can take over the person's responsibilities. */
export interface ReplacementCandidate {
  readonly personId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
}

/**
 * Who can take over: the organization's active members with a managing role in force (Department Head,
 * Line Manager) and the heads of departments — the people the direct-manager picker offers (T-M2-13) —
 * without the person being deactivated.
 */
export async function listReplacementCandidates(
  tx: UserTx,
  personId: string,
): Promise<readonly ReplacementCandidate[]> {
  const managers = await listManagerOptions(tx);
  return managers
    .filter((m) => m.active && m.personId !== personId)
    .map((m) => ({ personId: m.personId, nameAr: m.nameAr, nameEn: m.nameEn }));
}

/** Revokes the person's pending invitations of this organization (each emits `invitation.revoked`). */
export async function revokePendingInvitationsOf(
  tx: UserTx,
  personId: string,
): Promise<readonly string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select i.id from platform.invitations i
    where i.person_id = ${personId}::uuid and i.status = 'pending'
    order by i.created_at, i.id`);
  const revoked: string[] = [];
  for (const row of rows) {
    if (await revokeInvitation(tx, row.id)) revoked.push(row.id);
  }
  return revoked;
}

export type DeactivationRefusal = 'not_allowed' | 'last_admin' | 'not_active' | 'step_up_required';

/**
 * The person becomes inactive and the membership `suspended`, then `user.deactivated` is emitted. A
 * refusal (the guards: not this actor, the last Organization Admin, a privileged member without an
 * authenticator code; or the membership is no longer active) leaves the transaction aborted or
 * unchanged; the caller rolls back.
 */
export async function deactivateMembership(
  tx: UserTx,
  target: { readonly personId: string; readonly membershipId: string },
): Promise<{ readonly ok: true } | { readonly ok: false; readonly refusal: DeactivationRefusal }> {
  try {
    await tx.execute(sql`
      update platform.persons set status = 'inactive'
      where id = ${target.personId}::uuid and status = 'active'`);
    const rows = await tx.execute(sql`
      update platform.tenant_memberships set status = 'suspended'
      where id = ${target.membershipId}::uuid and person_id = ${target.personId}::uuid and status = 'active'
      returning id`);
    if (rows.length === 0) return { ok: false, refusal: 'not_active' };
  } catch (error) {
    const pg = pgError(error);
    if (pg?.code === '42501') return { ok: false, refusal: 'not_allowed' };
    // private.check_privileged_deactivation (review M4): a privileged member needs AAL2.
    if (pg?.code === 'JM003') return { ok: false, refusal: 'step_up_required' };
    if (pg?.code === '23514' && pg.message.includes('at least one active Organization Admin')) {
      return { ok: false, refusal: 'last_admin' };
    }
    throw error;
  }
  await emitEvent(tx, {
    type: MEMBER_EVENTS.deactivated,
    subject: target.personId,
    data: { membershipId: target.membershipId },
  });
  return { ok: true };
}

export type ReactivationRefusal =
  | 'not_found'
  | 'not_deactivated'
  | 'not_allowed'
  | 'step_up_required'
  /** The person's last placement is a since-deleted department or branch: move them first. */
  | 'placement_deleted';

/** SQLSTATEs of private.reactivate_membership (migration 20261011090000). */
const REACTIVATION_ERRORS: Readonly<Record<string, ReactivationRefusal>> = {
  JM001: 'not_found',
  JM002: 'not_deactivated',
  JM003: 'step_up_required',
  JM004: 'not_allowed',
  '42501': 'not_allowed',
};

/**
 * The person becomes active again (under the person write guard; a placement in a deleted unit is
 * refused), then the membership through the checked database function, then `user.reactivated` is
 * emitted. The roles are those the member held before (screen 4 changes none).
 */
export async function reactivateMembership(
  tx: UserTx,
  personId: string,
): Promise<
  | { readonly ok: true; readonly membershipId: string }
  | { readonly ok: false; readonly refusal: ReactivationRefusal }
> {
  let membershipId: string | undefined;
  try {
    await tx.execute(sql`
      update platform.persons set status = 'active' where id = ${personId}::uuid and status = 'inactive'`);
    const [row] = await tx.execute<{ membership_id: string }>(
      sql`select private.reactivate_membership(${personId}::uuid) as membership_id`,
    );
    membershipId = row?.membership_id;
  } catch (error) {
    const pg = pgError(error);
    if (pg?.code === '23514' && pg.message.includes('deleted department or branch')) {
      return { ok: false, refusal: 'placement_deleted' };
    }
    const refusal = pg?.code ? REACTIVATION_ERRORS[pg.code] : undefined;
    if (refusal) return { ok: false, refusal };
    throw error;
  }
  if (!membershipId) throw new Error('reactivateMembership: no membership returned');
  await emitEvent(tx, {
    type: MEMBER_EVENTS.reactivated,
    subject: personId,
    data: { membershipId },
  });
  return { ok: true, membershipId };
}
