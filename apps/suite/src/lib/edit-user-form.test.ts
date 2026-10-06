import { describe, expect, it } from 'vitest';
import { editFieldErrorKey, managersFor } from './edit-user-form';

const managers = [
  { personId: 'm1', name: 'A', active: true, departmentIds: ['d1'] },
  { personId: 'm2', name: 'B', active: true, departmentIds: ['d2'] },
  { personId: 'm3', name: 'C', active: false, departmentIds: [] },
];

describe('managersFor', () => {
  it('offers the department managers, keeps the selected one, or all on request', () => {
    expect(managersFor(managers, 'd1', false, '').map((m) => m.personId)).toEqual(['m1']);
    expect(managersFor(managers, 'd1', false, 'm3').map((m) => m.personId)).toEqual(['m1', 'm3']);
    expect(managersFor(managers, 'd1', true, '')).toHaveLength(3);
    expect(managersFor(managers, '', false, '')).toHaveLength(3);
  });
});

describe('editFieldErrorKey', () => {
  it('maps field error codes to texts', () => {
    expect(editFieldErrorKey('email', 'TAKEN')).toBe('emailTaken');
    expect(editFieldErrorKey('email', 'INVALID_FORMAT')).toBe('email');
    expect(editFieldErrorKey('employeeNumber', 'TAKEN')).toBe('employeeNumberTaken');
    expect(editFieldErrorKey('employeeNumber', 'TOO_BIG')).toBe('employeeNumber');
    expect(editFieldErrorKey('managerPersonId', 'LOOP')).toBe('managerLoop');
    expect(editFieldErrorKey('managerPersonId', 'INACTIVE')).toBe('managerInactive');
    expect(editFieldErrorKey('managerPersonId', 'CUSTOM')).toBe('managerSelf');
    expect(editFieldErrorKey('departmentId', 'DELETED')).toBe('unitDeleted');
    expect(editFieldErrorKey('branchId', 'INVALID_FORMAT')).toBe('unit');
    expect(editFieldErrorKey('jobTitleEn', 'TOO_BIG')).toBe('jobTitle');
    expect(editFieldErrorKey('hireOn', 'INVALID_FORMAT')).toBe('hireOn');
    expect(editFieldErrorKey('mobile', 'CUSTOM')).toBe('mobile');
    expect(editFieldErrorKey('familyNameAr', 'TOO_BIG')).toBe('name');
  });
});
