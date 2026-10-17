import { describe, expect, it } from 'vitest';
import { type CustomRoleDefinition, scopeNeedsUnit } from './custom-roles';
import {
  type RoleAssignment,
  canAssignRole,
  customAssignableRole,
  grantsForAssignments,
  holdsTenantWide,
  standardAssignableRole,
} from './role-grants';
import { getSystemRole } from './system-roles';

const none = { headedDepartmentIds: [] };
const reviewer: CustomRoleDefinition = {
  code: 'custom_a00000000001',
  dataScope: 'team',
  permissions: ['platform.user.read', 'platform.org.read', 'platform.user.invite'],
};
const auditor: CustomRoleDefinition = {
  code: 'custom_a00000000002',
  dataScope: 'organization',
  permissions: ['platform.user.read', 'platform.audit.read'],
};

describe('grantsForAssignments', () => {
  it('is the role’s grants with their scopes and validity window', () => {
    const until = new Date('2027-01-01T00:00:00Z');
    expect(
      grantsForAssignments([{ roleCode: 'training_coordinator', validUntil: until }], none),
    ).toEqual([
      { permission: 'platform.user.read', scope: { type: 'tenant' }, validUntil: until },
      { permission: 'platform.role.read', scope: { type: 'tenant' }, validUntil: until },
      { permission: 'platform.org.read', scope: { type: 'tenant' }, validUntil: until },
    ]);
    expect(grantsForAssignments([{ roleCode: 'learner' }], none)).toEqual([
      { permission: 'platform.user.read', scope: { type: 'own' } },
    ]);
  });

  it('turns a department head’s scope into the headed departments and their sub-departments', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(
      grantsForAssignments([{ roleCode: 'department_head', validFrom: from }], {
        headedDepartmentIds: ['d1', 'd2'],
      })[0],
    ).toEqual({
      permission: 'platform.user.read',
      scope: { type: 'org_units', orgUnitIds: ['d1', 'd2'], includeDescendants: true },
      validFrom: from,
    });
    // Heading no department: the scoped grant is dropped, the tenant-wide one stays.
    expect(grantsForAssignments([{ roleCode: 'department_head' }], none)).toEqual([
      { permission: 'platform.org.read', scope: { type: 'tenant' } },
    ]);
  });

  it('gives a custom role’s permissions with its data scope (EP-ROLES)', () => {
    // «Their team» = direct reports; the structure is organization-wide by nature; an administrative
    // permission in a team-scoped role grants nothing (the database refuses such a role anyway).
    expect(
      grantsForAssignments([{ roleCode: reviewer.code }], { ...none, customRoles: [reviewer] }),
    ).toEqual([
      { permission: 'platform.user.read', scope: { type: 'direct_reports' } },
      { permission: 'platform.org.read', scope: { type: 'tenant' } },
    ]);
    expect(
      grantsForAssignments([{ roleCode: auditor.code }], { ...none, customRoles: [auditor] }),
    ).toEqual([
      { permission: 'platform.user.read', scope: { type: 'tenant' } },
      { permission: 'platform.audit.read', scope: { type: 'tenant' } },
    ]);
    const own: CustomRoleDefinition = { ...reviewer, dataScope: 'own' };
    expect(
      grantsForAssignments([{ roleCode: own.code }], { ...none, customRoles: [own] })[0],
    ).toEqual({ permission: 'platform.user.read', scope: { type: 'own' } });
  });

  it('limits a custom role scoped to «A department» to the unit picked for the assignment and everything under it (EP-ORG, T-M3-09)', () => {
    const departments: CustomRoleDefinition = { ...reviewer, dataScope: 'departments' };
    const context = { headedDepartmentIds: ['headed'], customRoles: [departments] };
    // The picked unit with its descendants — never the departments the member happens to head.
    expect(
      grantsForAssignments([{ roleCode: departments.code, scopeUnitId: 'sales' }], context),
    ).toEqual([
      {
        permission: 'platform.user.read',
        scope: { type: 'org_units', orgUnitIds: ['sales'], includeDescendants: true },
      },
      { permission: 'platform.org.read', scope: { type: 'tenant' } },
    ]);
    // No unit (not picked yet, or deactivated / deleted since): nothing scoped, the structure's names only.
    for (const assignment of [
      { roleCode: departments.code, scopeUnitId: null },
      { roleCode: departments.code },
    ]) {
      expect(grantsForAssignments([assignment], context)).toEqual([
        { permission: 'platform.org.read', scope: { type: 'tenant' } },
      ]);
    }
    // A unit stored on a role that is not limited to a department is ignored.
    const team: CustomRoleDefinition = { ...reviewer, dataScope: 'team' };
    expect(
      grantsForAssignments([{ roleCode: team.code, scopeUnitId: 'sales' }], {
        ...none,
        customRoles: [team],
      })[0],
    ).toEqual({ permission: 'platform.user.read', scope: { type: 'direct_reports' } });
    // The Department Head keeps the units they head (with sub-units), whatever unit is stored.
    expect(
      grantsForAssignments([{ roleCode: 'department_head', scopeUnitId: 'sales' }], context).find(
        (g) => g.permission === 'platform.user.read',
      ),
    ).toEqual({
      permission: 'platform.user.read',
      scope: { type: 'org_units', orgUnitIds: ['headed'], includeDescendants: true },
    });
    expect(scopeNeedsUnit('departments')).toBe(true);
    expect(scopeNeedsUnit('team')).toBe(false);
    expect(scopeNeedsUnit('organization')).toBe(false);
  });

  it('ignores unknown roles: former system roles, deleted custom roles (deny by default)', () => {
    expect(grantsForAssignments([{ roleCode: 'platform_super_admin' }], none)).toEqual([]);
    expect(grantsForAssignments([{ roleCode: 'line_manager' }], none)).toEqual([]);
    expect(grantsForAssignments([{ roleCode: reviewer.code }], none)).toEqual([]);
    expect(
      grantsForAssignments([{ roleCode: 'custom_ffffffffffff' }], {
        ...none,
        customRoles: [reviewer],
      }),
    ).toEqual([]);
    // A permission outside the catalogue in a stored role grants nothing.
    const odd: CustomRoleDefinition = { ...auditor, permissions: ['platform.role.manage'] };
    expect(grantsForAssignments([{ roleCode: odd.code }], { ...none, customRoles: [odd] })).toEqual(
      [],
    );
  });
});

