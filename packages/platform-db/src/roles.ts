import 'server-only';
import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/** One role held by the signed-in member (platform.role_assignments, T-M2-03). */
export interface MemberRole {
  readonly roleCode: string;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
}

/** What the grant loader needs about the signed-in member in the current organization. */
export interface MemberAuthorizationFacts {
  readonly roles: readonly MemberRole[];
  /** Departments the member heads (not deleted) — the `headed_departments` scope. */
  readonly headedDepartmentIds: readonly string[];
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Roles and headed departments of the member identified by the transaction's verified claims, in the
 * tenant the claims act in. Validity windows are returned as stored (authorize() applies them per
 * request). Only an ACTIVE membership counts; RLS restricts every read to the current tenant.
 */
export async function loadMemberAuthorizationFacts(tx: UserTx): Promise<MemberAuthorizationFacts> {
  const roles = await tx.execute<{
    role_code: string;
    valid_from: Date | string | null;
    valid_until: Date | string | null;
  }>(sql`
    select ra.role_code, ra.valid_from, ra.valid_until
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    where m.user_id = (select private.request_user_id())
      and m.tenant_id = (select private.current_tenant_id())
      and m.status = 'active'
    order by ra.role_code`);
  const departments = await tx.execute<{ id: string }>(sql`
    select d.id
    from platform.departments d
    join platform.tenant_memberships m on m.tenant_id = d.tenant_id and m.person_id = d.head_person_id
    where m.user_id = (select private.request_user_id())
      and m.tenant_id = (select private.current_tenant_id())
      and m.status = 'active'
      and d.deleted_at is null
    order by d.id`);
  return {
    roles: roles.map((r) => ({
      roleCode: r.role_code,
      validFrom: toDate(r.valid_from),
      validUntil: toDate(r.valid_until),
    })),
    headedDepartmentIds: departments.map((d) => d.id),
  };
}

/**
 * The signed-in member's primary role in the current organization (the account menu's "Organization ·
 * Role", T-M2-43), or null. Display only — authorization uses the grants. Same membership rule and RLS
 * as `loadMemberAuthorizationFacts`.
 */
export async function getMyPrimaryRole(tx: UserTx): Promise<string | null> {
  const [row] = await tx.execute<{ role_code: string }>(sql`
    select ra.role_code
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    where m.user_id = (select private.request_user_id())
      and m.tenant_id = (select private.current_tenant_id())
      and m.status = 'active'
    order by ra.is_primary desc, ra.role_code
    limit 1`);
  return row?.role_code ?? null;
}
