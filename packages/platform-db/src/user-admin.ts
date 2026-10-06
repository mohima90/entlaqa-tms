import 'server-only';
import { type SQL, sql } from 'drizzle-orm';
import { keepUnsplitDisplayNames } from './names';
import type { UserTx } from './with-user-tx';

/**
 * HR / Organization Admin edits of a person's record and placement (T-M2-13, FR-IAM-01, BR-IAM-3).
 * The caller holds `platform.user.update` for the person (defineAction resource); the database guard
 * (private.check_person_writer, private.actor_may_manage_person) has the final word.
 */
export interface CurrentUnit {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly deleted: boolean;
}

export interface EditableUser {
  readonly personId: string;
  readonly firstNameAr: string | null;
  readonly fatherNameAr: string | null;
  readonly grandfatherNameAr: string | null;
  readonly familyNameAr: string | null;
  readonly firstNameEn: string | null;
  readonly fatherNameEn: string | null;
  readonly grandfatherNameEn: string | null;
  readonly familyNameEn: string | null;
  readonly displayNameAr: string;
  readonly displayNameEn: string | null;
  readonly email: string | null;
  readonly mobileE164: string | null;
  readonly employeeNumber: string | null;
  readonly preferredLocale: 'ar' | 'en';
  /** Has a sign-in account here: the e-mail is the login and changes only through Auth (later). */
  readonly hasLogin: boolean;
  readonly departmentId: string | null;
  readonly branchId: string | null;
  readonly managerPersonId: string | null;
  readonly jobTitleAr: string | null;
  readonly jobTitleEn: string | null;
  readonly hireOn: string | null;
  /** Names of the current department and branch, and whether they were deleted since (kept as is). */
  readonly department: CurrentUnit | null;
  readonly branch: CurrentUnit | null;
  /** Optimistic concurrency: `<person version>:<placement version or 0>`. */
  readonly version: string;
  /** The signed-in member may change this record (same rule as the database guard). */
  readonly mayManage: boolean;
}

export async function getEditableUser(tx: UserTx, personId: string): Promise<EditableUser | null> {
  const [row] = await tx.execute(sql`
    select p.id, p.first_name_ar, p.father_name_ar, p.grandfather_name_ar, p.family_name_ar,
           p.first_name_en, p.father_name_en, p.grandfather_name_en, p.family_name_en,
           p.display_name_ar, p.display_name_en, p.email, p.mobile_e164, p.employee_number,
           p.preferred_locale, p.version as person_version,
           exists (select 1 from platform.tenant_memberships m
                   where m.tenant_id = p.tenant_id and m.person_id = p.id) as has_login,
           e.department_id, e.branch_id, e.manager_person_id, e.job_title_ar, e.job_title_en,
           e.hire_on::text as hire_on, coalesce(e.version, 0) as employment_version,
           private.actor_may_manage_person(p.tenant_id, p.id) as may_manage,
           d.name_ar as department_name_ar, d.name_en as department_name_en,
           d.deleted_at is not null as department_deleted,
           b.name_ar as branch_name_ar, b.name_en as branch_name_en,
           b.deleted_at is not null as branch_deleted
    from platform.persons p
    left join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
    left join platform.departments d on d.tenant_id = e.tenant_id and d.id = e.department_id
    left join platform.branches b on b.tenant_id = e.tenant_id and b.id = e.branch_id
    where p.id = ${personId}::uuid`);
  if (!row) return null;
  const text = (key: string) => (row[key] ?? null) as string | null;
  const unit = (kind: 'department' | 'branch'): CurrentUnit | null => {
    const nameAr = text(`${kind}_name_ar`);
    return nameAr === null
      ? null
      : { nameAr, nameEn: text(`${kind}_name_en`), deleted: row[`${kind}_deleted`] === true };
  };
  return {
    personId: row.id as string,
    firstNameAr: text('first_name_ar'),
    fatherNameAr: text('father_name_ar'),
    grandfatherNameAr: text('grandfather_name_ar'),
    familyNameAr: text('family_name_ar'),
    firstNameEn: text('first_name_en'),
    fatherNameEn: text('father_name_en'),
    grandfatherNameEn: text('grandfather_name_en'),
    familyNameEn: text('family_name_en'),
    displayNameAr: row.display_name_ar as string,
    displayNameEn: text('display_name_en'),
    email: text('email'),
    mobileE164: text('mobile_e164'),
    employeeNumber: text('employee_number'),
    preferredLocale: row.preferred_locale === 'en' ? 'en' : 'ar',
    hasLogin: row.has_login === true,
    departmentId: text('department_id'),
    branchId: text('branch_id'),
    managerPersonId: text('manager_person_id'),
    jobTitleAr: text('job_title_ar'),
    jobTitleEn: text('job_title_en'),
    hireOn: text('hire_on'),
    department: unit('department'),
    branch: unit('branch'),
    version: `${String(row.person_version)}:${String(row.employment_version)}`,
    mayManage: row.may_manage === true,
  };
}

