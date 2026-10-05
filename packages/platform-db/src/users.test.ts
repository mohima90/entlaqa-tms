import { EMPTY_PERSON_SCOPE } from '@jadarat/platform-core';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { listOrgUnitOptions } from './org';
import { loadMemberAuthorizationFacts } from './roles';
import {
  type UserListFilter,
  getUserProfile,
  listUsers,
  loadPersonResourceFacts,
  personScopePredicate,
} from './users';

const dialect = new PgDialect();

/** Fake transaction: records each statement and returns the queued results in order. */
function fakeTx(...results: unknown[][]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        const q = dialect.sqlToQuery(query);
        executed.push({ sql: q.sql, params: q.params });
        return Promise.resolve(results.shift() ?? []);
      },
    } as never,
  };
}

const ME = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';
const B1 = '33333333-3333-4333-8333-333333333333';

function predicate(scope: Parameters<typeof personScopePredicate>[0], actor: string | null = ME) {
  return dialect.sqlToQuery(personScopePredicate(scope, actor));
}

describe('personScopePredicate (ADR 0003 §4.2)', () => {
  it('is true for everyone and false for an empty scope', () => {
    expect(predicate({ ...EMPTY_PERSON_SCOPE, all: true }).sql).toBe('true');
    expect(predicate(EMPTY_PERSON_SCOPE).sql).toBe('false');
  });

  it('builds the union of the scope parts with bound parameters', () => {
    const q = predicate({
      all: false,
      self: true,
      directReports: true,
      reportsTree: true,
      departments: [
        { ids: [D1], includeDescendants: true },
        { ids: [], includeDescendants: false },
      ],
      branchIds: [B1],
    });
    expect(q.sql).toContain('p.id = $1::uuid');
    expect(q.sql).toContain('e.manager_person_id = $2::uuid');
    expect(q.sql).toContain('with recursive reports');
    expect(q.sql).toContain('with recursive tree');
    expect(q.sql).toContain('e.branch_id in');
    expect(q.sql.split(' or ')).toHaveLength(5);
    expect(q.params).toEqual([ME, ME, ME, D1, B1]);
  });

  it('uses departments without descendants as a plain list', () => {
    const q = predicate({
      ...EMPTY_PERSON_SCOPE,
      departments: [{ ids: [D1], includeDescendants: false }],
    });
    expect(q.sql).toBe('(e.department_id in ($1::uuid))');
  });

  it('covers nobody through personal parts when the member has no person', () => {
    expect(predicate({ ...EMPTY_PERSON_SCOPE, self: true, directReports: true }, null).sql).toBe(
      'false',
    );
  });
});

const baseFilter: UserListFilter = {
  scope: { ...EMPTY_PERSON_SCOPE, all: true },
  actorPersonId: ME,
  tab: 'all',
  rolesScope: { ...EMPTY_PERSON_SCOPE, all: true },
  limit: 25,
  offset: 0,
};

