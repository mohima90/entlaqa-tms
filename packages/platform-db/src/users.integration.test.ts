/**
 * People directory reads (T-M2-04a) against real PostgreSQL with the migrations applied: scope filters
 * (ADR 0003 §4.2), list tabs and filters, the profile and the person resource facts, all under
 * withUserTx (app_server, RLS) so another organization's people are never returned.
 */
import { randomUUID } from 'node:crypto';
import { EMPTY_PERSON_SCOPE, type PersonScope } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { type UserListFilter, getUserProfile, listUsers, loadPersonResourceFacts } from './users';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('people directory reads against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);

  const id = () => randomUUID();
  const t = { a: id(), b: id() };
  const branch = { hq: id(), jeddah: id() };
  const dept = { training: id(), academy: id(), academySub: id(), finance: id(), otherOrg: id() };
  const people = {
    admin: { id: id(), user: id(), name: 'أ-مدير المنشأة', status: 'active' },
    manager: { id: id(), user: id(), name: 'ب-مديرة التدريب', status: 'active' },
    report: { id: id(), user: id(), name: 'ت-منسق', status: 'active' },
    deep: { id: id(), user: id(), name: 'ث-محاسب', status: 'active' },
    invited: { id: id(), user: id(), name: 'ج-مدعو', status: 'invited' },
    suspended: { id: id(), user: id(), name: 'ح-موقوف', status: 'suspended' },
    revoked: { id: id(), user: id(), name: 'خ-ملغى', status: 'revoked' },
    noLogin: { id: id(), user: null, name: 'د-بلا حساب', status: null },
  } as const;
  const other = { id: id(), user: id() };
  const session = id();
  const userIds = [...Object.values(people).flatMap((p) => (p.user ? [p.user] : [])), other.user];

  const claims = () => {
    const result = brandVerifiedClaims({
      sub: people.admin.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: session,
      tenant_id: t.a,
      person_id: people.admin.id,
    });
    if (!result.ok) throw new Error('bad fixture');
    return result.value;
  };

  const list = (filter: Partial<UserListFilter>) =>
    withUserTx(claims(), (tx) =>
      listUsers(tx, {
        scope: { ...EMPTY_PERSON_SCOPE, all: true },
        actorPersonId: people.admin.id,
        tab: 'all',
        includeRoles: true,
        limit: 50,
        offset: 0,
        ...filter,
      }),
    );
  const names = async (filter: Partial<UserListFilter>) =>
    (await list(filter)).rows.map((r) => r.displayNameAr);
  const scoped = (scope: Partial<PersonScope>, actorPersonId: string | null = people.manager.id) =>
    names({ scope: { ...EMPTY_PERSON_SCOPE, ...scope }, actorPersonId });

  beforeAll(async () => {
    for (const user of userIds) {
      await owner`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`;
    }
    await owner`insert into auth.sessions (id, user_id) values (${session}, ${people.admin.user})`;
    await owner`insert into platform.tenants (id, slug, name_ar, status) values
      (${t.a}, ${`u-a-${t.a.slice(0, 8)}`}, 'أ', 'active'), (${t.b}, ${`u-b-${t.b.slice(0, 8)}`}, 'ب', 'active')`;
    await owner`insert into platform.branches (id, tenant_id, code, name_ar, is_headquarters) values
      (${branch.hq}, ${t.a}, 'HQ', 'الرياض', true), (${branch.jeddah}, ${t.a}, 'JED', 'جدة', false)`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, parent_id) values
      (${dept.training}, ${t.a}, 'TRN', 'التدريب', null), (${dept.finance}, ${t.a}, 'FIN', 'المالية', null)`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, parent_id)
      values (${dept.academy}, ${t.a}, 'ACD', 'الأكاديمية', ${dept.training})`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, parent_id)
      values (${dept.academySub}, ${t.a}, 'ACD-1', 'برامج القيادة', ${dept.academy})`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar)
      values (${dept.otherOrg}, ${t.b}, 'TRN', 'التدريب')`;

    for (const [key, p] of Object.entries(people)) {
      await owner`insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, employee_number)
        values (${p.id}, ${t.a}, ${p.name}, ${key === 'report' ? 'Omar 50% Coordinator' : null}, ${`E-${key}`})`;
      if (p.user) {
        await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
          values (${t.a}, ${p.user}, ${p.id}, ${p.status})`;
      }
    }
    await owner`insert into platform.persons (id, tenant_id, display_name_ar) values (${other.id}, ${t.b}, 'آخر')`;
    await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${t.b}, ${other.user}, ${other.id}, 'active')`;
    await owner`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${session}, ${people.admin.user}, ${t.a})`;

    // Org placement: manager → report → deep (manager chain); training ⊃ academy ⊃ academySub.
    const employ = (person: string, department: string, branchId: string, manager: string | null) =>
      owner`insert into platform.person_employment (tenant_id, person_id, department_id, branch_id, manager_person_id, job_title_ar, hire_on)
        values (${t.a}, ${person}, ${department}, ${branchId}, ${manager}, 'وظيفة', '2024-03-03')`;
    await employ(people.manager.id, dept.training, branch.hq, null);
    await employ(people.report.id, dept.academy, branch.hq, people.manager.id);
    await employ(people.deep.id, dept.finance, branch.jeddah, people.report.id);
    await employ(people.invited.id, dept.academySub, branch.hq, null);
    await employ(people.suspended.id, dept.training, branch.hq, null);

    await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, r.code, r.primary_role from platform.tenant_memberships,
        (values ('training_coordinator', true), ('learner', false), ('mentor', false)) as r (code, primary_role)
      where tenant_id = ${t.a} and person_id = ${people.report.id}`;
    // A role that ended in 2020 is not current: not in the list, still in the profile's history.
    await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, valid_until)
      select tenant_id, id, 'internal_instructor', '2020-01-01T00:00:00Z' from platform.tenant_memberships
      where tenant_id = ${t.a} and person_id = ${people.report.id}`;
    await owner`insert into platform.audit_events (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, occurred_at) values
      (${t.a}, ${people.report.user}, ${people.report.id}, 'platform.auth.signed_in', 'auth_session', ${id()}, '2026-10-05T08:40:00Z'),
      (${t.a}, ${people.report.user}, ${people.report.id}, 'platform.auth.signed_in', 'auth_session', ${id()}, '2026-10-01T08:00:00Z'),
      (${t.a}, ${people.admin.user}, ${people.admin.id}, 'platform.role.assigned', 'person', ${people.report.id}, '2026-09-20T10:00:00Z'),
      (${t.a}, ${people.admin.user}, ${people.admin.id}, 'tms.course.updated', 'course', ${people.report.id}, '2026-09-25T10:00:00Z')`;
  });

  afterAll(async () => {
    // audit_events is append-only: its rows (and so the tenants) stay in the throwaway test database.
    await owner`delete from platform.role_assignments where tenant_id in (${t.a}, ${t.b})`;
    await owner`delete from platform.person_employment where tenant_id in (${t.a}, ${t.b})`;
    await owner`delete from platform.session_context where session_id = ${session}`;
    await owner`delete from platform.tenant_memberships where tenant_id in (${t.a}, ${t.b})`;
    for (const department of [
      dept.academySub,
      dept.academy,
      dept.training,
      dept.finance,
      dept.otherOrg,
    ]) {
      await owner`delete from platform.departments where id = ${department}`;
    }
    await owner`delete from platform.branches where tenant_id = ${t.a}`;
    await owner`delete from platform.persons where tenant_id in (${t.a}, ${t.b})`;
    for (const user of userIds) await owner`delete from auth.users where id = ${user}`;
    await owner.end();
    await serverDb.$client.end();
  });

  it('lists members of the current organization only, by tab, without revoked or login-less people', async () => {
    const all = await list({});
    expect(all.rows.map((r) => r.displayNameAr)).toEqual([
      people.admin.name,
      people.manager.name,
      people.report.name,
      people.deep.name,
      people.invited.name,
      people.suspended.name,
    ]);
    expect(all.counts).toEqual({ all: 6, active: 4, invited: 1, deactivated: 1 });
    expect(all.total).toBe(6);

    expect(await names({ tab: 'invited' })).toEqual([people.invited.name]);
    const deactivated = await list({ tab: 'deactivated' });
    expect(deactivated.rows.map((r) => [r.displayNameAr, r.status])).toEqual([
      [people.suspended.name, 'suspended'],
    ]);
    expect(deactivated.total).toBe(1);

    const page = await list({ limit: 2, offset: 2 });
    expect(page.rows.map((r) => r.displayNameAr)).toEqual([people.report.name, people.deep.name]);
    expect(page.total).toBe(6);
  });

  it('maps roles, department and last sign-in of a row', async () => {
    const [row] = (await list({ search: 'E-report' })).rows;
    expect(row).toMatchObject({
      personId: people.report.id,
      displayNameEn: 'Omar 50% Coordinator',
      status: 'active',
      primaryRole: 'training_coordinator',
      otherRoles: ['learner', 'mentor'],
      departmentNameAr: 'الأكاديمية',
      lastSignInAt: new Date('2026-10-05T08:40:00Z'),
    });
    // Without role.read the roles are not read at all.
    const [withoutRoles] = (await list({ search: 'E-report', includeRoles: false })).rows;
    expect(withoutRoles).toMatchObject({ primaryRole: null, otherRoles: [] });
  });

  it('filters by search text (wildcards are literal), role, department and branch', async () => {
    expect(await names({ search: '50%' })).toEqual([people.report.name]);
    expect(await names({ search: '%' })).toEqual([people.report.name]);
    expect(await names({ search: '_' })).toEqual([]);
    expect(await names({ search: 'omar 50' })).toEqual([people.report.name]);
    expect(await names({ search: '   ' })).toHaveLength(6);
    // Arabic-first: hamza, teh marbuta and diacritics do not matter.
    expect(await names({ search: 'ا-مدير المنشاه' })).toEqual([people.admin.name]);
    expect(await names({ search: 'مد' + String.fromCharCode(0x0651) + 'عو' })).toEqual([
      people.invited.name,
    ]);
    expect(await names({ roleCode: 'mentor' })).toEqual([people.report.name]);
    expect(await names({ roleCode: 'internal_instructor' })).toEqual([]);
    expect(await names({ departmentId: dept.academy })).toEqual([people.report.name]);
    expect(await names({ branchId: branch.jeddah })).toEqual([people.deep.name]);
  });

  it('restricts the list to the scope of the grant (ADR 0003 §4.2)', async () => {
    expect(await scoped({})).toEqual([]);
    expect(await scoped({ self: true })).toEqual([people.manager.name]);
    expect(await scoped({ directReports: true })).toEqual([people.report.name]);
    expect(await scoped({ reportsTree: true })).toEqual([people.report.name, people.deep.name]);
    expect(await scoped({ self: true }, null)).toEqual([]);
    expect(
      await scoped({ departments: [{ ids: [dept.training], includeDescendants: false }] }),
    ).toEqual([people.manager.name, people.suspended.name]);
    expect(
      await scoped({ departments: [{ ids: [dept.training], includeDescendants: true }] }),
    ).toEqual([
      people.manager.name,
      people.report.name,
      people.invited.name,
      people.suspended.name,
    ]);
    expect(await scoped({ branchIds: [branch.jeddah] })).toEqual([people.deep.name]);
    expect(await scoped({ self: true, branchIds: [branch.jeddah] })).toEqual([
      people.manager.name,
      people.deep.name,
    ]);
    // Counts follow the scope too, so tab badges never reveal people outside it.
    const counts = (
      await list({
        scope: { ...EMPTY_PERSON_SCOPE, directReports: true },
        actorPersonId: people.manager.id,
      })
    ).counts;
    expect(counts).toEqual({ all: 1, active: 1, invited: 0, deactivated: 0 });
  });

  it('never lists people of another organization, even when their department id is named', async () => {
    const otherTenant = await list({ search: 'آخر' });
    expect(otherTenant.rows).toEqual([]);
    expect(await scoped({ self: true }, other.id)).toEqual([]);
    for (const includeDescendants of [false, true]) {
      expect(await scoped({ departments: [{ ids: [dept.otherOrg], includeDescendants }] })).toEqual(
        [],
      );
    }
  });

  it('reads one profile with placement, manager, roles, activity and last sign-in', async () => {
    const everything = { includeRoles: true, includeActivity: true };
    const profile = await withUserTx(claims(), (tx) =>
      getUserProfile(tx, people.report.id, everything),
    );
    expect(profile).toMatchObject({
      personId: people.report.id,
      membershipStatus: 'active',
      jobTitleAr: 'وظيفة',
      departmentNameAr: 'الأكاديمية',
      branchNameAr: 'الرياض',
      manager: { personId: people.manager.id, displayNameAr: people.manager.name },
      hireOn: '2024-03-03',
      roles: [
        { roleCode: 'training_coordinator', isPrimary: true },
        {
          roleCode: 'internal_instructor',
          isPrimary: false,
          validUntil: new Date('2020-01-01T00:00:00Z'),
        },
        { roleCode: 'learner', isPrimary: false },
        { roleCode: 'mentor', isPrimary: false },
      ],
      lastSignInAt: new Date('2026-10-05T08:40:00Z'),
      // Only events about the person, their membership or login (not the course event).
      activity: [
        {
          action: 'platform.role.assigned',
          actorNameAr: people.admin.name,
          occurredAt: new Date('2026-09-20T10:00:00Z'),
        },
      ],
    });

    const limited = await withUserTx(claims(), (tx) =>
      getUserProfile(tx, people.report.id, { includeRoles: false, includeActivity: false }),
    );
    expect(limited).toMatchObject({
      roles: null,
      activity: null,
      manager: { personId: people.manager.id },
    });

    const noLogin = await withUserTx(claims(), (tx) =>
      getUserProfile(tx, people.noLogin.id, everything),
    );
    expect(noLogin).toMatchObject({ membershipStatus: null, roles: [], manager: null });
    expect(await withUserTx(claims(), (tx) => getUserProfile(tx, other.id, everything))).toBeNull();
  });

  it('loads the scope attributes of a person for authorize()', async () => {
    expect(await withUserTx(claims(), (tx) => loadPersonResourceFacts(tx, people.deep.id))).toEqual(
      {
        personId: people.deep.id,
        tenantId: t.a,
        managerPersonId: people.report.id,
        managerChain: [people.report.id, people.manager.id],
        departmentId: dept.finance,
        departmentAncestorIds: [],
        branchId: branch.jeddah,
      },
    );
    expect(
      await withUserTx(claims(), (tx) => loadPersonResourceFacts(tx, people.report.id)),
    ).toMatchObject({ managerChain: [people.manager.id], departmentAncestorIds: [dept.training] });
    expect(
      await withUserTx(claims(), (tx) => loadPersonResourceFacts(tx, people.invited.id)),
    ).toMatchObject({ departmentAncestorIds: [dept.academy, dept.training] });
    expect(await withUserTx(claims(), (tx) => loadPersonResourceFacts(tx, other.id))).toBeNull();
  });
});
