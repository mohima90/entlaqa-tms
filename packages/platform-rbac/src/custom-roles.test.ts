import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_PERMISSIONS,
  CUSTOM_ROLE_PERMISSIONS,
  CUSTOM_ROLE_SCOPE_MAP,
  PERMISSION_GROUPS,
  PERMISSION_GROUP_NAMES,
  customRoleGrantScope,
  customRoleIsPrivileged,
  customRolePermission,
  permissionMakesPrivileged,
  customRolePermissionProblems,
  isCustomRoleCode,
  standardRoleScope,
} from './custom-roles';
import { platformPermissions, tmsRolePermissions } from './platform-permissions';
import { ROLE_TEMPLATES, roleStartValues } from './role-templates';
import { SYSTEM_ROLES, getSystemRole } from './system-roles';

const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url).pathname;

/**
 * Every migration that writes the permission catalogue or the standard roles' grants: the EP-ROLES seed and
 * the later migrations that add module permissions (insert-only; a migration that updates or deletes
 * catalogue rows must extend these parsers — the writers check below fails until it does).
 */
function catalogueMigrations(table: 'ref_permissions' | 'ref_role_permissions'): string[] {
  const writes = new RegExp(`insert into platform\\.${table}\\b`, 'i');
  return readdirSync(migrationsDir)
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
    .filter((text) => writes.test(text));
}

/** (code, risk, custom_role_use, privileged) rows of the permission catalogue seeds. */
function seededPermissions() {
  return catalogueMigrations('ref_permissions').flatMap((text) =>
    [
      ...text.matchAll(
        /\('((?:platform|tms)\.[a-z_]+\.[a-z_]+)', '(low|medium|high)', '([a-z_]+)', (true|false), \d+\)/g,
      ),
    ].map((m) => ({ code: m[1], risk: m[2], use: m[3], privileged: m[4] === 'true' })),
  );
}

/** (role, permission, scope) rows of the standard roles' grants seeds. */
function seededGrants() {
  return catalogueMigrations('ref_role_permissions').flatMap((text) =>
    [...text.matchAll(/\('([a-z_]+)', '((?:platform|tms)\.[a-z_]+\.[a-z_]+)', '([a-z_]+)'\)/g)].map(
      (m) => `${m[1] ?? ''}:${m[2] ?? ''}:${m[3] ?? ''}`,
    ),
  );
}

