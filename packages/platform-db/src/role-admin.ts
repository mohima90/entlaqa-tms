import 'server-only';
import { type SQL, sql } from 'drizzle-orm';
import { ORG_TIME_ZONE } from './org-time-zone';
import { pgError } from './user-admin';
import type { UserTx } from './with-user-tx';

/**
 * Changing a member's roles from their profile (T-M2-14, FR-IAM-07, BR-IAM-1, BR-IAM-3). The caller
 * holds `platform.role.assign` (ordinary roles) or `platform.role.assign_privileged` (AAL2) for the
 * person; the database guard (private.check_role_assignment_actor, last-admin triggers) has the final
 * word. Validity dates are calendar days in the organization's time zone (its headquarters branch,
 * else Asia/Riyadh): a role starts at the beginning of its first day and ends after its last day.
 */
export interface AssignedRole {
  readonly roleCode: string;
  readonly isPrimary: boolean;
  /** First day (YYYY-MM-DD) or null = already in force. */
  readonly validFrom: string | null;
  /** Last day, inclusive (YYYY-MM-DD) or null = no end. */
  readonly validUntil: string | null;
}

export interface EditableRoles {
  readonly personId: string;
  /** Null when the person has no sign-in account here (roles come with the invitation). */
  readonly membershipId: string | null;
  readonly membershipStatus: 'invited' | 'active' | 'suspended' | 'revoked' | null;
  /** The signed-in member's own membership: nobody changes their own roles. */
  readonly isSelf: boolean;
  /** Same rule as the database guard (private.actor_may_manage_person). */
  readonly mayManage: boolean;
  readonly roles: readonly AssignedRole[];
  /** Optimistic concurrency: every assignment with its row version. */
  readonly version: string;
  readonly timeZone: string;
  /** Today in that time zone (YYYY-MM-DD): roles that ended or have not started yet. */
  readonly today: string;
}

export async function getEditableRoles(
  tx: UserTx,
  personId: string,
): Promise<EditableRoles | null> {
  const [person] = await tx.execute<{
    id: string;
    membership_id: string | null;
    status: EditableRoles['membershipStatus'];
    is_self: boolean;
    may_manage: boolean;
    time_zone: string;
    today: string;
  }>(sql`
    select p.id, m.id as membership_id, m.status,
           coalesce(m.user_id = private.request_user_id(), false) as is_self,
           private.actor_may_manage_person(p.tenant_id, p.id) as may_manage,
           ${ORG_TIME_ZONE} as time_zone,
           (now() at time zone ${ORG_TIME_ZONE})::date::text as today
    from platform.persons p
    left join platform.tenant_memberships m on m.tenant_id = p.tenant_id and m.person_id = p.id
    where p.id = ${personId}::uuid`);
  if (!person) return null;
  const rows =
    person.membership_id === null
      ? []
      : await tx.execute<{
          role_code: string;
          is_primary: boolean;
          valid_from: string | null;
          valid_until: string | null;
          id: string;
          version: number;
        }>(sql`
          select ra.id, ra.role_code, ra.is_primary, ra.version,
                 (ra.valid_from at time zone ${person.time_zone})::date::text as valid_from,
                 ((ra.valid_until - interval '1 microsecond') at time zone ${person.time_zone})::date::text
                   as valid_until
          from platform.role_assignments ra
          where ra.membership_id = ${person.membership_id}::uuid
          order by ra.is_primary desc, ra.role_code`);
  return {
    personId: person.id,
    membershipId: person.membership_id,
    membershipStatus: person.status,
    isSelf: person.is_self,
    mayManage: person.may_manage,
    roles: rows.map((r) => ({
      roleCode: r.role_code,
      isPrimary: r.is_primary,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
    })),
    version: [...rows]
      .sort((a, b) => a.role_code.localeCompare(b.role_code))
      // The row id too: a role removed and given again starts at version 1 again.
      .map((r) => `${r.role_code}:${r.id}:${String(r.version)}`)
      .join(','),
    timeZone: person.time_zone,
    today: person.today,
  };
}

/** Why a change was refused. */
export type RolesRefusal =
  | 'not_found'
  | 'no_account'
  | 'own_roles'
  | 'not_allowed'
  | 'version_conflict'
  | 'last_admin'
  | 'membership_revoked'
  | 'dates_invalid'
  | 'privileged_change';

export type RolesOutcome =
  | {
      readonly ok: true;
      readonly before: readonly AssignedRole[];
      readonly after: readonly AssignedRole[];
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly refusal: RolesRefusal };

/** Maps database refusals of a role change to reasons; rethrows anything else. */
export function rolesRefusalOf(error: unknown): RolesRefusal {
  const pg = pgError(error);
  if (pg?.code === '42501') return 'not_allowed';
  if (pg?.code === '23514' && pg.message.includes('at least one active Organization Admin')) {
    return 'last_admin';
  }
  if (pg?.code === '23514' && pg.message.includes('revoked membership'))
    return 'membership_revoked';
  if (pg?.code === '23514' && pg.constraint === 'role_assignments_validity_check') {
    return 'dates_invalid';
  }
  // A concurrent change took the primary slot or the same role first.
  if (pg?.code === '23505') return 'version_conflict';
  throw error;
}

