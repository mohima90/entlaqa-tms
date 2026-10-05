import { describe, expect, it } from 'vitest';
import type { Grant } from './authorize';
import { canAssignRole, grantsForAssignments } from './role-grants';

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
  const grantsOf = (...roleCodes: string[]): Grant[] =>
    grantsForAssignments(
      roleCodes.map((roleCode) => ({ roleCode })),
      none,
    );

  it('lets an Organization Admin give every role', () => {
    const admin = grantsOf('tenant_admin');
    for (const code of ['tenant_admin', 'hr_manager', 'auditor', 'learner', 'line_manager']) {
      expect(canAssignRole(admin, code)).toBe(true);
    }
  });

  it('lets an HR Manager give ordinary roles only', () => {
    const hr = grantsOf('hr_manager', 'learner');
    expect(canAssignRole(hr, 'learner')).toBe(true);
    expect(canAssignRole(hr, 'training_coordinator')).toBe(true);
    expect(canAssignRole(hr, 'department_head')).toBe(true);
    expect(canAssignRole(hr, 'tenant_admin')).toBe(false);
    expect(canAssignRole(hr, 'hr_manager')).toBe(false);
    expect(canAssignRole(hr, 'auditor')).toBe(false);
  });

  it('refuses a role whose permissions the actor does not hold tenant-wide (no escalation)', () => {
    const hrWithoutTenantRead: Grant[] = grantsOf('hr_manager').filter(
      (g) => g.permission !== 'platform.org.read',
    );
    expect(canAssignRole(hrWithoutTenantRead, 'training_manager')).toBe(false);
    expect(canAssignRole(grantsOf('hr_manager'), 'compliance_officer')).toBe(false); // audit.read
  });

  it('refuses members without a role-management permission and unknown roles', () => {
    expect(canAssignRole(grantsOf('learner', 'line_manager'), 'learner')).toBe(false);
    expect(canAssignRole(grantsOf('tenant_admin'), 'platform_super_admin')).toBe(false);
    expect(canAssignRole([], 'learner')).toBe(false);
  });
});
