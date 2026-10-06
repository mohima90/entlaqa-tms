import { ok } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grant } from '../authorize';
import type { ActionRuntime } from '../define-action';
import { createDefineQuery } from '../define-query';
import { grantsForAssignments } from '../role-grants';
import type { SystemRoleCode } from '../system-roles';
import { USERS_PAGE_SIZE, userProfileQueryDefinition, usersListQueryDefinition } from './users';

const db = vi.hoisted(() => ({
  listUsers: vi.fn(),
  listOrgUnitOptions: vi.fn(),
  getUserProfile: vi.fn(),
  loadPersonResourceFacts: vi.fn(),
  mayManagePerson: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const REPORT = '44444444-4444-4444-8444-444444444444';
const DEPT = '55555555-5555-4555-8555-555555555555';

const TX = 'tx' as unknown as UserTx;

function runtime(roles: SystemRoleCode[]): ActionRuntime<UserTx> {
  const grants: Grant[] = [
    ...grantsForAssignments(
      roles.map((roleCode) => ({ roleCode })),
      {
        headedDepartmentIds: [DEPT],
      },
    ),
  ];
  return {
    getClaims: () => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: TENANT,
        person_id: ME,
      });
      if (!r.ok) throw new Error('fixture');
      return Promise.resolve(ok(r.value));
    },
    withUserTx: (_c, fn) => fn(TX),
    loadGrants: () => Promise.resolve(grants),
    resolveResource: (_tx, ref) =>
      Promise.resolve(
        ref.id === REPORT
          ? {
              type: 'person',
              id: REPORT,
              tenantId: TENANT,
              subjectPersonId: REPORT,
              subjectManagerPersonId: ME,
            }
          : null,
      ),
    writeAudit: vi.fn(),
    logError: vi.fn(),
  };
}

const emptyList = { rows: [], counts: { all: 0, active: 0, invited: 0, deactivated: 0 }, total: 0 };
const orgUnits = { departments: [], branches: [] };

beforeEach(() => {
  vi.clearAllMocks();
  db.listUsers.mockResolvedValue(emptyList);
  db.listOrgUnitOptions.mockResolvedValue(orgUnits);
  db.getUserProfile.mockResolvedValue({ personId: REPORT });
  db.mayManagePerson.mockResolvedValue(true);
});

describe('users list query', () => {
  it('Organization Admin: everyone, roles and filters, Arabic digits normalized, paging', async () => {
    const list = createDefineQuery(runtime(['tenant_admin']))(usersListQueryDefinition());
    const result = await list({
      tab: 'active',
      q: ' EMP-' + String.fromCharCode(0x0661, 0x0661, 0x0668, 0x0667) + ' ',
      role: 'learner',
      department: DEPT,
      branch: DEPT,
      page: '3',
    });
    expect(result).toEqual(
      ok({ list: emptyList, page: 3, pageSize: USERS_PAGE_SIZE, canReadRoles: true, orgUnits }),
    );
    expect(db.listUsers).toHaveBeenCalledWith(TX, {
      scope: expect.objectContaining({ all: true }),
      actorPersonId: ME,
      tab: 'active',
      rolesScope: expect.objectContaining({ all: true }),
      search: 'EMP-1187',
      roleCode: 'learner',
      departmentId: DEPT,
      branchId: DEPT,
      limit: USERS_PAGE_SIZE,
      offset: 2 * USERS_PAGE_SIZE,
    });
  });

  it('Learner: only themselves, no roles, no organization filters (filters ignored)', async () => {
    const list = createDefineQuery(runtime(['learner']))(usersListQueryDefinition());
    const result = await list({ role: 'tenant_admin', department: DEPT });
    expect(result.ok && result.value).toMatchObject({ canReadRoles: false, orgUnits: null });
    expect(db.listOrgUnitOptions).not.toHaveBeenCalled();
    expect(db.listUsers).toHaveBeenCalledWith(TX, {
      scope: expect.objectContaining({ all: false, self: true, directReports: false }),
      actorPersonId: ME,
      tab: 'all',
      rolesScope: expect.objectContaining({ all: false, self: false, directReports: false }),
      limit: USERS_PAGE_SIZE,
      offset: 0,
    });
  });

  it('Department Head: their departments with sub-departments, roles, organization filters', async () => {
    const list = createDefineQuery(runtime(['department_head']))(usersListQueryDefinition());
    await list({});
    expect(db.listUsers).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        scope: expect.objectContaining({
          all: false,
          departments: [{ ids: [DEPT], includeDescendants: true }],
        }),
        rolesScope: expect.objectContaining({
          departments: [{ ids: [DEPT], includeDescendants: true }],
        }),
      }),
    );
    expect(db.listOrgUnitOptions).toHaveBeenCalled();
  });

  it('Line Manager + Learner: roles only for the direct reports, not for their own row', async () => {
    const list = createDefineQuery(runtime(['line_manager', 'learner']))(
      usersListQueryDefinition(),
    );
    const result = await list({});
    expect(result.ok && result.value.canReadRoles).toBe(true);
    expect(db.listUsers).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        scope: expect.objectContaining({ self: true, directReports: true }),
        rolesScope: expect.objectContaining({ self: false, directReports: true }),
      }),
    );
  });

  it('rejects malformed input before any database work; no role → 403', async () => {
    const list = createDefineQuery(runtime(['tenant_admin']))(usersListQueryDefinition());
    for (const input of [
      { department: 'x' },
      { role: 'platform_super_admin' },
      { page: '0' },
      { tab: 'revoked' },
      { q: 'x'.repeat(101) },
    ]) {
      const result = await list(input as never);
      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    }
    const none = await createDefineQuery(runtime([]))(usersListQueryDefinition())({});
    expect(!none.ok && none.error.code).toBe('FORBIDDEN');
    expect(db.listUsers).not.toHaveBeenCalled();
  });
});