/** A person who can be chosen as direct manager (screen 2: managers of the chosen department). */
export interface ManagerOption {
  readonly personId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** False only for the present manager who is no longer active (shown so it is not lost). */
  readonly active: boolean;
  /** Their own department and the departments they head (the picker filters by these). */
  readonly departmentIds: readonly string[];
}

/**
 * Active members with a managing role in force (Department Head, Line Manager) and the heads of
 * departments, with the departments they belong to or head. `current` (the person's present
 * manager) is always included, even without a managing role or when no longer active, so an edit
 * never drops it silently.
 */
export async function listManagerOptions(
  tx: UserTx,
  current: string | null = null,
): Promise<readonly ManagerOption[]> {
  const rows = await tx.execute<{
    person_id: string;
    name_ar: string;
    name_en: string | null;
    active: boolean;
    department_ids: string[] | null;
  }>(sql`
    with managers as (
      select m.person_id from platform.tenant_memberships m
      join platform.role_assignments ra on ra.tenant_id = m.tenant_id and ra.membership_id = m.id
      where m.status = 'active' and ra.role_code in ('department_head', 'line_manager')
        and (ra.valid_from is null or ra.valid_from <= now())
        and (ra.valid_until is null or ra.valid_until > now())
      union
      select d.head_person_id from platform.departments d
      where d.head_person_id is not null and d.deleted_at is null
      union
      select ${current}::uuid where ${current}::uuid is not null
    )
    select p.id as person_id, p.display_name_ar as name_ar, p.display_name_en as name_en,
           p.status = 'active' as active,
           array_remove(array_cat(
             array[e.department_id],
             array(select d.id from platform.departments d
                   where d.head_person_id = p.id and d.deleted_at is null)), null) as department_ids
    from managers x
    join platform.persons p on p.id = x.person_id
      and (p.status = 'active' or p.id = ${current}::uuid)
    left join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
    order by p.display_name_ar, p.id`);
  return rows.map((r) => ({
    personId: r.person_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    active: r.active,
    departmentIds: r.department_ids ?? [],
  }));
}

export interface UserDetailsChange {
  readonly firstNameAr: string | null;
  readonly fatherNameAr: string | null;
  readonly grandfatherNameAr: string | null;
  readonly familyNameAr: string | null;
  readonly firstNameEn: string | null;
  readonly fatherNameEn: string | null;
  readonly grandfatherNameEn: string | null;
  readonly familyNameEn: string | null;
  readonly displayNameAr: string;
  readonly displayNameEn: string | null;
  /** Ignored for people with a login (the login e-mail changes only through Auth). */
  readonly email: string | null;
  readonly mobileE164: string | null;
  readonly employeeNumber: string | null;
  readonly preferredLocale: 'ar' | 'en';
  readonly departmentId: string | null;
  readonly branchId: string | null;
  readonly managerPersonId: string | null;
  readonly jobTitleAr: string | null;
  readonly jobTitleEn: string | null;
  readonly hireOn: string | null;
}

/** Why a change was refused, as a field the form can point at. */
export type UserDetailsRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'email_taken'
  | 'employee_number_taken'
  | 'manager_loop'
  | 'manager_inactive'
  | 'department_deleted'
  | 'branch_deleted'
  | 'hire_date_invalid'
  | 'name_required'
  | 'not_allowed';

export type UserDetailsOutcome =
  | { readonly ok: true; readonly changed: readonly string[] }
  | { readonly ok: false; readonly refusal: UserDetailsRefusal };

const PERSON_FIELDS = [
  ['firstNameAr', 'first_name_ar'],
  ['fatherNameAr', 'father_name_ar'],
  ['grandfatherNameAr', 'grandfather_name_ar'],
  ['familyNameAr', 'family_name_ar'],
  ['firstNameEn', 'first_name_en'],
  ['fatherNameEn', 'father_name_en'],
  ['grandfatherNameEn', 'grandfather_name_en'],
  ['familyNameEn', 'family_name_en'],
  ['displayNameAr', 'display_name_ar'],
  ['displayNameEn', 'display_name_en'],
  ['email', 'email'],
  ['mobileE164', 'mobile_e164'],
  ['employeeNumber', 'employee_number'],
  ['preferredLocale', 'preferred_locale'],
] as const;

const EMPLOYMENT_FIELDS = [
  ['departmentId', 'department_id'],
  ['branchId', 'branch_id'],
  ['managerPersonId', 'manager_person_id'],
  ['jobTitleAr', 'job_title_ar'],
  ['jobTitleEn', 'job_title_en'],
  ['hireOn', 'hire_on'],
] as const;

/** SQLSTATE, constraint and message of a postgres.js error (also wrapped by Drizzle). */
function pgError(error: unknown): { code?: string; constraint?: string; message: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const e = current as {
      code?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        code: e.code,
        ...(typeof e.constraint_name === 'string' ? { constraint: e.constraint_name } : {}),
        message: typeof e.message === 'string' ? e.message : '',
      };
    }
    current = e.cause;
  }
  return null;
}

