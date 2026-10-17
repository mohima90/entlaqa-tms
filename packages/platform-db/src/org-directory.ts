import 'server-only';
import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/**
 * The organization structure and its members as modules need them (platform service, ADR 0001: modules
 * never read platform tables themselves). First used by the planning cycle (EP-PLN, T-M3-04: the cycle's
 * scope, departments without a head, named approvers). Row-level security limits every row to the claims'
 * organization; callers authorize first (defineQuery / defineAction).
 */

/** A department (a unit of the structure at any level) with its head, if any. */
export interface OrgDepartment {
  readonly id: string;
  readonly parentId: string | null;
  readonly branchId: string | null;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
  /** The unit's own head (null: none — it then belongs to the nearest head above, EP-ORG). */
  readonly head: {
    readonly personId: string;
    readonly nameAr: string;
    readonly nameEn: string | null;
  } | null;
}

export interface OrgBranch {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly active: boolean;
}

export interface OrgStructure {
  readonly departments: readonly OrgDepartment[];
  readonly branches: readonly OrgBranch[];
}

/** Departments and branches that are not deleted (inactive ones flagged), heads with their names. */
export async function listOrgStructure(tx: UserTx): Promise<OrgStructure> {
  const departments = await tx.execute<{
    id: string;
    parent_id: string | null;
    branch_id: string | null;
    code: string;
    name_ar: string;
    name_en: string | null;
    status: string;
    sort_order: number | string;
    head_person_id: string | null;
    head_name_ar: string | null;
    head_name_en: string | null;
  }>(sql`
    select d.id, d.parent_id, d.branch_id, d.code, d.name_ar, d.name_en, d.status, d.sort_order,
           d.head_person_id, p.display_name_ar as head_name_ar, p.display_name_en as head_name_en
    from platform.departments d
    left join platform.persons p on p.tenant_id = d.tenant_id and p.id = d.head_person_id
    where d.deleted_at is null
    order by d.sort_order, d.name_ar, d.id`);
  const branches = await tx.execute<{
    id: string;
    name_ar: string;
    name_en: string | null;
    status: string;
  }>(sql`
    select id, name_ar, name_en, status from platform.branches
    where deleted_at is null order by is_headquarters desc, name_ar, id`);
  return {
    departments: departments.map((d) => ({
      id: d.id,
      parentId: d.parent_id,
      branchId: d.branch_id,
      code: d.code,
      nameAr: d.name_ar,
      nameEn: d.name_en,
      active: d.status === 'active',
      sortOrder: Number(d.sort_order),
      head:
        d.head_person_id && d.head_name_ar
          ? { personId: d.head_person_id, nameAr: d.head_name_ar, nameEn: d.head_name_en }
          : null,
    })),
    branches: branches.map((b) => ({
      id: b.id,
      nameAr: b.name_ar,
      nameEn: b.name_en,
      active: b.status === 'active',
    })),
  };
}

/** A person who can be picked for a task (e.g. a named approver): an active member, names only. */
export interface MemberOption {
  readonly personId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
}

/**
 * Active members of the organization (active membership and active person record), by Arabic name, plus
 * the persons in `include` whatever their state (e.g. an approver chosen earlier who has left since), so
 * a saved choice can still be shown. Names only: no e-mail or other contact data.
 */
export async function listMemberOptions(
  tx: UserTx,
  include: readonly string[] = [],
): Promise<readonly (MemberOption & { readonly active: boolean })[]> {
  const ids = include.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const rows = await tx.execute<{
    person_id: string;
    name_ar: string;
    name_en: string | null;
    active: boolean;
  }>(sql`
    select p.id as person_id, p.display_name_ar as name_ar, p.display_name_en as name_en,
           (p.status = 'active' and exists (select 1 from platform.tenant_memberships m
                                            where m.tenant_id = p.tenant_id and m.person_id = p.id
                                              and m.status = 'active')) as active
    from platform.persons p
    where (p.status = 'active' and exists (select 1 from platform.tenant_memberships m
                                           where m.tenant_id = p.tenant_id and m.person_id = p.id
                                             and m.status = 'active'))
       or p.id = any (${`{${ids.join(',')}}`}::uuid[])
    order by p.display_name_ar, p.id
    limit 2000`);
  return rows.map((r) => ({
    personId: r.person_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    active: r.active,
  }));
}
