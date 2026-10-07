import { describe, expect, it } from 'vitest';
import {
  COMMON_ROLE_CODES,
  type RoleChoice,
  canResend,
  choosesPrivileged,
  blockedBySole,
  inviteFieldError,
  lockedRoleCodes,
  rolesShown,
} from './invite-form';

const role = (code: string, privileged = false): RoleChoice => ({
  code,
  name: code,
  description: '',
  privileged,
});
const catalogue = [
  role('tenant_admin', true),
  role('training_manager'),
  role('training_coordinator'),
  role('hr_manager', true),
  role('finance_manager', true),
  role('line_manager'),
  role('mentor'),
  role('learner'),
  role('auditor', true),
];

describe('roles offered', () => {
  it('common roles first in screen order; the rest only on request', () => {
    expect(rolesShown(catalogue, false).map((r) => r.code)).toEqual(COMMON_ROLE_CODES);
    expect(rolesShown(catalogue, true).map((r) => r.code)).toEqual([
      ...COMMON_ROLE_CODES,
      'finance_manager',
      'mentor',
      'auditor',
    ]);
  });

  it('privileged roles are locked unless allowed, and pick the privileged action', () => {
    expect([...lockedRoleCodes(catalogue, false)]).toEqual([
      'tenant_admin',
      'hr_manager',
      'finance_manager',
      'auditor',
    ]);
    expect(lockedRoleCodes(catalogue, true).size).toBe(0);
    expect(choosesPrivileged(catalogue, 'learner', ['mentor'])).toBe(false);
    expect(choosesPrivileged(catalogue, 'learner', ['auditor'])).toBe(true);
    expect(choosesPrivileged(catalogue, 'tenant_admin', [])).toBe(true);
  });
});

describe('inviteFieldError', () => {
  it('maps field errors to the field and its text', () => {
    const cases: [string, string, string, string][] = [
      ['email', 'EMAIL_TAKEN', 'email', 'emailTaken'],
      ['email', 'INVALID_FORMAT', 'email', 'email'],
      ['firstNameAr', 'TOO_SMALL', 'firstNameAr', 'required'],
      ['familyNameAr', 'CUSTOM', 'familyNameAr', 'name'],
      ['firstNameEn', 'TOO_BIG', 'firstNameEn', 'name'],
      ['employeeNumber', 'EMPLOYEE_NUMBER_TAKEN', 'employeeNumber', 'employeeNumberTaken'],
      ['employeeNumber', 'CUSTOM', 'employeeNumber', 'employeeNumber'],
      ['primaryRole', 'ROLE_NOT_ALLOWED', 'primaryRole', 'roleNotAllowed'],
      ['primaryRole', 'INVALID_VALUE', 'primaryRole', 'roleRequired'],
      ['additionalRoles', 'ROLE_NOT_ALLOWED', 'additionalRoles', 'roleNotAllowed'],
      ['additionalRoles', 'ROLE_CONFLICT', 'additionalRoles', 'roleConflict'],
      ['primaryRole', 'ROLE_CONFLICT', 'primaryRole', 'roleConflict'],
      ['additionalRoles.1', 'CUSTOM', 'additionalRoles', 'roles'],
      ['departmentId', 'INVALID_UNION', 'departmentId', 'unit'],
      ['branchId', 'INVALID_UNION', 'branchId', 'unit'],
      ['managerPersonId', 'INVALID_UNION', 'managerPersonId', 'manager'],
      ['locale', 'INVALID_VALUE', 'locale', 'name'],
    ];
    for (const [path, code, field, key] of cases) {
      expect(inviteFieldError(path, code), `${path} ${code}`).toEqual({ field, key });
    }
  });
});

describe('blockedBySole (BR-IAM-4: the Organization Admin holds no other role)', () => {
  const sole = ['tenant_admin'];
  it('the Organization Admin blocks every other role, and any other role blocks it', () => {
    // Organization Admin as primary: no additional role; the radio buttons stay usable (replace).
    for (const code of ['hr_manager', 'learner', 'auditor']) {
      expect(blockedBySole(code, 'additional', 'tenant_admin', [], sole), code).toBe(true);
      expect(blockedBySole(code, 'primary', 'tenant_admin', [], sole), code).toBe(false);
    }
    // Another primary role: the admin cannot be added; as primary it replaces it (allowed).
    expect(blockedBySole('tenant_admin', 'additional', 'learner', [], sole)).toBe(true);
    expect(blockedBySole('tenant_admin', 'primary', 'learner', [], sole)).toBe(false);
    // An additional role chosen: the admin can be neither primary nor additional.
    expect(blockedBySole('tenant_admin', 'primary', 'learner', ['hr_manager'], sole)).toBe(true);
    expect(blockedBySole('tenant_admin', 'primary', '', ['mentor'], sole)).toBe(true);
    expect(blockedBySole('tenant_admin', 'additional', '', [], sole)).toBe(false);
  });

  it('never blocks a chosen role; other roles combine freely', () => {
    expect(blockedBySole('tenant_admin', 'additional', 'hr_manager', ['tenant_admin'], sole)).toBe(
      false,
    );
    expect(blockedBySole('auditor', 'additional', 'hr_manager', ['learner'], sole)).toBe(false);
    expect(blockedBySole('hr_manager', 'primary', 'learner', ['mentor'], sole)).toBe(false);
  });
});

describe('canResend', () => {
  it('pending or expired invitations until the fourth e-mail', () => {
    expect(canResend({ state: 'pending', sendCount: 0 })).toBe(true);
    expect(canResend({ state: 'expired', sendCount: 3 })).toBe(true);
    expect(canResend({ state: 'pending', sendCount: 4 })).toBe(false);
    expect(canResend({ state: 'revoked', sendCount: 1 })).toBe(false);
    expect(canResend({ state: 'accepted', sendCount: 1 })).toBe(false);
  });
});