describe('listUsers', () => {
  it('returns counts per tab, the page of rows and the total of the current tab', async () => {
    const fake = fakeTx(
      [{ all: 4, active: 2, invited: 1, deactivated: 1 }],
      [
        {
          person_id: 'p1',
          membership_id: 'm1',
          display_name_ar: 'سارة',
          display_name_en: null,
          email: 's@example.test',
          employee_number: 'E1',
          status: 'active',
          primary_role: 'learner',
          other_roles: null,
          department_name_ar: 'التدريب',
          department_name_en: null,
          last_sign_in_at: '2026-10-05T08:00:00.000Z',
        },
      ],
    );
    const list = await listUsers(fake.tx, {
      ...baseFilter,
      tab: 'active',
      search: '50%_off\\',
      roleCode: 'learner',
      departmentId: D1,
      branchId: B1,
    });
    expect(list.counts).toEqual({ all: 4, active: 2, invited: 1, deactivated: 1 });
    expect(list.total).toBe(2);
    expect(list.rows).toEqual([
      {
        personId: 'p1',
        membershipId: 'm1',
        displayNameAr: 'سارة',
        displayNameEn: null,
        email: 's@example.test',
        employeeNumber: 'E1',
        status: 'active',
        primaryRole: 'learner',
        otherRoles: [],
        departmentNameAr: 'التدريب',
        departmentNameEn: null,
        lastSignInAt: new Date('2026-10-05T08:00:00.000Z'),
      },
    ]);
    const [counts, rows] = fake.executed;
    expect(counts?.sql).toContain("m.status in ('active', 'invited', 'suspended')");
    expect(rows?.sql).toContain('and m.status = $');
    expect(rows?.params).toContain('%50\\%\\_off\\\\%');
    expect(rows?.sql).toContain('private.search_key(p.display_name_ar) like private.search_key(');
    expect(rows?.sql).toContain('ra.valid_until > now()');
    expect(rows?.params).toContain('learner');
    expect(rows?.params).toEqual(expect.arrayContaining([D1, B1, 25, 0]));
  });

  it('maps the deactivated tab to suspended memberships and survives an empty result', async () => {
    const fake = fakeTx([], []);
    const list = await listUsers(fake.tx, { ...baseFilter, tab: 'deactivated' });
    expect(list).toEqual({
      rows: [],
      counts: { all: 0, active: 0, invited: 0, deactivated: 0 },
      total: 0,
    });
    expect(fake.executed[1]?.params).toContain('suspended');
  });

  it('leaves roles out without role.read, matches no one by role then, and clamps paging', async () => {
    const fake = fakeTx([], []);
    await listUsers(fake.tx, {
      ...baseFilter,
      rolesScope: EMPTY_PERSON_SCOPE,
      limit: 10_000,
      offset: -5,
    });
    expect(fake.executed[1]?.sql).toContain('null as primary_role, null as other_roles');
    expect(fake.executed[1]?.params.slice(-2)).toEqual([100, 0]);
    const nan = fakeTx([], []);
    await listUsers(nan.tx, { ...baseFilter, limit: Number.NaN, offset: Number.NaN });
    expect(nan.executed[1]?.params.slice(-2)).toEqual([100, 0]);
    const byRole = fakeTx([], []);
    await listUsers(byRole.tx, {
      ...baseFilter,
      rolesScope: EMPTY_PERSON_SCOPE,
      roleCode: 'learner',
    });
    expect(byRole.executed[0]?.sql).toContain('and false and exists');
  });

  it('shows roles only on rows inside the role.read scope; the department filter takes sub-departments', async () => {
    const fake = fakeTx([], []);
    await listUsers(fake.tx, {
      ...baseFilter,
      rolesScope: { ...EMPTY_PERSON_SCOPE, directReports: true },
      departmentId: D1,
    });
    const rows = fake.executed[1];
    expect(rows?.sql).toContain('case when (e.manager_person_id = $');
    expect(rows?.sql).toContain('with recursive tree');
    expect(rows?.params).toContain(D1);
  });
});

describe('getUserProfile', () => {
  const all = { includeRoles: true, includeActivity: true };
  const person = {
    person_id: 'p1',
    display_name_ar: 'سارة',
    display_name_en: 'Sarah',
    email: 's@example.test',
    mobile_e164: '+966551234567',
    employee_number: 'E1',
    preferred_locale: 'ar',
    person_status: 'active',
    membership_id: 'm1',
    membership_status: 'active',
    user_id: 'u1',
    job_title_ar: 'أخصائية تدريب',
    job_title_en: null,
    department_name_ar: 'التدريب',
    department_name_en: null,
    branch_name_ar: 'الرياض',
    branch_name_en: null,
    manager_person_id: 'p0',
    manager_name_ar: 'خالد',
    manager_name_en: null,
    hire_on: '2024-03-03',
  };

  it('returns the person with roles, recent activity and last sign-in', async () => {
    const fake = fakeTx(
      [person],
      [
        {
          role_code: 'training_coordinator',
          is_primary: true,
          valid_from: null,
          valid_until: null,
        },
      ],
      [
        {
          occurred_at: '2026-09-20T10:00:00Z',
          action: 'platform.role.assigned',
          actor_name_ar: 'محمد',
          actor_name_en: null,
        },
      ],
      [{ at: new Date('2026-10-05T08:40:00Z') }],
    );
    const profile = await getUserProfile(fake.tx, 'p1', all);
    expect(profile).toMatchObject({
      personId: 'p1',
      manager: { personId: 'p0', displayNameAr: 'خالد', displayNameEn: null },
      roles: [
        { roleCode: 'training_coordinator', isPrimary: true, validFrom: null, validUntil: null },
      ],
      activity: [
        { action: 'platform.role.assigned', occurredAt: new Date('2026-09-20T10:00:00Z') },
      ],
      lastSignInAt: new Date('2026-10-05T08:40:00Z'),
      hireOn: '2024-03-03',
    });
    expect(fake.executed[2]?.params).toEqual([
      'person',
      'tenant_membership',
      'user',
      'p1',
      'm1',
      'u1',
    ]);
  });

  it('handles a person without a login and without a manager', async () => {
    const fake = fakeTx(
      [
        {
          ...person,
          membership_id: null,
          membership_status: null,
          user_id: null,
          manager_person_id: null,
        },
      ],
      [],
    );
    const profile = await getUserProfile(fake.tx, 'p1', all);
    expect(profile).toMatchObject({ roles: [], manager: null, lastSignInAt: null, activity: [] });
  });

  it('reads neither roles nor activity when the caller may not see them', async () => {
    const fake = fakeTx([person], [{ at: null }]);
    const profile = await getUserProfile(fake.tx, 'p1', {
      includeRoles: false,
      includeActivity: false,
    });
    expect(profile).toMatchObject({ roles: null, activity: null, lastSignInAt: null });
    expect(fake.executed).toHaveLength(2);
    expect(fake.executed[1]?.sql).toContain('platform.auth.signed_in');
    expect(fake.executed).toHaveLength(2);
  });

  it('returns null for an unknown (or other-tenant) person', async () => {
    expect(await getUserProfile(fakeTx([]).tx, 'p1', all)).toBeNull();
  });
});