const same = (a: AssignedRole, b: AssignedRole) =>
  a.isPrimary === b.isPrimary && a.validFrom === b.validFrom && a.validUntil === b.validUntil;

/** Does going from `before` to `after` give, remove or change one of `codes` (primary flag or days)? */
export function touchesRoles(
  before: readonly AssignedRole[],
  after: readonly AssignedRole[],
  codes: ReadonlySet<string>,
): boolean {
  const was = new Map(before.map((r) => [r.roleCode, r]));
  const will = new Map(after.map((r) => [r.roleCode, r]));
  return [...new Set([...was.keys(), ...will.keys()])].some((code) => {
    if (!codes.has(code)) return false;
    const a = was.get(code);
    const b = will.get(code);
    return a === undefined || b === undefined || !same(a, b);
  });
}

/**
 * The primary role has no day fields in the form: a primary role that stays primary keeps the days it
 * has (a primary that ended stays ended), so a save never changes them silently.
 */
export function keepPrimaryDays(
  before: readonly AssignedRole[],
  desired: readonly AssignedRole[],
): AssignedRole[] {
  const primary = before.find((r) => r.isPrimary);
  return desired.map((r) =>
    r.isPrimary && primary?.roleCode === r.roleCode && r.validFrom === null && r.validUntil === null
      ? { ...r, validFrom: primary.validFrom, validUntil: primary.validUntil }
      : r,
  );
}

export interface ReplaceRolesOptions {
  /**
   * Roles this call may not give, remove or change (privileged roles on the ordinary path). Checked
   * after the lock, against the stored roles: refused as `privileged_change`.
   */
  readonly lockedCodes?: ReadonlySet<string>;
}

/**
 * Replaces the member's roles with `desired` in the caller's transaction (only the differences are
 * written). Returns the roles before and after for the audit event (role codes and dates are not
 * personal data), or why the database refused — the transaction is then aborted and must be ended by
 * the caller (defineAction rolls back on an error result).
 */
export async function replaceMemberRoles(
  tx: UserTx,
  personId: string,
  expectedVersion: string,
  requested: readonly AssignedRole[],
  options: ReplaceRolesOptions = {},
): Promise<RolesOutcome> {
  // Serialise with every other role change of the organization before reading (READ COMMITTED).
  await tx.execute(sql`select private.lock_tenant_roles(private.current_tenant_id())`);
  const before = await getEditableRoles(tx, personId);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.membershipId === null) return { ok: false, refusal: 'no_account' };
  if (before.isSelf) return { ok: false, refusal: 'own_roles' };
  if (!before.mayManage) return { ok: false, refusal: 'not_allowed' };
  if (before.membershipStatus === 'revoked') return { ok: false, refusal: 'membership_revoked' };
  if (before.version !== expectedVersion) return { ok: false, refusal: 'version_conflict' };
  const desired = keepPrimaryDays(before.roles, requested);
  if (options.lockedCodes && touchesRoles(before.roles, desired, options.lockedCodes)) {
    return { ok: false, refusal: 'privileged_change' };
  }

  const current = new Map(before.roles.map((r) => [r.roleCode, r]));
  const wanted = new Map(desired.map((r) => [r.roleCode, r]));
  const removed = before.roles.filter((r) => !wanted.has(r.roleCode));
  const added = desired.filter((r) => !current.has(r.roleCode));
  const updated = desired.filter((r) => {
    const old = current.get(r.roleCode);
    return old !== undefined && !same(old, r);
  });
  if (removed.length + added.length + updated.length === 0) {
    return { ok: true, before: before.roles, after: before.roles, changed: false };
  }

  const tz = before.timeZone;
  const from = (day: string | null): SQL =>
    day === null ? sql`null` : sql`(${day}::date::timestamp at time zone ${tz})`;
  const until = (day: string | null): SQL =>
    day === null ? sql`null` : sql`((${day}::date + 1)::timestamp at time zone ${tz})`;
  const membership = before.membershipId;
  // The primary slot is unique: rows giving it up are written before the row taking it.
  const order = (r: AssignedRole) => (r.isPrimary ? 1 : 0);
  try {
    for (const r of removed) {
      await tx.execute(sql`delete from platform.role_assignments
        where membership_id = ${membership}::uuid and role_code = ${r.roleCode}`);
    }
    for (const r of [...updated].sort((a, b) => order(a) - order(b))) {
      await tx.execute(sql`update platform.role_assignments
        set is_primary = ${r.isPrimary}, valid_from = ${from(r.validFrom)},
            valid_until = ${until(r.validUntil)}
        where membership_id = ${membership}::uuid and role_code = ${r.roleCode}`);
    }
    for (const r of [...added].sort((a, b) => order(a) - order(b))) {
      await tx.execute(sql`insert into platform.role_assignments
          (membership_id, role_code, is_primary, valid_from, valid_until)
        values (${membership}::uuid, ${r.roleCode}, ${r.isPrimary}, ${from(r.validFrom)},
                ${until(r.validUntil)})`);
    }
  } catch (error) {
    return { ok: false, refusal: rolesRefusalOf(error) };
  }
  const after = await getEditableRoles(tx, personId);
  return { ok: true, before: before.roles, after: after?.roles ?? desired, changed: true };
}
