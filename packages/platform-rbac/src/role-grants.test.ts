import { describe, expect, it } from 'vitest';
import { type RoleAssignment, canAssignRole, grantsForAssignments } from './role-grants';

const none = { headedDepartmentIds: [] };

describe('grantsForAssignments', () => {
  it('is the union of the roles’ grants with their scopes and validity windows', () => {
    const until = new Date('2027-01-01T00:00:00Z');
    expect(
      grantsForAssignments(
        [{ roleCode: 'learner' }, { roleCode: 'line_manager', validUntil: until }],
        none,
      ),
    ).toEqual([
      { permission: 'platform.user.read', scope: { type: 'own' } },
      { permission: 'platform.user.read', scope: { type: 'direct_reports' }, validUntil: until },
      { permission: 'platform.role.read', scope: { type: 'direct_reports' }, validUntil: until },
      { permission: 'platform.org.read', scope: { type: 'tenant' }, validUntil: until },
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

  it('ignores unknown role codes (deny by default)', () => {
    expect(grantsForAssignments([{ roleCode: 'platform_super_admin' }], none)).toEqual([]);
  });
});

describe('canAssignRole (ADR 0003 §5, PO decision 5 Oct 2026)', () => {
  const subjectOf = (aal: 'aal1' | 'aal2', ...assignments: RoleAssignment[]) => ({
    tenantId: 't',
    personId: 'p',
    aal,
    grants: grantsForAssignments(assignments, none),
  });

  it('lets an Organization Admin at AAL2 give every role', () => {
    const admin = subjectOf('aal2', { roleCode: 'tenant_admin' });
    for (const code of ['tenant_admin', 'hr_manager', 'auditor', 'compliance_officer', 'learner']) {
      expect(canAssignRole(admin, code)).toBe(true);
    }
  });

  it('needs the AAL2 step-up for privileged roles, not for ordinary ones', () => {
    const admin = subjectOf('aal1', { roleCode: 'tenant_admin' });
    expect(canAssignRole(admin, 'hr_manager')).toBe(false);
    expect(canAssignRole(admin, 'learner')).toBe(true);
  });

  it('lets an HR Manager give every non-privileged role, and no privileged one', () => {
    const hr = subjectOf('aal2', { roleCode: 'hr_manager' }, { roleCode: 'learner' });
    for (const code of [
      'learner',
      'training_manager',
      'training_coordinator',
      'department_head',
      'mentor',
    ]) {
      expect(canAssignRole(hr, code)).toBe(true);
    }
    for (const code of [
      'tenant_admin',
      'hr_manager',
      'finance_manager',
      'compliance_officer',
      'auditor',
    ]) {
      expect(canAssignRole(hr, code)).toBe(false);
    }
  });

  it('ignores expired or not-yet-valid roles of the actor', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const expired = subjectOf('aal2', {
      roleCode: 'tenant_admin',
      validUntil: new Date('2026-10-01T00:00:00Z'),
    });
    expect(canAssignRole(expired, 'learner', now)).toBe(false);
    const future = subjectOf('aal2', {
      roleCode: 'hr_manager',
      validFrom: new Date('2026-11-01T00:00:00Z'),
    });
    expect(canAssignRole(future, 'learner', now)).toBe(false);
  });

  it('refuses members without a role-management permission and unknown roles', () => {
    const plain = subjectOf('aal2', { roleCode: 'learner' }, { roleCode: 'line_manager' });
    expect(canAssignRole(plain, 'learner')).toBe(false);
    expect(
      canAssignRole(subjectOf('aal2', { roleCode: 'tenant_admin' }), 'platform_super_admin'),
    ).toBe(false);
  });
});
