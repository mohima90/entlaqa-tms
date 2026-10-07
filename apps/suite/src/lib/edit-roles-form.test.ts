import { describe, expect, it } from 'vitest';
import {
  blockedByPair,
  desiredRoles,
  formStateFromRoles,
  lockedRoles,
  roleTiming,
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
    // A primary role that stays primary keeps its days; another primary has none.
    const dated = [
      {
        roleCode: 'training_coordinator',
        isPrimary: true,
        validFrom: null,
        validUntil: '2026-01-31',
      },
      { roleCode: 'learner', isPrimary: false, validFrom: null, validUntil: '2026-12-31' },
    ];
    expect(desiredRoles(formStateFromRoles(dated), catalogue, dated)[0]?.validUntil).toBe(
      '2026-01-31',
    );
    expect(
      desiredRoles({ ...formStateFromRoles(dated), primary: 'learner' }, catalogue, dated)[0]
        ?.validUntil,
    ).toBe('2026-12-31');
    expect(
      desiredRoles({ ...formStateFromRoles(dated), primary: 'auditor' }, catalogue, dated)[0]
        ?.validUntil,
    ).toBeNull();
  });

  it('tells ended and scheduled roles from current ones', () => {
    expect(roleTiming(null, '2026-10-05', '2026-10-06')).toBe('ended');
    expect(roleTiming(null, '2026-10-06', '2026-10-06')).toBe('current');
    expect(roleTiming('2026-10-07', null, '2026-10-06')).toBe('scheduled');
    expect(roleTiming(null, null, '2026-10-06')).toBe('current');
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

describe('blockedByPair (BR-IAM-4)', () => {
  const pairs = { tenant_admin: 'hr_manager', hr_manager: 'tenant_admin' };
  const TODAY = '2026-10-07';
  const state = (primary: string, additional: Record<string, [string, string]> = {}) => ({
    primary,
    additional: Object.fromEntries(
      Object.entries(additional).map(([code, [validFrom, validUntil]]) => [
        code,
        { validFrom, validUntil },
      ]),
    ),
  });

  it('blocks the other role of a chosen pair, unless that one has ended', () => {
    const admin = state('tenant_admin');
    expect(blockedByPair('hr_manager', 'additional', admin, pairs, TODAY)).toBe(true);
    // Choosing HR Manager as the primary role replaces the admin role: allowed.
    expect(blockedByPair('hr_manager', 'primary', admin, pairs, TODAY)).toBe(false);
    const hrAdditional = state('learner', { hr_manager: ['', ''] });
    expect(blockedByPair('tenant_admin', 'primary', hrAdditional, pairs, TODAY)).toBe(true);
    expect(blockedByPair('tenant_admin', 'additional', hrAdditional, pairs, TODAY)).toBe(true);
    // Ends today: still held today. Ended yesterday: history.
    const endsToday = state('learner', { hr_manager: ['', TODAY] });
    expect(blockedByPair('tenant_admin', 'additional', endsToday, pairs, TODAY)).toBe(true);
    const ended = state('learner', { hr_manager: ['', '2026-10-06'] });
    expect(blockedByPair('tenant_admin', 'additional', ended, pairs, TODAY)).toBe(false);
  });

  it('never blocks a chosen role or a role outside the pairs', () => {
    const both = state('learner', { hr_manager: ['', ''], tenant_admin: ['', ''] });
    expect(blockedByPair('tenant_admin', 'additional', both, pairs, TODAY)).toBe(false);
    expect(blockedByPair('learner', 'primary', both, pairs, TODAY)).toBe(false);
    expect(blockedByPair('auditor', 'additional', state('tenant_admin'), pairs, TODAY)).toBe(false);
  });
});