describe('user profile query', () => {
  it('Line Manager: a report’s profile with roles, without the audit trail', async () => {
    const profile = createDefineQuery(runtime(['line_manager']))(userProfileQueryDefinition());
    expect(await profile({ personId: REPORT })).toEqual(
      ok({ profile: { personId: REPORT }, canOpenManager: false, canEdit: false }),
    );
    expect(db.getUserProfile).toHaveBeenCalledWith(TX, REPORT, {
      includeRoles: true,
      includeActivity: false,
    });
  });

  it('Auditor and Organization Admin see the audit trail', async () => {
    for (const role of ['auditor', 'tenant_admin'] as const) {
      await createDefineQuery(runtime([role]))(userProfileQueryDefinition())({ personId: REPORT });
      expect(db.getUserProfile).toHaveBeenLastCalledWith(TX, REPORT, {
        includeRoles: true,
        includeActivity: true,
      });
    }
  });

  it('Learner: their own profile only, without roles; others → NOT_FOUND', async () => {
    const profile = createDefineQuery(runtime(['learner']))(userProfileQueryDefinition());
    const other = await profile({ personId: REPORT });
    expect(!other.ok && other.error.code).toBe('NOT_FOUND');
    expect(db.getUserProfile).not.toHaveBeenCalled();
  });

  it('links the manager only when the member may open the manager’s profile', async () => {
    db.getUserProfile.mockResolvedValue({ personId: REPORT, manager: { personId: ME } });
    db.loadPersonResourceFacts.mockResolvedValue({
      personId: ME,
      tenantId: TENANT,
      managerPersonId: null,
      managerChain: [],
      departmentId: null,
      departmentAncestorIds: [],
      branchId: null,
    });
    // A Line Manager reads their reports, not themselves (no learner role here).
    const asManager = await createDefineQuery(runtime(['line_manager']))(
      userProfileQueryDefinition(),
    )({ personId: REPORT });
    expect(asManager.ok && asManager.value.canOpenManager).toBe(false);
    const asAdmin = await createDefineQuery(runtime(['tenant_admin']))(
      userProfileQueryDefinition(),
    )({ personId: REPORT });
    expect(asAdmin.ok && asAdmin.value.canOpenManager).toBe(true);
    // Edit: user.update (admin yes, line manager no) and the database manage rule.
    expect(asManager.ok && asManager.value.canEdit).toBe(false);
    expect(asAdmin.ok && asAdmin.value.canEdit).toBe(true);
    db.mayManagePerson.mockResolvedValue(false);
    const refused = await createDefineQuery(runtime(['tenant_admin']))(
      userProfileQueryDefinition(),
    )({ personId: REPORT });
    expect(refused.ok && refused.value.canEdit).toBe(false);
    expect(db.loadPersonResourceFacts).toHaveBeenCalledWith(TX, ME);
  });

  it('a person that disappeared after authorization → NOT_FOUND', async () => {
    db.getUserProfile.mockResolvedValue(null);
    const profile = createDefineQuery(runtime(['tenant_admin']))(userProfileQueryDefinition());
    const result = await profile({ personId: REPORT });
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
  });
});
