import { describe, expect, it } from 'vitest';
import { canResend, createdName, inviteFieldError } from './invite-form';

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
      ['role', 'ROLE_NOT_ALLOWED', 'role', 'roleNotAllowed'],
      ['role', 'ROLE_CONFLICT', 'role', 'roleNotAllowed'],
      ['role', 'ROLE_UNKNOWN', 'role', 'roleUnknown'],
      ['role', 'INVALID_FORMAT', 'role', 'roleRequired'],
      ['departmentId', 'INVALID_UNION', 'departmentId', 'unit'],
      ['branchId', 'INVALID_UNION', 'branchId', 'unit'],
      ['managerPersonId', 'INVALID_UNION', 'managerPersonId', 'manager'],
      // The unit of a department-limited custom role (EP-ORG, T-M3-09).
      ['scopeUnitId', 'UNIT_REQUIRED', 'scopeUnitId', 'unitRequired'],
      ['scopeUnitId', 'UNIT_NOT_ALLOWED', 'scopeUnitId', 'unitNotAllowed'],
      ['locale', 'INVALID_VALUE', 'locale', 'name'],
    ];
    for (const [path, code, field, key] of cases) {
      expect(inviteFieldError(path, code), `${path} ${code}`).toEqual({ field, key });
    }
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

describe('inviteFieldError: the required names of the default language', () => {
  it('maps REQUIRED on any name field to “required”', () => {
    expect(inviteFieldError('firstNameEn', 'REQUIRED')).toEqual({
      field: 'firstNameEn',
      key: 'required',
    });
    expect(inviteFieldError('familyNameAr', 'REQUIRED')).toEqual({
      field: 'familyNameAr',
      key: 'required',
    });
    expect(inviteFieldError('familyNameEn', 'TOO_BIG')).toEqual({
      field: 'familyNameEn',
      key: 'name',
    });
  });
});

describe('createdName (the success panel, review L4)', () => {
  it('names the invitee in the page language: English when given, else Arabic', () => {
    const names = { ar: [' نورة ', 'الدوسري'], en: ['Noura', ' Aldossari '] };
    expect(createdName('en', names)).toBe('Noura Aldossari');
    expect(createdName('ar', names)).toBe('نورة الدوسري');
    expect(createdName('en', { ar: ['نورة', 'الدوسري'], en: ['', ' '] })).toBe('نورة الدوسري');
    expect(createdName('en', { ar: ['نورة', 'الدوسري'], en: ['Noura', ''] })).toBe('Noura');
    // English-only names (PO 17 Oct 2026): the Arabic page shows the English name.
    expect(createdName('ar', { ar: ['', ''], en: ['Noura', 'Aldossari'] })).toBe('Noura Aldossari');
  });
});