describe('loadPersonResourceFacts', () => {
  it('returns the scope attributes of a person', async () => {
    const fake = fakeTx([
      {
        person_id: 'p1',
        tenant_id: 't',
        manager_person_id: 'm1',
        department_id: 'd2',
        branch_id: 'b1',
        manager_chain: ['m1', 'm0'],
        department_ancestors: ['d1'],
      },
    ]);
    expect(await loadPersonResourceFacts(fake.tx, 'p1')).toEqual({
      personId: 'p1',
      tenantId: 't',
      managerPersonId: 'm1',
      managerChain: ['m1', 'm0'],
      departmentId: 'd2',
      departmentAncestorIds: ['d1'],
      branchId: 'b1',
    });
  });

  it('defaults chains to empty and returns null for an unknown person', async () => {
    const fake = fakeTx([
      {
        person_id: 'p1',
        tenant_id: 't',
        manager_person_id: null,
        department_id: null,
        branch_id: null,
        manager_chain: null,
        department_ancestors: null,
      },
    ]);
    expect(await loadPersonResourceFacts(fake.tx, 'p1')).toMatchObject({
      managerChain: [],
      departmentAncestorIds: [],
    });
    expect(await loadPersonResourceFacts(fakeTx([]).tx, 'p1')).toBeNull();
  });
});

describe('loadMemberAuthorizationFacts', () => {
  it('maps the member’s roles and headed departments', async () => {
    const fake = fakeTx(
      [
        { role_code: 'learner', valid_from: null, valid_until: '2027-01-01T00:00:00Z' },
        {
          role_code: 'line_manager',
          valid_from: new Date('2026-01-01T00:00:00Z'),
          valid_until: null,
        },
      ],
      [{ id: 'd1' }],
    );
    expect(await loadMemberAuthorizationFacts(fake.tx)).toEqual({
      roles: [
        { roleCode: 'learner', validFrom: null, validUntil: new Date('2027-01-01T00:00:00Z') },
        { roleCode: 'line_manager', validFrom: new Date('2026-01-01T00:00:00Z'), validUntil: null },
      ],
      headedDepartmentIds: ['d1'],
    });
    expect(fake.executed[0]?.sql).toContain("m.status = 'active'");
  });
});

describe('listOrgUnitOptions', () => {
  it('lists departments and branches that are not deleted', async () => {
    const fake = fakeTx(
      [{ id: 'd1', name_ar: 'التدريب', name_en: 'Training' }],
      [{ id: 'b1', name_ar: 'الرياض', name_en: null }],
    );
    expect(await listOrgUnitOptions(fake.tx)).toEqual({
      departments: [{ id: 'd1', nameAr: 'التدريب', nameEn: 'Training' }],
      branches: [{ id: 'b1', nameAr: 'الرياض', nameEn: null }],
    });
    expect(fake.executed.every((q) => q.sql.includes('deleted_at is null'))).toBe(true);
  });
});
