import 'server-only';
import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/** One role held by the signed-in member (platform.role_assignments, T-M2-03). */
export interface MemberRole {
  readonly roleCode: string;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
}

/** A custom role the member holds, as stored now (EP-ROLES): its data scope and permission codes. */
export interface MemberCustomRole {
  readonly code: string;
  readonly dataScope: 'own' | 'team' | 'departments' | 'organization';
  readonly permissions: readonly string[];
}

/** What the grant loader needs about the signed-in member in the current organization. */
export interface MemberAuthorizationFacts {
  readonly roles: readonly MemberRole[];
  /** Departments the member heads (not deleted) — the `headed_departments` scope. */
  readonly headedDepartmentIds: readonly string[];
  /** The member's custom roles (read with the roles on every request, so changes apply at once). */
  readonly customRoles: readonly MemberCustomRole[];
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
/** Does platform.custom_roles exist yet (EP-ROLES expand-first deploy window)? */
export async function customRolesExist(tx: UserTx): Promise<boolean> {
  const [row] = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('platform.custom_roles') is not null as present`,
  );
  return row?.present === true;
}

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
  // While the app is deployed ahead of its database (custom roles not migrated yet — the deploys run in
  // parallel), there are no custom roles: read nothing rather than fail every request (review M3). A
  // catalog lookup, not a failing query: an error would abort the transaction.
  const custom = !(await customRolesExist(tx))
    ? []
    : await tx.execute<{
        code: string;
        data_scope: MemberCustomRole['dataScope'];
        permissions: string[] | null;
      }>(sql`
    select cr.code, cr.data_scope,
           array(select crp.permission_code from platform.custom_role_permissions crp
                 where crp.tenant_id = cr.tenant_id and crp.custom_role_id = cr.id
                 order by crp.permission_code) as permissions
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    join platform.custom_roles cr on cr.tenant_id = ra.tenant_id and cr.code = ra.role_code
    where m.user_id = (select private.request_user_id())
      and m.tenant_id = (select private.current_tenant_id())
      and m.status = 'active'
    order by cr.code`);
  return {
    roles: roles.map((r) => ({
      roleCode: r.role_code,
      validFrom: toDate(r.valid_from),
      validUntil: toDate(r.valid_until),
    })),
    headedDepartmentIds: departments.map((d) => d.id),
    customRoles: custom.map((c) => ({
      code: c.code,
      dataScope: c.data_scope,
      permissions: c.permissions ?? [],
    })),
  };
}

/** A role as the account menu names it: its code, and the names of a custom role. */
export interface MyRole {
  readonly code: string;
  /** Names of a custom role (null for a standard role: the code names it). */
  readonly customName: { readonly ar: string; readonly en: string } | null;
}

/**
 * The signed-in member's role in the current organization (the account menu's "Organization · Role",
 * T-M2-43; one role per person since EP-ROLES), or null. Display only — authorization uses the grants.
 * Same membership rule and RLS as `loadMemberAuthorizationFacts`.
 */
export async function getMyPrimaryRole(tx: UserTx): Promise<MyRole | null> {
  // The account menu on every page: no custom-role names before that migration (review M3).
  const names = (await customRolesExist(tx))
    ? sql`cr.name_ar, cr.name_en
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    left join platform.custom_roles cr on cr.tenant_id = ra.tenant_id and cr.code = ra.role_code`
    : sql`null::text as name_ar, null::text as name_en
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id`;
  const [row] = await tx.execute<{
    role_code: string;
    name_ar: string | null;
    name_en: string | null;
  }>(sql`
    select ra.role_code, ${names}
    where m.user_id = (select private.request_user_id())
      and m.tenant_id = (select private.current_tenant_id())
      and m.status = 'active'
    order by ra.is_primary desc, ra.role_code
    limit 1`);
  if (!row) return null;
  return {
    code: row.role_code,
    customName:
      row.name_ar !== null && row.name_en !== null ? { ar: row.name_ar, en: row.name_en } : null,
  };
}
