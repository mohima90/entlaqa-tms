import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SOLE_ROLE_CODES,
  includesConflictingRoles,
  rolesConflict,
  rolesHeldTogether,
} from './separation-of-duties';
import { SYSTEM_ROLE_CODES } from './system-roles';

const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url).pathname;
const DEFINITION = 'create or replace function private.roles_conflict(';

/** Body of the latest definition of private.roles_conflict in the migrations. */
function migrationRule(): string {
  const files = readdirSync(migrationsDir)
    .sort()
    .filter((f) => readFileSync(join(migrationsDir, f), 'utf8').includes(DEFINITION));
  const last = files.at(-1);
  if (!last) throw new Error('private.roles_conflict not found');
  const text = readFileSync(join(migrationsDir, last), 'utf8');
  const body = text.slice(text.indexOf(DEFINITION));
  const start = body.indexOf('$$');
  return body.slice(start + 2, body.indexOf('$$', start + 2));
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

describe('separation of duties (BR-IAM-4, PO 7–8 Oct 2026)', () => {
  it('the Organization Admin is the only role held alone, as in the database (drift check)', () => {
    expect(SOLE_ROLE_CODES).toEqual(['tenant_admin']);
    for (const code of SOLE_ROLE_CODES) expect(SYSTEM_ROLE_CODES).toContain(code);
    // private.roles_conflict names exactly these roles, and states "different roles, one of them sole".
    const rule = migrationRule();
    expect([...rule.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...SOLE_ROLE_CODES]);
    expect(rule.replace(/\s+/g, ' ').trim()).toBe(
      "select p_role_a is distinct from p_role_b and 'tenant_admin' in (p_role_a, p_role_b);",
    );
  });

  it('tenant_admin conflicts with every other role; other roles combine freely', () => {
    for (const code of SYSTEM_ROLE_CODES) {
      expect(rolesConflict('tenant_admin', code), code).toBe(code !== 'tenant_admin');
      expect(rolesConflict(code, 'tenant_admin'), code).toBe(code !== 'tenant_admin');
      for (const other of SYSTEM_ROLE_CODES) {
        if (code !== 'tenant_admin' && other !== 'tenant_admin') {
          expect(rolesConflict(code, other), `${code}/${other}`).toBe(false);
        }
      }
    }
  });

  it('finds conflicting roles among an invitation’s roles', () => {
    expect(includesConflictingRoles(['tenant_admin', 'hr_manager'])).toBe(true);
    expect(includesConflictingRoles(['tenant_admin', 'learner'])).toBe(true);
    expect(includesConflictingRoles(['hr_manager', 'learner', 'tenant_admin'])).toBe(true);
    expect(includesConflictingRoles(['tenant_admin'])).toBe(false);
    expect(includesConflictingRoles(['hr_manager', 'learner', 'compliance_officer'])).toBe(false);
    expect(includesConflictingRoles([])).toBe(false);
  });

  it('roles held together from today on: open, dated, scheduled hand-over, ended', () => {
    expect(rolesHeldTogether([role('tenant_admin'), role('learner')], TODAY)).toBe(true);
    expect(rolesHeldTogether([role('training_manager'), role('tenant_admin')], TODAY)).toBe(true);
    expect(rolesHeldTogether([role('hr_manager'), role('learner')], TODAY)).toBe(false);
    expect(rolesHeldTogether([role('tenant_admin')], TODAY)).toBe(false);
    // Later: both held from the first of next year.
    expect(rolesHeldTogether([role('tenant_admin'), role('learner', '2027-01-01')], TODAY)).toBe(
      true,
    );
    // A scheduled hand-over: admin until 31 October, the other roles from 1 November.
    expect(
      rolesHeldTogether(
        [
          role('tenant_admin', null, '2026-10-31'),
          role('learner', '2026-11-01'),
          role('hr_manager', '2026-11-01'),
        ],
        TODAY,
      ),
    ).toBe(false);
    // One day together (the last day is inclusive).
    expect(
      rolesHeldTogether(
        [role('tenant_admin', null, '2026-11-01'), role('learner', '2026-11-01')],
        TODAY,
      ),
    ).toBe(true);
    // Today is the admin's last day: still held together today.
    expect(rolesHeldTogether([role('tenant_admin', null, TODAY), role('learner')], TODAY)).toBe(
      true,
    );
    // An ended role is history.
    expect(
      rolesHeldTogether([role('tenant_admin', '2025-01-01', '2026-10-06'), role('learner')], TODAY),
    ).toBe(false);
    // Two windows that are both over by the time they would meet.
    expect(
      rolesHeldTogether(
        [role('tenant_admin', null, '2026-12-31'), role('learner', '2027-01-01', '2027-06-30')],
        TODAY,
      ),
    ).toBe(false);
  });
});
