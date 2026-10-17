import 'server-only';
import { sql } from 'drizzle-orm';
import { pgError } from './user-admin';
import type { UserTx } from './with-user-tx';

/**
 * Changing a member's role (T-M2-14, FR-IAM-07, BR-IAM-3; EP-ROLES: ONE role per person, Kawadir's
 * «تعديل الدور» dialog). The caller holds `platform.role.assign` (ordinary roles) or
 * `platform.role.assign_privileged` for the person; the database guard (private.check_role_assignment_actor,
 * last-admin triggers, one-role index) has the final word. The role is a standard role or a custom role of
 * the organization; a change replaces the row (remove, then give) in the caller's transaction.
 */
export interface EditableRole {
  readonly personId: string;
  /** Null when the person has no sign-in account here (the role comes with the invitation). */
  readonly membershipId: string | null;
  readonly membershipStatus: 'invited' | 'active' | 'suspended' | 'revoked' | null;
  /** The signed-in member's own membership: nobody changes their own role. */
  readonly isSelf: boolean;
  /** Same rule as the database guard (private.actor_may_manage_person). */
  readonly mayManage: boolean;
  /** The role held (in force or not), or null. */
  readonly roleCode: string | null;
  /** Optimistic concurrency: `role_code:row id:row version`, or '' without a role. */
  readonly version: string;
}

export async function getEditableRole(tx: UserTx, personId: string): Promise<EditableRole | null> {
  const [person] = await tx.execute<{
    id: string;
    membership_id: string | null;
    status: EditableRole['membershipStatus'];
    is_self: boolean;
    may_manage: boolean;
    role_code: string | null;
    row_id: string | null;
    row_version: number | null;
  }>(sql`
    select p.id, m.id as membership_id, m.status,
           coalesce(m.user_id = private.request_user_id(), false) as is_self,
           private.actor_may_manage_person(p.tenant_id, p.id) as may_manage,
           ra.role_code, ra.id as row_id, ra.version as row_version
    from platform.persons p
    left join platform.tenant_memberships m on m.tenant_id = p.tenant_id and m.person_id = p.id
    left join platform.role_assignments ra on ra.tenant_id = m.tenant_id and ra.membership_id = m.id
    where p.id = ${personId}::uuid`);
  if (!person) return null;
  return {
    personId: person.id,
    membershipId: person.membership_id,
    membershipStatus: person.status,
    isSelf: person.is_self,
    mayManage: person.may_manage,
    roleCode: person.role_code,
    version:
      person.role_code === null
        ? ''
        : `${person.role_code}:${person.row_id ?? ''}:${String(person.row_version ?? 0)}`,
  };
}

/** Why a change was refused. */
export type RoleRefusal =
  | 'not_found'
  | 'no_account'
  | 'own_role'
  | 'not_allowed'
  | 'version_conflict'
  | 'last_admin'
  | 'membership_revoked'
  | 'privileged_change'
  | 'unknown_role';

export type RoleOutcome =
  | {
      readonly ok: true;
      readonly before: string | null;
      readonly after: string;
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly refusal: RoleRefusal };

/** Maps database refusals of a role change to reasons; rethrows anything else. */
export function roleRefusalOf(error: unknown): RoleRefusal {
  const pg = pgError(error);
  if (pg?.code === '42501') return 'not_allowed';
  if (pg?.code === '23514' && pg.message.includes('at least one active Organization Admin')) {
    return 'last_admin';
  }
  if (pg?.code === '23514' && pg.message.includes('revoked membership'))
    return 'membership_revoked';
  // An unknown standard role or a custom role deleted meanwhile (generated foreign keys).
  if (pg?.code === '23503') return 'unknown_role';
  // A concurrent change gave the member a role first (one role per person), or JR001 for the Organization
  // Admin (unreachable: the row is replaced).
  if (pg?.code === '23505' || pg?.code === 'JR001') return 'version_conflict';
  throw error;
}

export interface ReplaceRoleOptions {
  /**
   * Is this role privileged (ordinary path: neither the old nor the new role may be)? Checked after the
   * lock, against the stored role: refused as `privileged_change`.
   */
  readonly isLocked?: (roleCode: string) => boolean;
}

/**
 * Gives the member `roleCode` in place of their current role, when the stored role is still
 * `expectedVersion`. Returns the role before and after for the audit event (role codes are not personal
 * data), or why the database refused — the transaction is then aborted and must be ended by the caller
 * (defineAction rolls back on an error result).
 */
export async function replaceMemberRole(
  tx: UserTx,
  personId: string,
  expectedVersion: string,
  roleCode: string,
  options: ReplaceRoleOptions = {},
): Promise<RoleOutcome> {
  // Serialise with every other role change of the organization before reading (READ COMMITTED).
  await tx.execute(sql`select private.lock_tenant_roles(private.current_tenant_id())`);
  const before = await getEditableRole(tx, personId);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.membershipId === null) return { ok: false, refusal: 'no_account' };
  if (before.isSelf) return { ok: false, refusal: 'own_role' };
  if (!before.mayManage) return { ok: false, refusal: 'not_allowed' };
  if (before.membershipStatus === 'revoked') return { ok: false, refusal: 'membership_revoked' };
  if (before.version !== expectedVersion) return { ok: false, refusal: 'version_conflict' };
  if (before.roleCode === roleCode) {
    return { ok: true, before: before.roleCode, after: roleCode, changed: false };
  }
  const locked = options.isLocked;
  if (locked && (locked(roleCode) || (before.roleCode !== null && locked(before.roleCode)))) {
    return { ok: false, refusal: 'privileged_change' };
  }
  try {
    await tx.execute(sql`delete from platform.role_assignments
      where membership_id = ${before.membershipId}::uuid`);
    await tx.execute(sql`insert into platform.role_assignments (membership_id, role_code, is_primary)
      values (${before.membershipId}::uuid, ${roleCode}, true)`);
  } catch (error) {
    return { ok: false, refusal: roleRefusalOf(error) };
  }
  return { ok: true, before: before.roleCode, after: roleCode, changed: true };
}
