import 'server-only';
import { EMPTY_PERSON_SCOPE, type PersonScope, isEmptyPersonScope } from '@jadarat/platform-core';
import { type SQL, sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/**
 * People directory reads for the users screens (T-M2-04, FR-IAM-01; screens 1 and 3 of
 * docs/design/screens/m2-users-roles/). Authorization happens before these run (defineQuery); lists
 * are additionally restricted to the caller's PersonScope (ADR 0003 §4.2). RLS limits every read to the
 * current organization.
 */

/** Tabs of the users list: membership statuses shown to admins. Revoked memberships are not listed. */
export type UserListTab = 'all' | 'active' | 'invited' | 'deactivated';

export interface UserListFilter {
  readonly scope: PersonScope;
  /** The signed-in member's person (for `self`, `directReports`, `reportsTree`). */
  readonly actorPersonId: string | null;
  readonly tab: UserListTab;
  /** Free text: name (Arabic or English), e-mail or employee number. */
  readonly search?: string;
  /**
   * The people whose roles the caller may read (`platform.role.read`): roles are returned, and the role
   * filter matches, only for rows inside it. EMPTY_PERSON_SCOPE → no roles at all.
   */
  readonly rolesScope: PersonScope;
  readonly roleCode?: string;
  /** A department and its sub-departments. */
  readonly departmentId?: string;
  readonly branchId?: string;
  /** Page size, clamped to 1…MAX_PAGE_SIZE. */
  readonly limit: number;
  readonly offset: number;
}

export const MAX_PAGE_SIZE = 100;

export type MembershipStatus = 'active' | 'invited' | 'suspended';

export interface UserListRow {
  readonly personId: string;
  readonly membershipId: string;
  readonly displayNameAr: string;
  readonly displayNameEn: string | null;
  readonly email: string | null;
  readonly employeeNumber: string | null;
  readonly status: MembershipStatus;
  readonly primaryRole: string | null;
  readonly otherRoles: readonly string[];
  readonly departmentNameAr: string | null;
  readonly departmentNameEn: string | null;
  readonly lastSignInAt: Date | null;
}

export interface UserListCounts {
  readonly all: number;
  readonly active: number;
  readonly invited: number;
  readonly deactivated: number;
}

export interface UserList {
  readonly rows: readonly UserListRow[];
  readonly counts: UserListCounts;
  /** Rows matching the current tab (for pagination). */
  readonly total: number;
}

const TAB_STATUS: Record<Exclude<UserListTab, 'all'>, MembershipStatus> = {
  active: 'active',
  invited: 'invited',
  deactivated: 'suspended',
};

function uuidList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/**
 * SQL predicate over `p` (platform.persons) and `e` (platform.person_employment, left-joined) that is
 * true for the people `scope` covers. An empty scope covers nobody.
 */
export function personScopePredicate(scope: PersonScope, actorPersonId: string | null): SQL {
  if (scope.all) return sql`true`;
  if (isEmptyPersonScope(scope)) return sql`false`;
  const parts: SQL[] = [];
  if (actorPersonId !== null) {
    if (scope.self) parts.push(sql`p.id = ${actorPersonId}::uuid`);
    if (scope.directReports) parts.push(sql`e.manager_person_id = ${actorPersonId}::uuid`);
    if (scope.reportsTree) {
      parts.push(sql`p.id in (
        with recursive reports (person_id, depth) as (
          select r.person_id, 1 from platform.person_employment r
          where r.manager_person_id = ${actorPersonId}::uuid
          union all
          select r.person_id, x.depth + 1 from reports x
          join platform.person_employment r on r.manager_person_id = x.person_id
          where x.depth < 60
        )
        select person_id from reports)`);
    }
  }
  for (const departments of scope.departments) {
    if (departments.ids.length === 0) continue;
    parts.push(
      departments.includeDescendants
        ? sql`e.department_id in (
            with recursive tree (id) as (
              select d.id from platform.departments d where d.id in (${uuidList(departments.ids)})
              union
              select c.id from platform.departments c join tree t on c.parent_id = t.id
            )
            select id from tree)`
        : sql`e.department_id in (${uuidList(departments.ids)})`,
    );
  }
  if (scope.branchIds.length > 0) parts.push(sql`e.branch_id in (${uuidList(scope.branchIds)})`);
  return parts.length > 0 ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;
}

/** `like` pattern for user text: % _ and \ are matched literally (\ is PostgreSQL's default escape). */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Role assignments in force now (same window as authorize(): valid_from ≤ now < valid_until). */
const ROLE_IN_FORCE = sql`(ra.valid_from is null or ra.valid_from <= now())
  and (ra.valid_until is null or ra.valid_until > now())`;

function filterPredicate(filter: UserListFilter): SQL {
  const parts: SQL[] = [
    sql`m.status in ('active', 'invited', 'suspended')`,
    personScopePredicate(filter.scope, filter.actorPersonId),
  ];
  const search = filter.search?.trim();
  if (search) {
    const pattern = containsPattern(search);
    // Names: Arabic letter variants, diacritics and case ignored (private.search_key).
    parts.push(sql`(private.search_key(p.display_name_ar) like private.search_key(${pattern})
      or private.search_key(p.display_name_en) like private.search_key(${pattern})
      or p.email ilike ${pattern} or p.employee_number ilike ${pattern})`);
  }
  if (filter.roleCode) {
    parts.push(sql`${personScopePredicate(filter.rolesScope, filter.actorPersonId)}`);
    parts.push(sql`exists (select 1 from platform.role_assignments ra
      where ra.membership_id = m.id and ra.role_code = ${filter.roleCode} and ${ROLE_IN_FORCE})`);
  }
  if (filter.departmentId) {
    parts.push(
      personScopePredicate(
        {
          ...EMPTY_PERSON_SCOPE,
          departments: [{ ids: [filter.departmentId], includeDescendants: true }],
        },
        null,
      ),
    );
  }
  if (filter.branchId) parts.push(sql`e.branch_id = ${filter.branchId}::uuid`);
  return sql.join(parts, sql` and `);
}

const FROM_MEMBERS = sql`
  from platform.tenant_memberships m
  join platform.persons p on p.tenant_id = m.tenant_id and p.id = m.person_id
  left join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id`;

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

export async function listUsers(tx: UserTx, filter: UserListFilter): Promise<UserList> {
  const where = filterPredicate(filter);
  const [counts] = await tx.execute<{
    all: number;
    active: number;
    invited: number;
    deactivated: number;
  }>(sql`
    select count(*)::int as all,
           count(*) filter (where m.status = 'active')::int as active,
           count(*) filter (where m.status = 'invited')::int as invited,
           count(*) filter (where m.status = 'suspended')::int as deactivated
    ${FROM_MEMBERS}
    where ${where}`);
  const limit = Number.isFinite(filter.limit)
    ? Math.min(Math.max(Math.trunc(filter.limit), 1), MAX_PAGE_SIZE)
    : MAX_PAGE_SIZE;
  const offset = Number.isFinite(filter.offset) ? Math.max(Math.trunc(filter.offset), 0) : 0;
  const rolesVisible = personScopePredicate(filter.rolesScope, filter.actorPersonId);
  const roles = isEmptyPersonScope(filter.rolesScope)
    ? sql`null as primary_role, null as other_roles`
    : sql`case when ${rolesVisible} then (select ra.role_code from platform.role_assignments ra
             where ra.membership_id = m.id and ra.is_primary and ${ROLE_IN_FORCE}) end as primary_role,
           case when ${rolesVisible} then (select array_agg(ra.role_code order by ra.role_code)
             from platform.role_assignments ra
             where ra.membership_id = m.id and not ra.is_primary and ${ROLE_IN_FORCE}) end as other_roles`;
  const tabWhere =
    filter.tab === 'all' ? where : sql`${where} and m.status = ${TAB_STATUS[filter.tab]}`;
  const rows = await tx.execute<{
    person_id: string;
    membership_id: string;
    display_name_ar: string;
    display_name_en: string | null;
    email: string | null;
    employee_number: string | null;
    status: MembershipStatus;
    primary_role: string | null;
    other_roles: string[] | null;
    department_name_ar: string | null;
    department_name_en: string | null;
    last_sign_in_at: Date | string | null;
  }>(sql`
    select p.id as person_id, m.id as membership_id, p.display_name_ar, p.display_name_en, p.email,
           p.employee_number, m.status, ${roles},
           d.name_ar as department_name_ar, d.name_en as department_name_en,
           (select max(a.occurred_at) from platform.audit_events a
             where a.actor_user_id = m.user_id and a.action = 'platform.auth.signed_in') as last_sign_in_at
    ${FROM_MEMBERS}
    left join platform.departments d on d.tenant_id = e.tenant_id and d.id = e.department_id
    where ${tabWhere}
    order by p.display_name_ar, p.id
    limit ${limit} offset ${offset}`);
  const c = counts ?? { all: 0, active: 0, invited: 0, deactivated: 0 };
  return {
    rows: rows.map((r) => ({
      personId: r.person_id,
      membershipId: r.membership_id,
      displayNameAr: r.display_name_ar,
      displayNameEn: r.display_name_en,
      email: r.email,
      employeeNumber: r.employee_number,
      status: r.status,
      primaryRole: r.primary_role,
      otherRoles: r.other_roles ?? [],
      departmentNameAr: r.department_name_ar,
      departmentNameEn: r.department_name_en,
      lastSignInAt: toDate(r.last_sign_in_at),
    })),
    counts: c,
    total: filter.tab === 'all' ? c.all : c[filter.tab],
  };
}

export interface UserRole {
  readonly roleCode: string;
  readonly isPrimary: boolean;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
}

export interface UserActivity {
  readonly occurredAt: Date;
  readonly action: string;
  readonly actorNameAr: string | null;
  readonly actorNameEn: string | null;
}

export interface UserProfile {
  readonly personId: string;
  readonly displayNameAr: string;
  readonly displayNameEn: string | null;
  readonly email: string | null;
  readonly mobileE164: string | null;
  readonly employeeNumber: string | null;
  readonly preferredLocale: 'ar' | 'en';
  readonly personStatus: 'active' | 'inactive';
  readonly membershipStatus: 'active' | 'invited' | 'suspended' | 'revoked' | null;
  readonly jobTitleAr: string | null;
  readonly jobTitleEn: string | null;
  readonly departmentNameAr: string | null;
  readonly departmentNameEn: string | null;
  readonly branchNameAr: string | null;
  readonly branchNameEn: string | null;
  readonly manager: {
    readonly personId: string;
    readonly displayNameAr: string;
    readonly displayNameEn: string | null;
  } | null;
  readonly hireOn: string | null;
  /** All assignments with their validity dates; null when the caller may not read roles. */
  readonly roles: readonly UserRole[] | null;
  readonly lastSignInAt: Date | null;
  /** Latest audit events about the person; null when the caller may not read the audit log. */
  readonly activity: readonly UserActivity[] | null;
}

export interface UserProfileOptions {
  /** The caller holds `platform.role.read` for this person. */
  readonly includeRoles: boolean;
  /** The caller holds `platform.audit.read` (privileged roles only, ADR 0003). */
  readonly includeActivity: boolean;
}

/** Audit entity types that describe a person, their membership or their login. */
const PERSON_ENTITY_TYPES = ['person', 'tenant_membership', 'user'] as const;

/** One person's profile. The caller has authorized the person resource (defineQuery `resource`). */
export async function getUserProfile(
  tx: UserTx,
  personId: string,
  options: UserProfileOptions,
): Promise<UserProfile | null> {
  const [row] = await tx.execute<{
    person_id: string;
    display_name_ar: string;
    display_name_en: string | null;
    email: string | null;
    mobile_e164: string | null;
    employee_number: string | null;
    preferred_locale: 'ar' | 'en';
    person_status: 'active' | 'inactive';
    membership_id: string | null;
    membership_status: UserProfile['membershipStatus'];
    user_id: string | null;
    job_title_ar: string | null;
    job_title_en: string | null;
    department_name_ar: string | null;
    department_name_en: string | null;
    branch_name_ar: string | null;
    branch_name_en: string | null;
    manager_person_id: string | null;
    manager_name_ar: string | null;
    manager_name_en: string | null;
    hire_on: string | null;
  }>(sql`
    select p.id as person_id, p.display_name_ar, p.display_name_en, p.email, p.mobile_e164,
           p.employee_number, p.preferred_locale, p.status as person_status,
           m.id as membership_id, m.status as membership_status, m.user_id,
           e.job_title_ar, e.job_title_en,
           d.name_ar as department_name_ar, d.name_en as department_name_en,
           b.name_ar as branch_name_ar, b.name_en as branch_name_en,
           mgr.id as manager_person_id, mgr.display_name_ar as manager_name_ar,
           mgr.display_name_en as manager_name_en, e.hire_on::text as hire_on
    from platform.persons p
    left join platform.tenant_memberships m on m.tenant_id = p.tenant_id and m.person_id = p.id
    left join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
    left join platform.departments d on d.tenant_id = e.tenant_id and d.id = e.department_id
    left join platform.branches b on b.tenant_id = e.tenant_id and b.id = e.branch_id
    left join platform.persons mgr on mgr.tenant_id = e.tenant_id and mgr.id = e.manager_person_id
    where p.id = ${personId}::uuid`);
  if (!row) return null;

  const roles = !options.includeRoles
    ? null
    : row.membership_id
      ? await tx.execute<{
          role_code: string;
          is_primary: boolean;
          valid_from: Date | string | null;
          valid_until: Date | string | null;
        }>(sql`
        select role_code, is_primary, valid_from, valid_until from platform.role_assignments
        where membership_id = ${row.membership_id}::uuid
        order by is_primary desc, role_code`)
      : [];

  const ids = [row.person_id, row.membership_id, row.user_id].filter(
    (v): v is string => v !== null,
  );
  const activity = options.includeActivity
    ? await tx.execute<{
        occurred_at: Date | string;
        action: string;
        actor_name_ar: string | null;
        actor_name_en: string | null;
      }>(sql`
    select a.occurred_at, a.action, ap.display_name_ar as actor_name_ar,
           ap.display_name_en as actor_name_en
    from platform.audit_events a
    left join platform.persons ap on ap.tenant_id = a.tenant_id and ap.id = a.actor_person_id
    where a.entity_type in (${sql.join(
      PERSON_ENTITY_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )})
      and a.entity_id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
    order by a.occurred_at desc, a.id
    limit 10`)
    : null;

  const [lastSignIn] = row.user_id
    ? await tx.execute<{ at: Date | string | null }>(sql`
        select max(occurred_at) as at from platform.audit_events
        where actor_user_id = ${row.user_id}::uuid and action = 'platform.auth.signed_in'`)
    : [];

  return {
    personId: row.person_id,
    displayNameAr: row.display_name_ar,
    displayNameEn: row.display_name_en,
    email: row.email,
    mobileE164: row.mobile_e164,
    employeeNumber: row.employee_number,
    preferredLocale: row.preferred_locale,
    personStatus: row.person_status,
    membershipStatus: row.membership_status,
    jobTitleAr: row.job_title_ar,
    jobTitleEn: row.job_title_en,
    departmentNameAr: row.department_name_ar,
    departmentNameEn: row.department_name_en,
    branchNameAr: row.branch_name_ar,
    branchNameEn: row.branch_name_en,
    manager: row.manager_person_id
      ? {
          personId: row.manager_person_id,
          displayNameAr: row.manager_name_ar ?? '',
          displayNameEn: row.manager_name_en,
        }
      : null,
    hireOn: row.hire_on,
    roles:
      roles?.map((r) => ({
        roleCode: r.role_code,
        isPrimary: r.is_primary,
        validFrom: toDate(r.valid_from),
        validUntil: toDate(r.valid_until),
      })) ?? null,
    lastSignInAt: toDate(lastSignIn?.at ?? null),
    activity:
      activity?.map((a) => ({
        occurredAt: toDate(a.occurred_at) ?? new Date(0),
        action: a.action,
        actorNameAr: a.actor_name_ar,
        actorNameEn: a.actor_name_en,
      })) ?? null,
  };
}

/**
 * Scope attributes of a person (ResourceAttributes of type `person`) for authorize(): the person,
 * their direct manager and manager chain, their department and its ancestors, their branch.
 */
export interface PersonResourceFacts {
  readonly personId: string;
  readonly tenantId: string;
  readonly managerPersonId: string | null;
  readonly managerChain: readonly string[];
  readonly departmentId: string | null;
  readonly departmentAncestorIds: readonly string[];
  readonly branchId: string | null;
}

export async function loadPersonResourceFacts(
  tx: UserTx,
  personId: string,
): Promise<PersonResourceFacts | null> {
  const [row] = await tx.execute<{
    person_id: string;
    tenant_id: string;
    manager_person_id: string | null;
    department_id: string | null;
    branch_id: string | null;
    manager_chain: string[] | null;
    department_ancestors: string[] | null;
  }>(sql`
    select p.id as person_id, p.tenant_id, e.manager_person_id, e.department_id, e.branch_id,
      (with recursive chain (person_id, depth) as (
         select e.manager_person_id, 1 where e.manager_person_id is not null
         union all
         select x.manager_person_id, c.depth + 1 from chain c
         join platform.person_employment x on x.person_id = c.person_id
         where x.manager_person_id is not null and c.depth < 60
       ) select array_agg(person_id order by depth) from chain) as manager_chain,
      (with recursive up (id, depth) as (
         select d.parent_id, 1 from platform.departments d
         where d.id = e.department_id and d.parent_id is not null
         union all
         select d.parent_id, u.depth + 1 from up u
         join platform.departments d on d.id = u.id
         where d.parent_id is not null and u.depth < 20
       ) select array_agg(id order by depth) from up) as department_ancestors
    from platform.persons p
    left join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
    where p.id = ${personId}::uuid`);
  if (!row) return null;
  return {
    personId: row.person_id,
    tenantId: row.tenant_id,
    managerPersonId: row.manager_person_id,
    managerChain: row.manager_chain ?? [],
    departmentId: row.department_id,
    departmentAncestorIds: row.department_ancestors ?? [],
    branchId: row.branch_id,
  };
}