describe('permission catalogue and standard grants (EP-ROLES, drift checks)', () => {
  it('platform.ref_permissions lists every catalogue permission with its risk and custom-role use', () => {
    // Platform permissions and the module permissions standard roles grant (T-M3-10: tms.needs_form.*).
    const expected = CATALOGUE_PERMISSIONS.map((permission) => ({
      code: permission.code,
      risk: permission.risk,
      use: customRolePermission(permission.code)?.use ?? 'none',
      privileged: permissionMakesPrivileged(permission.code),
    }));
    const byCode = (a: { code: string | undefined }, b: { code: string | undefined }) =>
      (a.code ?? '').localeCompare(b.code ?? '');
    expect(seededPermissions().sort(byCode)).toEqual(expected.sort(byCode));
  });

  it('platform.ref_role_permissions are the standard roles’ grants', () => {
    const expected = SYSTEM_ROLES.flatMap((role) =>
      role.grants.map((g) => `${role.code}:${g.permission.code}:${g.scope}`),
    );
    expect(seededGrants().sort()).toEqual(expected.sort());
  });

  it('changes the catalogue by inserts only (the parsers above read inserts)', () => {
    const rewrites = readdirSync(migrationsDir).filter((f) =>
      /(update|delete from)\s+platform\.ref_(role_)?permissions\b/i.test(
        readFileSync(join(migrationsDir, f), 'utf8'),
      ),
    );
    expect(rewrites).toEqual([]);
  });

  it('lists the TMS permissions of the standard roles, outside custom roles for now (T-M3-10)', () => {
    expect(Object.keys(tmsRolePermissions)).toEqual([
      'tms.needs_form.read',
      'tms.needs_form.manage',
    ]);
    for (const code of Object.keys(tmsRolePermissions)) {
      // The Organization Admin builds custom roles from what they hold, and holds no training permission.
      expect(customRolePermission(code), code).toBeUndefined();
      expect(permissionMakesPrivileged(code), code).toBe(false);
    }
    expect(customRoleIsPrivileged(['tms.needs_form.manage'])).toBe(false);
  });

  it('keeps the Organization Admin’s own permissions out of custom roles (BR-IAM-4)', () => {
    expect(customRolePermission('platform.role.assign_privileged')).toBeUndefined();
    expect(customRolePermission('platform.role.manage')).toBeUndefined();
    // The catalogue: every other platform permission, once, in a named group.
    expect(CUSTOM_ROLE_PERMISSIONS).toHaveLength(Object.keys(platformPermissions).length - 2);
    for (const entry of CUSTOM_ROLE_PERMISSIONS) {
      expect(PERMISSION_GROUPS).toContain(entry.group);
      expect(PERMISSION_GROUP_NAMES[entry.group].ar.trim()).not.toBe('');
    }
    // Reading people and roles follows the role's scope; everything that changes something is
    // organization-wide only.
    for (const entry of CUSTOM_ROLE_PERMISSIONS) {
      if (entry.use === 'scoped') expect(entry.permission.code).toMatch(/\.read$/);
      if (!entry.permission.code.endsWith('.read')) expect(entry.use).toBe('organization_only');
    }
  });

  it('makes a role privileged by any high-risk or user/role management permission (PO, 5 and 17 Oct 2026)', () => {
    expect(customRoleIsPrivileged(['platform.user.read', 'platform.org.read'])).toBe(false);
    expect(customRoleIsPrivileged(['platform.user.read', 'platform.user.unlock_sign_in'])).toBe(
      false,
    );
    // A role copied from the HR Manager manages users and roles: privileged (security review H1).
    for (const code of [
      'platform.user.invite',
      'platform.user.update',
      'platform.user.deactivate',
      'platform.role.assign',
      'platform.org.manage',
    ]) {
      expect(customRoleIsPrivileged(['platform.user.read', code]), code).toBe(true);
    }
    const hr = roleStartValues({ kind: 'standard', code: 'hr_manager' }).permissions;
    expect(customRoleIsPrivileged(hr)).toBe(true);
    expect(customRoleIsPrivileged(['platform.user.read', 'platform.audit.read'])).toBe(true);
    expect(customRoleIsPrivileged(['platform.security.manage'])).toBe(true);
    expect(customRoleIsPrivileged(['tms.unknown.permission'])).toBe(true);
    expect(platformPermissions['platform.audit.read'].risk).toBe('high');
    expect(platformPermissions['platform.role.manage'].risk).toBe('high');
  });

  it('maps the four data scopes onto the existing scope types', () => {
    expect(CUSTOM_ROLE_SCOPE_MAP).toEqual({
      own: 'own',
      team: 'direct_reports',
      departments: 'headed_departments',
      organization: 'tenant',
    });
    expect(customRoleGrantScope('platform.user.read', 'team')).toBe('direct_reports');
    expect(customRoleGrantScope('platform.org.read', 'own')).toBe('tenant');
    expect(customRoleGrantScope('platform.user.invite', 'departments')).toBeNull();
    expect(customRoleGrantScope('platform.user.invite', 'organization')).toBe('tenant');
    expect(customRoleGrantScope('platform.role.manage', 'organization')).toBeNull();
    expect(standardRoleScope(getSystemRole('department_head'))).toBe('departments');
    expect(standardRoleScope(getSystemRole('learner'))).toBe('own');
    expect(standardRoleScope(getSystemRole('hr_manager'))).toBe('organization');
    expect(standardRoleScope({ grants: [] })).toBe('organization');
  });

  it('checks a role’s permissions like the database guards', () => {
    const held = new Set(['platform.user.read', 'platform.user.invite', 'platform.audit.read']);
    expect(customRolePermissionProblems(['platform.user.read'], 'team', held)).toEqual([]);
    expect(
      customRolePermissionProblems(
        ['platform.user.invite', 'platform.org.manage', 'platform.role.manage'],
        'team',
        held,
      ),
    ).toEqual([
      { code: 'platform.user.invite', reason: 'needs_organization_scope' },
      { code: 'platform.org.manage', reason: 'needs_organization_scope' },
      { code: 'platform.role.manage', reason: 'unknown' },
    ]);
    expect(customRolePermissionProblems(['platform.org.manage'], 'organization', held)).toEqual([
      { code: 'platform.org.manage', reason: 'not_held' },
    ]);
  });

  it('recognises the generated codes of custom roles', () => {
    expect(isCustomRoleCode('custom_0123456789ab')).toBe(true);
    expect(isCustomRoleCode('custom_0123456789AB')).toBe(false);
    expect(isCustomRoleCode('learner')).toBe(false);
  });
});

describe('role templates («start from», BRD Appendix B)', () => {
  it('are presets from the catalogue, not roles', () => {
    expect(ROLE_TEMPLATES.map((t) => t.key)).toEqual([
      'instructor',
      'finance_approver',
      'line_manager',
      'compliance_officer',
      'auditor',
    ]);
    for (const template of ROLE_TEMPLATES) {
      expect(template.name.ar.trim()).not.toBe('');
      expect(template.name.en.trim()).not.toBe('');
      expect(
        customRolePermissionProblems(template.permissions, template.dataScope, new Set()).filter(
          (p) => p.reason !== 'not_held',
        ),
      ).toEqual([]);
    }
    // The Auditor and the Compliance Officer read the audit log: privileged, as the former roles were.
    const privileged = ROLE_TEMPLATES.filter((t) => customRoleIsPrivileged(t.permissions));
    expect(privileged.map((t) => t.key)).toEqual(['compliance_officer', 'auditor']);
    // Instructor: "assigned sessions only" is not one of the four scopes yet → their team.
    expect(ROLE_TEMPLATES.find((t) => t.key === 'instructor')?.dataScope).toBe('team');
  });

  it('fill the create form: blank, a standard role’s permissions, or a template', () => {
    expect(roleStartValues({ kind: 'blank' })).toEqual({
      name: null,
      description: null,
      dataScope: 'organization',
      permissions: [],
    });
    expect(roleStartValues({ kind: 'standard', code: 'department_head' })).toEqual({
      name: null,
      description: null,
      dataScope: 'departments',
      permissions: ['platform.user.read', 'platform.role.read', 'platform.org.read'],
    });
    // Copying the Organization Admin never copies its own permissions.
    const admin = roleStartValues({ kind: 'standard', code: 'tenant_admin' });
    expect(admin.permissions).not.toContain('platform.role.assign_privileged');
    expect(admin.permissions).not.toContain('platform.role.manage');
    expect(roleStartValues({ kind: 'template', key: 'auditor' })).toMatchObject({
      name: { en: 'Auditor' },
      dataScope: 'organization',
    });
    expect(() => roleStartValues({ kind: 'template', key: 'nope' as never })).toThrow(
      'Unknown role template',
    );
  });
});
