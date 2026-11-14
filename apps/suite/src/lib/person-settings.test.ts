import { describe, expect, it } from 'vitest';
import {
  type PersonFormState,
  changedKeys,
  editRedirectTab,
  personVersionNumber,
} from './person-settings';

const state: PersonFormState = {
  firstNameAr: '',
  fatherNameAr: '',
  grandfatherNameAr: '',
  familyNameAr: '',
  firstNameEn: 'Sarah',
  fatherNameEn: '',
  grandfatherNameEn: '',
  familyNameEn: 'Alqahtani',
  email: '',
  mobile: '',
  preferredLocale: 'en',
  employeeNumber: 'EMP-1',
  hireOn: '',
  jobTitleAr: '',
  jobTitleEn: '',
  departmentId: '',
  branchId: '',
  costCentreId: '',
  managerPersonId: '',
  gradeId: '',
  gender: '',
  birthDate: '',
  category: '',
};

describe('person settings (WP-UX-01 e)', () => {
  it('the old edit address leads to the asked section, else «Personal details»', () => {
    expect(editRedirectTab(undefined)).toBe('personal');
    expect(editRedirectTab('work')).toBe('work');
    expect(editRedirectTab(['work', 'personal'])).toBe('work');
    expect(editRedirectTab('security')).toBe('personal');
  });

  it('names the changed fields only', () => {
    expect(changedKeys(state, state)).toEqual([]);
    expect(changedKeys(state, { ...state, employeeNumber: 'EMP-2', gradeId: 'g' })).toEqual([
      'employeeNumber',
      'gradeId',
    ]);
  });

  it('the version token grows with either counter', () => {
    expect(personVersionNumber('4:2')).toBe(6);
    expect(personVersionNumber('5:2')).toBeGreaterThan(personVersionNumber('4:2'));
    expect(personVersionNumber('4:3')).toBeGreaterThan(personVersionNumber('4:2'));
    expect(personVersionNumber('x')).toBe(0);
  });
});
