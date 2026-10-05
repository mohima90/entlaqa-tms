import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { platformPermissions } from './platform-permissions';
import { SYSTEM_ROLES, SYSTEM_ROLE_CODES, getSystemRole, isSystemRoleCode } from './system-roles';

const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url).pathname;

/** (code, is_privileged) rows of the ref_roles seed migration. */
function seededRoles(): { code: string; privileged: boolean }[] {
  const file = readdirSync(migrationsDir).find((f) =>
    f.endsWith('_platform__create_ref_roles.sql'),
  );
  if (!file) throw new Error('ref_roles migration not found');
  const text = readFileSync(join(migrationsDir, file), 'utf8');
  return [...text.matchAll(/\('([a-z_]+)', (true|false), \d+\)/g)].map((m) => ({
    code: m[1] ?? '',
    privileged: m[2] === 'true',
  }));
}

describe('system roles (FR-IAM-07, BRD Appendix B)', () => {
  it('has the 14 tenant roles, without the ENTLAQA-only Platform Super Admin', () => {
    expect(SYSTEM_ROLES.map((r) => r.code)).toEqual([...SYSTEM_ROLE_CODES]);
    expect(SYSTEM_ROLES).toHaveLength(14);
    expect(isSystemRoleCode('platform_super_admin')).toBe(false);
  });

  it('matches the database catalogue platform.ref_roles (drift check)', () => {
    expect(seededRoles()).toEqual(
      SYSTEM_ROLES.map((r) => ({ code: r.code, privileged: r.privileged })),
    );
  });

  it('marks exactly the roles only an Organization Admin may give as privileged (PO, 5 Oct 2026)', () => {
    expect(SYSTEM_ROLES.filter((r) => r.privileged).map((r) => r.code)).toEqual([
      'tenant_admin',
      'hr_manager',
      'finance_manager',
      'auditor',
    ]);
  });

  it('names every role in Arabic and English and grants only registered permissions', () => {
    const registered = new Set(Object.keys(platformPermissions));
    for (const role of SYSTEM_ROLES) {
      expect(role.name.ar.trim()).not.toBe('');
      expect(role.name.en.trim()).not.toBe('');
      expect(role.description.ar.trim()).not.toBe('');
      for (const grant of role.grants) expect(registered.has(grant.permission.code)).toBe(true);
    }
  });

  it('gives the Organization Admin every platform permission tenant-wide', () => {
    const admin = getSystemRole('tenant_admin');
    expect(admin.grants.map((g) => g.permission.code).sort()).toEqual(
      Object.keys(platformPermissions).sort(),
    );
    expect(admin.grants.every((g) => g.scope === 'tenant')).toBe(true);
  });

  it('lets only the Organization Admin and the HR Manager manage users and roles', () => {
    const managing = SYSTEM_ROLES.filter((r) =>
      r.grants.some((g) => g.permission.code.startsWith('platform.role.assign')),
    ).map((r) => r.code);
    expect(managing).toEqual(['tenant_admin', 'hr_manager']);
    const hr = getSystemRole('hr_manager').grants.map((g) => g.permission.code);
    expect(hr).toContain('platform.role.assign');
    expect(hr).not.toContain('platform.role.assign_privileged');
  });

  it('gives external instructors and provider staff no organization data (Appendix B)', () => {
    expect(getSystemRole('external_instructor').grants).toEqual([]);
    expect(getSystemRole('provider_admin').grants).toEqual([]);
  });

  it('throws on an unknown code', () => {
    expect(() => getSystemRole('nope' as never)).toThrow('Unknown system role');
  });
});
