import { describe, expect, it } from 'vitest';
import {
  type SecurityFormValues,
  mfaBecomesStricter,
  parseWhole,
  sameSecurity,
} from './security-form';

const policy: SecurityFormValues = {
  mfaMode: 'required_roles',
  mfaRequiredRoles: ['hr_manager', 'ld_manager'],
  mfaGraceDays: 7,
  mfaPromptAdmins: true,
  passwordMinLength: 12,
  lockoutThreshold: 5,
  lockoutMinutes: 15,
  sessionIdleMinutes: 30,
  sessionMaxHours: 12,
  sessionMaxDevices: 3,
};

describe('security form (redesign package 2)', () => {
  it('reads whole numbers in Western and Arabic digits only', () => {
    expect(parseWhole(' 12 ')).toBe(12);
    expect(parseWhole('١٥')).toBe(15);
    expect(parseWhole('1.5')).toBeNull();
    expect(parseWhole('')).toBeNull();
    expect(parseWhole('12345')).toBeNull();
  });

  it('compares settings, roles in any order', () => {
    expect(sameSecurity(policy, { ...policy })).toBe(true);
    expect(
      sameSecurity(policy, { ...policy, mfaRequiredRoles: ['ld_manager', 'hr_manager'] }),
    ).toBe(true);
    expect(sameSecurity(policy, { ...policy, mfaRequiredRoles: ['hr_manager'] })).toBe(false);
    expect(sameSecurity(policy, { ...policy, lockoutMinutes: 20 })).toBe(false);
  });

  it('confirms only when MFA becomes required where it was not', () => {
    expect(mfaBecomesStricter('off', 'required_all')).toBe(true);
    expect(mfaBecomesStricter('optional', 'required_roles')).toBe(true);
    expect(mfaBecomesStricter('required_roles', 'required_all')).toBe(false);
    expect(mfaBecomesStricter('required_all', 'optional')).toBe(false);
    expect(mfaBecomesStricter('off', 'optional')).toBe(false);
  });
});
