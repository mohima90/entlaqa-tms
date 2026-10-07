import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXCLUSIVE_ROLES_BY_CODE,
  EXCLUSIVE_ROLE_PAIRS,
  exclusiveRoleOf,
  includesExclusivePair,
  rolesHeldTogether,
} from './separation-of-duties';
import { SYSTEM_ROLE_CODES } from './system-roles';

const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url).pathname;

/** Pairs of the latest definition of private.exclusive_role in the migrations. */
function migrationPairs(): string[][] {
  const files = readdirSync(migrationsDir)
    .sort()
    .filter((f) =>
      readFileSync(join(migrationsDir, f), 'utf8').includes(
        'create or replace function private.exclusive_role(',
      ),
    );
  const last = files.at(-1);
  if (!last) throw new Error('private.exclusive_role not found');
  const text = readFileSync(join(migrationsDir, last), 'utf8');
  const body = text.slice(text.indexOf('create or replace function private.exclusive_role('));
  const cases = [
    ...body.slice(0, body.indexOf('$$;')).matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g),
  ];
  return cases.map((m) => [m[1] ?? '', m[2] ?? '']);
}

const role = (
  roleCode: string,
  validFrom: string | null = null,
  validUntil: string | null = null,
) => ({
  roleCode,
  validFrom,
  validUntil,
});
const TODAY = '2026-10-07';

describe('separation of duties (BR-IAM-4, PO 7 Oct 2026)', () => {
  it('pairs the Organization Admin with the HR Manager, as the database does (drift check)', () => {
    expect(EXCLUSIVE_ROLE_PAIRS).toEqual([['tenant_admin', 'hr_manager']]);
    for (const pair of EXCLUSIVE_ROLE_PAIRS) {
      for (const code of pair) expect(SYSTEM_ROLE_CODES).toContain(code);
    }
    // private.exclusive_role maps each role of a pair to the other, both ways.
    expect(migrationPairs().sort()).toEqual(
      EXCLUSIVE_ROLE_PAIRS.flatMap(([a, b]) => [
        [a, b],
        [b, a],
      ]).sort(),
    );
  });

  it('names the other role of a pair', () => {
    expect(exclusiveRoleOf('tenant_admin')).toBe('hr_manager');
    expect(exclusiveRoleOf('hr_manager')).toBe('tenant_admin');
    expect(exclusiveRoleOf('auditor')).toBeNull();
    expect(exclusiveRoleOf('nope')).toBeNull();
    expect(exclusiveRoleOf('toString')).toBeNull();
    expect(EXCLUSIVE_ROLES_BY_CODE).toEqual({
      tenant_admin: 'hr_manager',
      hr_manager: 'tenant_admin',
    });
  });

  it('finds both roles of a pair among an invitation’s roles', () => {
    expect(includesExclusivePair(['tenant_admin', 'hr_manager'])).toBe(true);
    expect(includesExclusivePair(['hr_manager', 'learner', 'tenant_admin'])).toBe(true);
    expect(includesExclusivePair(['tenant_admin', 'finance_manager', 'auditor'])).toBe(false);
    expect(includesExclusivePair(['hr_manager', 'compliance_officer'])).toBe(false);
    expect(includesExclusivePair([])).toBe(false);
  });

  it('roles held together from today on: open, dated, scheduled hand-over, ended', () => {
    expect(rolesHeldTogether([role('tenant_admin'), role('hr_manager')], TODAY)).toBe(true);
    expect(rolesHeldTogether([role('hr_manager'), role('learner')], TODAY)).toBe(false);
    // Later: both held from the first of next year.
    expect(rolesHeldTogether([role('tenant_admin'), role('hr_manager', '2027-01-01')], TODAY)).toBe(
      true,
    );
    // A scheduled hand-over: admin until 31 October, HR Manager from 1 November.
    expect(
      rolesHeldTogether(
        [role('tenant_admin', null, '2026-10-31'), role('hr_manager', '2026-11-01')],
        TODAY,
      ),
    ).toBe(false);
    // One day together (the last day is inclusive).
    expect(
      rolesHeldTogether(
        [role('tenant_admin', null, '2026-11-01'), role('hr_manager', '2026-11-01')],
        TODAY,
      ),
    ).toBe(true);
    // Today is the admin's last day: still held together today.
    expect(rolesHeldTogether([role('tenant_admin', null, TODAY), role('hr_manager')], TODAY)).toBe(
      true,
    );
    // An ended role is history.
    expect(
      rolesHeldTogether(
        [role('tenant_admin', '2025-01-01', '2026-10-06'), role('hr_manager')],
        TODAY,
      ),
    ).toBe(false);
    // Two windows that are both over by the time they would meet.
    expect(
      rolesHeldTogether(
        [role('tenant_admin', null, '2026-12-31'), role('hr_manager', '2027-01-01', '2027-06-30')],
        TODAY,
      ),
    ).toBe(false);
  });
});
