import { describe, expect, it } from 'vitest';
import {
  blockedBySole,
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

describe('blockedBySole (BR-IAM-4: the Organization Admin holds no other role)', () => {
  const sole = ['tenant_admin'];
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

  it('the Organization Admin as primary blocks every additional role', () => {
    const admin = state('tenant_admin');
    for (const code of ['hr_manager', 'learner', 'training_manager', 'auditor']) {
      expect(blockedBySole(code, 'additional', admin, sole, TODAY), code).toBe(true);
    }
    // Choosing another primary role replaces the admin role: allowed.
    expect(blockedBySole('learner', 'primary', admin, sole, TODAY)).toBe(false);
  });

  it('any other role chosen blocks the Organization Admin, unless it has ended', () => {
    const learner = state('learner');
    expect(blockedBySole('tenant_admin', 'additional', learner, sole, TODAY)).toBe(true);
    // As primary it would replace the learner role: allowed while no additional role is held.
    expect(blockedBySole('tenant_admin', 'primary', learner, sole, TODAY)).toBe(false);
    const withHr = state('learner', { hr_manager: ['', ''] });
    expect(blockedBySole('tenant_admin', 'primary', withHr, sole, TODAY)).toBe(true);
    expect(blockedBySole('tenant_admin', 'additional', withHr, sole, TODAY)).toBe(true);
    // Ends today: still held today. Ended yesterday: history.
    const endsToday = state('tenant_admin', { learner: ['', TODAY] });
    expect(blockedBySole('tenant_admin', 'primary', endsToday, sole, TODAY)).toBe(false);
    expect(
      blockedBySole(
        'tenant_admin',
        'primary',
        state('hr_manager', { learner: ['', TODAY] }),
        sole,
        TODAY,
      ),
    ).toBe(true);
    const ended = state('hr_manager', { learner: ['', '2026-10-06'] });
    expect(blockedBySole('tenant_admin', 'primary', ended, sole, TODAY)).toBe(false);
  });

  it('never blocks a chosen role; other roles combine freely', () => {
    const both = state('learner', { tenant_admin: ['', ''], hr_manager: ['', ''] });
    expect(blockedBySole('tenant_admin', 'additional', both, sole, TODAY)).toBe(false);
    expect(blockedBySole('learner', 'primary', both, sole, TODAY)).toBe(false);
    const hr = state('hr_manager', { learner: ['', ''] });
    expect(blockedBySole('auditor', 'additional', hr, sole, TODAY)).toBe(false);
    expect(blockedBySole('training_manager', 'primary', hr, sole, TODAY)).toBe(false);
  });
});
