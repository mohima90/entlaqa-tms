import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEMBER_GRANTS } from './member-permissions';
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
    // Only the seed migration may write ref_roles; a later change must extend this test.
    const writers = readdirSync(migrationsDir).filter((f) =>
      /(insert into|update|delete from)\s+platform\.ref_roles/i.test(
        readFileSync(join(migrationsDir, f), 'utf8'),
      ),
    );
    expect(writers).toEqual(['20261005100000_platform__create_ref_roles.sql']);
  });

  it('marks exactly the roles only an Organization Admin may give as privileged (PO, 5 Oct 2026)', () => {
    expect(SYSTEM_ROLES.filter((r) => r.privileged).map((r) => r.code)).toEqual([
      'tenant_admin',
      'hr_manager',
      'finance_manager',
      'compliance_officer',
      'auditor',
    ]);
  });

  it('gives the roles an HR Manager may give only reading permissions (allow-list)', () => {
    // Anything new (platform or module permission) fails here until reviewed: a role that can change
    // people, structure, settings or the audit log must be privileged (PO decision 5 Oct 2026).
    const allowed = ['platform.user.read', 'platform.role.read', 'platform.org.read'];
    for (const role of SYSTEM_ROLES.filter((r) => !r.privileged)) {
      for (const grant of role.grants) {
        expect(allowed, `${role.code} grants ${grant.permission.code}`).toContain(
          grant.permission.code,
        );
      }
    }
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

  it('keeps the Organization Admin a setup role: setup permissions only, never module permissions', () => {
    // PO decision 7 Oct 2026 (BRD v2.4 Appendix B): the Organization Admin sets the organization up —
    // settings, branding, users and roles (full people records), security, integrations, audit — and has
    // no core training feature. Every permission it is granted must be on this reviewed allow-list of
    // setup permissions; a module permission (tms.*, M3+) or a new platform permission fails here until
    // it is reviewed. Never add a training permission to this list.
    const SETUP_PERMISSIONS = [
      'platform.user.read',
      'platform.user.invite',
      'platform.user.update',
      'platform.user.deactivate',
      'platform.user.reset_mfa',
      'platform.role.read',
      'platform.role.assign',
      'platform.role.assign_privileged',
      'platform.org.read',
      'platform.org.manage',
      'platform.tenant.read',
      'platform.tenant.manage',
      'platform.security.manage',
      'platform.audit.read',
    ];
    const admin = getSystemRole('tenant_admin');
    for (const grant of admin.grants) {
      expect(grant.permission.code.startsWith('platform.'), grant.permission.code).toBe(true);
      expect(SETUP_PERMISSIONS, grant.permission.code).toContain(grant.permission.code);
    }
    // Member-wide grants reach the Organization Admin too: they stay limited to one's own profile.
    expect(MEMBER_GRANTS.map((g) => g.permission)).toEqual(['platform.profile.manage_own']);
    // The description says so, in both languages.
    expect(admin.description.en).toContain('No access to training features');
    expect(admin.description.ar).toContain('دون الوصول إلى ميزات التدريب');
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
