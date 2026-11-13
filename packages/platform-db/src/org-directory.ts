import 'server-only';
import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';
import { levelOrdinalOf } from './level-ordinal';

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
  /** One of the two names may be missing, never both (migration 20261113100000). */
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
  /** Its level (ordinal; tables name it when levels mix, guided-test feedback #3). */
  readonly levelOrdinal: number | null;
  /** The unit's own head (null: none — it then belongs to the nearest head above, EP-ORG). */
  readonly head: {
    readonly personId: string;
    readonly nameAr: string | null;
    readonly nameEn: string | null;
  } | null;
}

export interface OrgBranch {
  readonly id: string;
  readonly nameAr: string | null;
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
    name_ar: string | null;
    name_en: string | null;
    status: string;
    sort_order: number | string;
    level_ordinal: number | null;
    head_person_id: string | null;
    head_name_ar: string | null;
    head_name_en: string | null;
  }>(sql`
    select d.id, d.parent_id, d.branch_id, d.code, d.name_ar, d.name_en, d.status, d.sort_order,
           d.level_ordinal, d.head_person_id, p.display_name_ar as head_name_ar, p.display_name_en as head_name_en
    from platform.departments d
    left join platform.persons p on p.tenant_id = d.tenant_id and p.id = d.head_person_id
    where d.deleted_at is null
    order by d.sort_order, coalesce(d.name_ar, d.name_en), d.id`);
  const branches = await tx.execute<{
    id: string;
    name_ar: string | null;
    name_en: string | null;
    status: string;
  }>(sql`
    select id, name_ar, name_en, status from platform.branches
    where deleted_at is null order by is_headquarters desc, coalesce(name_ar, name_en), id`);
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
      levelOrdinal: levelOrdinalOf(d.level_ordinal),
      head: d.head_person_id
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

/** A person named by a task (e.g. a candidate of a training need): names only. */
export interface MemberOption {
  readonly personId: string;
  /** Null for a person with an English name only (PO 17 Oct 2026). */
  readonly nameAr: string | null;
  readonly nameEn: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The persons with these ids (malformed ids are ignored), whatever their state, with whether each is an
 * active member now (active membership and active person record). No cap: for checking and naming the
 * people a task already names (a capped list of every member would make a valid person "unknown" in a
 * large organization — code review C-M3). Names only: no e-mail or other contact data.
 */
export async function getMemberOptionsByIds(
  tx: UserTx,
  ids: readonly string[],
): Promise<readonly (MemberOption & { readonly active: boolean })[]> {
  const valid = [...new Set(ids.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase()))];
  if (valid.length === 0) return [];
  const rows = await tx.execute<{
    person_id: string;
    name_ar: string | null;
    name_en: string | null;
    active: boolean;
  }>(sql`
    select p.id as person_id, p.display_name_ar as name_ar, p.display_name_en as name_en,
           (p.status = 'active' and exists (select 1 from platform.tenant_memberships m
                                            where m.tenant_id = p.tenant_id and m.person_id = p.id
                                              and m.status = 'active')) as active
    from platform.persons p
    where p.id = any (${`{${valid.join(',')}}`}::uuid[])
    order by coalesce(p.display_name_ar, p.display_name_en), p.id`);
  return rows.map((r) => ({
    personId: r.person_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    active: r.active,
  }));
}

/** The team of a department as a needs page names it: active members employed in the unit or any unit under it. */
export const TEAM_LIMIT = 2000;

/**
 * The people a Department Head may name for a training need (WP-LD-01, Q1: candidates are optional): active
 * members whose employment is in `departmentId` or a unit under it, by name, at most TEAM_LIMIT. Names only.
 * Row-level security on persons still applies (the head reads the people of the departments they head).
 */
export async function listDepartmentTeam(
  tx: UserTx,
  departmentId: string,
): Promise<readonly MemberOption[]> {
  if (!UUID_RE.test(departmentId)) return [];
  const rows = await tx.execute<{
    person_id: string;
    name_ar: string | null;
    name_en: string | null;
  }>(sql`
    with recursive tree (id) as (
      select d.id from platform.departments d where d.id = ${departmentId}::uuid and d.deleted_at is null
      union
      select c.id from platform.departments c join tree t on c.parent_id = t.id where c.deleted_at is null
    )
    select p.id as person_id, p.display_name_ar as name_ar, p.display_name_en as name_en
    from platform.persons p
    join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
    where p.status = 'active'
      and e.department_id in (select id from tree)
      and (e.end_on is null or e.end_on >= current_date)
      and exists (select 1 from platform.tenant_memberships m
                  where m.tenant_id = p.tenant_id and m.person_id = p.id and m.status = 'active')
    order by coalesce(p.display_name_ar, p.display_name_en), p.id
    limit ${TEAM_LIMIT}`);
  return rows.map((r) => ({ personId: r.person_id, nameAr: r.name_ar, nameEn: r.name_en }));
}