describe('canAssignRole (ADR 0003 §5; PO decisions 5 Oct 2026 and 17 Oct 2026)', () => {
  const subjectOf = (
    aal: 'aal1' | 'aal2',
    customRoles: readonly CustomRoleDefinition[],
    ...assignments: RoleAssignment[]
  ) => ({
    tenantId: 't',
    personId: 'p',
    aal,
    grants: grantsForAssignments(assignments, { ...none, customRoles }),
  });
  const standard = (code: string) => standardAssignableRole(code);

  it('lets the Organization Admin give every role, privileged and custom ones included', () => {
    const admin = subjectOf('aal1', [], { roleCode: 'tenant_admin' });
    for (const code of ['tenant_admin', 'hr_manager', 'department_head', 'learner']) {
      expect(canAssignRole(admin, standard(code))).toBe(true);
    }
    expect(canAssignRole(admin, customAssignableRole(auditor))).toBe(true);
  });

  it('lets an HR Manager give the ordinary roles whose permissions they hold, no privileged one', () => {
    const hr = subjectOf('aal2', [], { roleCode: 'hr_manager' });
    for (const code of ['learner', 'training_manager', 'training_coordinator', 'department_head']) {
      expect(canAssignRole(hr, standard(code))).toBe(true);
    }
    for (const code of ['tenant_admin', 'hr_manager']) {
      expect(canAssignRole(hr, standard(code))).toBe(false);
    }
    // A custom role with a high-risk permission is privileged.
    expect(customAssignableRole(auditor).privileged).toBe(true);
    expect(canAssignRole(hr, customAssignableRole(auditor))).toBe(false);
    // A custom role that manages users or roles is privileged too (PO rule of 5 Oct 2026, review H1):
    // a role copied from the HR Manager, or one that invites people.
    expect(customAssignableRole(reviewer).privileged).toBe(true);
    expect(canAssignRole(hr, customAssignableRole(reviewer))).toBe(false);
    const hrCopy: CustomRoleDefinition = {
      code: 'custom_a00000000005',
      dataScope: 'organization',
      permissions: getSystemRole('hr_manager').grants.map((g) => g.permission.code),
    };
    expect(canAssignRole(hr, customAssignableRole(hrCopy))).toBe(false);
    const admin = subjectOf('aal1', [], { roleCode: 'tenant_admin' });
    expect(canAssignRole(admin, customAssignableRole(hrCopy))).toBe(true);
    // An ordinary custom role whose permissions HR holds…
    const viewer: CustomRoleDefinition = {
      code: 'custom_a00000000006',
      dataScope: 'team',
      permissions: ['platform.user.read', 'platform.org.read'],
    };
    expect(canAssignRole(hr, customAssignableRole(viewer))).toBe(true);
    // …but not one with a permission HR does not hold (nobody gives what they do not hold).
    const profile: CustomRoleDefinition = {
      code: 'custom_a00000000003',
      dataScope: 'organization',
      permissions: ['platform.tenant.read'],
    };
    expect(customAssignableRole(profile).privileged).toBe(false);
    expect(canAssignRole(hr, customAssignableRole(profile))).toBe(false);
  });

  it('lets a custom role with role.assign give only roles within its own organization-wide permissions', () => {
    const clerk: CustomRoleDefinition = {
      code: 'custom_a00000000004',
      dataScope: 'organization',
      permissions: ['platform.role.assign', 'platform.user.read'],
    };
    const subject = subjectOf('aal1', [clerk], { roleCode: clerk.code });
    expect(canAssignRole(subject, standard('learner'))).toBe(true);
    expect(canAssignRole(subject, standard('training_coordinator'))).toBe(false);
    expect(holdsTenantWide(subject, 'platform.user.read')).toBe(true);
    expect(holdsTenantWide(subject, 'platform.role.read')).toBe(false);
  });

  it('ignores expired or not-yet-valid roles of the actor', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const expired = subjectOf('aal2', [], {
      roleCode: 'tenant_admin',
      validUntil: new Date('2026-10-01T00:00:00Z'),
    });
    expect(canAssignRole(expired, standard('learner'), now)).toBe(false);
    const future = subjectOf('aal2', [], {
      roleCode: 'hr_manager',
      validFrom: new Date('2026-11-01T00:00:00Z'),
    });
    expect(canAssignRole(future, standard('learner'), now)).toBe(false);
    expect(holdsTenantWide(future, 'platform.user.read', now)).toBe(false);
  });

  it('refuses members without a role-management permission and unknown roles', () => {
    const plain = subjectOf('aal2', [], { roleCode: 'learner' });
    expect(canAssignRole(plain, standard('learner'))).toBe(false);
    expect(canAssignRole(subjectOf('aal2', [], { roleCode: 'tenant_admin' }), null)).toBe(false);
    expect(standard('platform_super_admin')).toBeNull();
  });
});
