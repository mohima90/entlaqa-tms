import { describe, expect, it } from 'vitest';
import {
  desiredRoles,
  formStateFromRoles,
  lockedRoles,
  touchesPrivileged,
} from './edit-roles-form';

const catalogue = [
  { code: 'tenant_admin', name: 'A', description: '', privileged: true },
  { code: 'training_coordinator', name: 'C', description: '', privileged: false },
  { code: 'learner', name: 'L', description: '', privileged: false },
  { code: 'auditor', name: 'U', description: '', privileged: true },
];
const roles = [
  { roleCode: 'training_coordinator', isPrimary: true, validFrom: null, validUntil: null },
  { roleCode: 'learner', isPrimary: false, validFrom: null, validUntil: '2026-12-31' },
];

describe('roles form', () => {
  it('round-trips the stored roles; the primary is never also additional', () => {
    const state = formStateFromRoles(roles);
    expect(state).toEqual({
      primary: 'training_coordinator',
      additional: { learner: { validFrom: '', validUntil: '2026-12-31' } },
    });
    expect(desiredRoles(state, catalogue)).toEqual(roles);
    expect(
      desiredRoles({ ...state, primary: 'learner' }, catalogue).map((r) => r.roleCode),
    ).toEqual(['learner']);
    expect(formStateFromRoles([]).primary).toBe('');
  });

  it('detects privileged changes and locks privileged roles unless allowed', () => {
    const privileged = new Set(['tenant_admin', 'auditor']);
    expect(touchesPrivileged(roles, roles, privileged)).toBe(false);
    expect(
      touchesPrivileged(
        roles,
        [...roles, { roleCode: 'auditor', isPrimary: false, validFrom: null, validUntil: null }],
        privileged,
      ),
    ).toBe(true);
    expect([...lockedRoles(catalogue, false)]).toEqual(['tenant_admin', 'auditor']);
    expect(lockedRoles(catalogue, true).size).toBe(0);
  });
});