/** Maps database refusals of a person/placement change to form-level reasons; rethrows the rest. */
export function refusalOf(error: unknown): UserDetailsRefusal {
  const pg = pgError(error);
  if (pg?.code === '23505' && pg.constraint === 'persons_tenant_email_uq') return 'email_taken';
  if (pg?.code === '23505' && pg.constraint === 'persons_tenant_employee_number_uq') {
    return 'employee_number_taken';
  }
  if (pg?.code === '23514' && pg.message.includes('manager chain')) return 'manager_loop';
  if (pg?.code === '23514' && pg.message.includes('direct manager must be an active')) {
    return 'manager_inactive';
  }
  if (pg?.code === '23514' && pg.message.includes('deleted department')) {
    return 'department_deleted';
  }
  if (pg?.code === '23514' && pg.message.includes('deleted branch')) return 'branch_deleted';
  if (pg?.code === '23514' && pg.constraint === 'person_employment_dates_check') {
    return 'hire_date_invalid';
  }
  // A unit or manager id that does not exist (or belongs to another organization).
  if (pg?.code === '23503' && pg.constraint?.includes('department_id')) return 'department_deleted';
  if (pg?.code === '23503' && pg.constraint?.includes('branch_id')) return 'branch_deleted';
  if (pg?.code === '23503' && pg.constraint?.includes('manager_person_id')) {
    return 'manager_inactive';
  }
  if (pg?.code === '42501') return 'not_allowed';
  throw error;
}

/**
 * Saves a person's details and placement in the caller's transaction. Returns the changed field
 * names (for the audit event — never values), or why the database refused. A refusal leaves the
 * transaction aborted: the caller must end it (defineAction rolls back on an error result).
 */
export async function updateUserDetails(
  tx: UserTx,
  personId: string,
  expectedVersion: string,
  change: UserDetailsChange,
): Promise<UserDetailsOutcome> {
  const before = await getEditableUser(tx, personId);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== expectedVersion) return { ok: false, refusal: 'version_conflict' };
  // Same rule as the page and the database guard (also on one's own record: My profile is the
  // self-service path, with its own audit event).
  if (!before.mayManage) return { ok: false, refusal: 'not_allowed' };
  const next: UserDetailsChange = keepUnsplitDisplayNames(
    before,
    before.hasLogin ? { ...change, email: before.email } : change,
  );
  // A first name is required, unless a long Arabic name stored without parts was kept as is.
  const arabicNameKept = next.displayNameAr !== change.displayNameAr;
  if (next.firstNameAr === null && !arabicNameKept) return { ok: false, refusal: 'name_required' };

  const personChanges = PERSON_FIELDS.filter(([field]) => before[field] !== next[field]);
  const employmentChanges = EMPLOYMENT_FIELDS.filter(([field]) => before[field] !== next[field]);
  const [personVersion = '', employmentVersion = '0'] = before.version.split(':');
  const hasEmployment = employmentVersion !== '0';
  // The version check is repeated in each UPDATE, so a concurrent edit cannot slip in between.
  let conflict = false;

  try {
    if (personChanges.length > 0) {
      const sets: SQL[] = personChanges.map(
        ([field, column]) => sql`${sql.identifier(column)} = ${next[field]}`,
      );
      const updated = await tx.execute(sql`update platform.persons set ${sql.join(sets, sql`, `)}
        where id = ${personId}::uuid and version = ${Number(personVersion)} returning id`);
      conflict ||= updated.length === 0;
    }
    if (employmentChanges.length > 0) {
      if (hasEmployment) {
        const sets: SQL[] = employmentChanges.map(([field, column]) =>
          column === 'hire_on'
            ? sql`hire_on = ${next.hireOn}::date`
            : column.endsWith('_id')
              ? sql`${sql.identifier(column)} = ${next[field]}::uuid`
              : sql`${sql.identifier(column)} = ${next[field]}`,
        );
        const updated = await tx.execute(sql`update platform.person_employment
          set ${sql.join(sets, sql`, `)}
          where person_id = ${personId}::uuid and version = ${Number(employmentVersion)} returning id`);
        conflict ||= updated.length === 0;
      } else {
        // A concurrent first placement wins the unique key: this edit is then a version conflict.
        const inserted = await tx.execute(sql`
          insert into platform.person_employment
            (person_id, department_id, branch_id, manager_person_id, job_title_ar, job_title_en, hire_on)
          values (${personId}::uuid, ${next.departmentId}::uuid, ${next.branchId}::uuid,
                  ${next.managerPersonId}::uuid, ${next.jobTitleAr}, ${next.jobTitleEn},
                  ${next.hireOn}::date)
          on conflict (tenant_id, person_id) do nothing returning id`);
        conflict ||= inserted.length === 0;
      }
    }
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
  if (conflict) return { ok: false, refusal: 'version_conflict' };
  return {
    ok: true,
    changed: [...personChanges.map(([f]) => f), ...employmentChanges.map(([f]) => f)],
  };
}

/** May the signed-in member change this person's record? (private.actor_may_manage_person) */
export async function mayManagePerson(tx: UserTx, personId: string): Promise<boolean> {
  const [row] = await tx.execute<{ may: boolean }>(sql`
    select private.actor_may_manage_person(p.tenant_id, p.id) as may
    from platform.persons p where p.id = ${personId}::uuid`);
  return row?.may === true;
}
