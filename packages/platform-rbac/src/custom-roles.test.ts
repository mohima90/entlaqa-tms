import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coursePermissions } from './course-permissions';
import {
  CATALOGUE_PERMISSIONS,
  CUSTOM_ROLE_PERMISSIONS,
  CUSTOM_ROLE_SCOPE_MAP,
  PERMISSION_GROUPS,
  PERMISSION_GROUP_NAMES,
  STANDARD_ONLY_PERMISSIONS,
  customRoleGrantScope,
  customRoleIsPrivileged,
  customRolePermission,
  permissionMakesPrivileged,
  customRolePermissionProblems,
  isCustomRoleCode,
  standardRoleScope,
} from './custom-roles';
import { platformPermissions, tmsRolePermissions } from './platform-permissions';
import { tmsPlanningPermissions } from './tms-planning-permissions';
import { ROLE_TEMPLATES, roleStartValues } from './role-templates';
import { SYSTEM_ROLES, getSystemRole } from './system-roles';

const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url).pathname;

function migration(suffix: string): string {
  const file = readdirSync(migrationsDir).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  return readFileSync(join(migrationsDir, file), 'utf8');
}

/**
 * The migrations that write the catalogue: its creation (EP-ROLES), the module permissions added since
 * (course library, T-M3-03; planning cycles, EP-PLN T-M3-04; needs forms, T-M3-10) and who can give what
 * (PO, 17 Oct 2026: custom_role_use of three permissions), in file order. Any other writer fails the
 * "writers" test below until it is added here; the parsers read inserts and custom_role_use updates only
 * (the "rewrites" test below).
 */
const CATALOGUE_MIGRATIONS = [
  '_platform__create_permission_catalogue.sql',
  '_platform__add_course_permissions.sql',
  '_platform__add_planning_permissions.sql',
  '_platform__add_needs_form_permissions.sql',
  '_platform__who_can_give_what.sql',
  '_platform__add_person_hr_permissions.sql',
];

/** The one rewrite of the catalogue the parsers understand: a permission's custom_role_use. */
const USE_UPDATE_RE =
  /update platform\.ref_permissions set custom_role_use = '([a-z_]+)' where code = '([a-z]+\.[a-z_]+\.[a-z_]+)';/g;
/**
 * Either catalogue table, schema-qualified, plain or quoted (`platform.ref_permissions`,
 * `"platform"."ref_role_permissions"`, spaces around the dot).
 */
const CATALOGUE_TABLE = String.raw`(?:"platform"|platform)\s*\.\s*(?:"ref_(?:role_)?permissions"|ref_(?:role_)?permissions\b)`;
/**
 * Any rewrite of either catalogue table (each must be one the parsers understand; security pass of who can
 * give what): `update [only]`, `delete from [only]`, `merge into`, `truncate [table] [only] …` (also in a
 * list), `insert … on conflict … do update`, and dynamic SQL (`execute …`) that names a catalogue table.
 */
const REWRITE_RE = new RegExp(
  [
    String.raw`\bupdate\s+(?:only\s+)?${CATALOGUE_TABLE}`,
    String.raw`\bdelete\s+from\s+(?:only\s+)?${CATALOGUE_TABLE}`,
    String.raw`\bmerge\s+into\s+(?:only\s+)?${CATALOGUE_TABLE}`,
    String.raw`\btruncate\b[^;]*?${CATALOGUE_TABLE}`,
    String.raw`\binsert\s+into\s+${CATALOGUE_TABLE}[^;]*?\bon\s+conflict\b[^;]*?\bdo\s+update\b`,
    String.raw`\bexecute\b(?!\s+(?:on|function|procedure)\b)[^;]*?ref_(?:role_)?permissions`,
  ].join('|'),
  'gi',
);
/** Any writer of either catalogue table: an insert, or one of the rewrites above. */
const WRITER_RE = new RegExp(
  `${String.raw`\binsert\s+into\s+${CATALOGUE_TABLE}`}|${REWRITE_RE.source}`,
  'i',
);

function catalogueSeeds(): string {
  return CATALOGUE_MIGRATIONS.map(migration).join('\n');
}

/**
 * (code, risk, custom_role_use, privileged) rows of the permission catalogue: the seeds' inserts, then the
 * custom_role_use updates in file order (each must name a seeded permission).
 */
function seededPermissions() {
  const seeds = catalogueSeeds();
  const rows = new Map(
    [
      ...seeds.matchAll(
        /\('([a-z]+\.[a-z_]+\.[a-z_]+)', '(low|medium|high)', '([a-z_]+)', (true|false), \d+\)/g,
      ),
    ].map((m) => [m[1], { code: m[1], risk: m[2], use: m[3], privileged: m[4] === 'true' }]),
  );
  for (const m of seeds.matchAll(USE_UPDATE_RE)) {
    const row = rows.get(m[2]);
    if (!row) throw new Error(`custom_role_use update of an unknown permission ${m[2] ?? ''}`);
    row.use = m[1];
  }
  return [...rows.values()];
}

/** (role, permission, scope) rows of the standard roles' grants seeds. */
function seededGrants() {
  return [
    ...catalogueSeeds().matchAll(/\('([a-z_]+)', '([a-z]+\.[a-z_]+\.[a-z_]+)', '([a-z_]+)'\)/g),
  ].map((m) => `${m[1] ?? ''}:${m[2] ?? ''}:${m[3] ?? ''}`);
}

describe('permission catalogue and standard grants (EP-ROLES, drift checks)', () => {
  it('platform.ref_permissions lists every catalogue permission with its risk and custom-role use', () => {
    // Platform permissions and the module permissions standard roles grant (courses, planning, needs forms).
    const expected = Object.values(CATALOGUE_PERMISSIONS).map((permission) => ({
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

  it('only the catalogue migrations write the catalogue', () => {
    const writers = readdirSync(migrationsDir).filter((f) =>
      WRITER_RE.test(readFileSync(join(migrationsDir, f), 'utf8')),
    );
    expect(writers.map((f) => f.replace(/^\d+/, ''))).toEqual(CATALOGUE_MIGRATIONS);
  });

  it('recognises every way of writing the catalogue (the drift checks cannot be bypassed)', () => {
    const rewrites = [
      'update only platform.ref_permissions set risk = $$high$$;',
      'UPDATE "platform"."ref_permissions" SET risk = \'high\';',
      "update platform . ref_role_permissions set scope = 'tenant';",
      "delete from only platform.ref_role_permissions where role_code = 'x';",
      'merge into platform.ref_permissions p using x on true when matched then delete;',
      'truncate table other.t, only platform.ref_permissions;',
      "insert into platform.ref_permissions (code) values ('a.b.c') on conflict (code) do update set risk = 'high';",
      "execute format('update %I.%I set risk = %L', 'platform', 'ref_permissions', 'high');",
      "execute 'delete from platform.ref_role_permissions';",
    ];
    for (const sql of rewrites) {
      expect([...sql.matchAll(REWRITE_RE)], sql).toHaveLength(1);
      expect(WRITER_RE.test(sql), sql).toBe(true);
    }
    const harmless = [
      "insert into platform.ref_permissions (code) values ('a.b.c') on conflict do nothing;",
      'grant execute on function private.member_permissions(uuid, uuid) to authenticated;',
      'create trigger t after update on platform.ref_permissions for each row execute function f();',
      "delete from platform.custom_role_permissions where permission_code = 'x';",
      'select code from platform.ref_permissions;',
    ];
    for (const sql of harmless) expect([...sql.matchAll(REWRITE_RE)], sql).toHaveLength(0);
    expect(WRITER_RE.test(harmless[0] ?? '')).toBe(true);
  });

  it('rewrites the catalogue only by custom_role_use updates (the only rewrite the parsers read)', () => {
    const unparsed = readdirSync(migrationsDir).filter((f) => {
      const text = readFileSync(join(migrationsDir, f), 'utf8');
      return [...text.matchAll(REWRITE_RE)].length !== [...text.matchAll(USE_UPDATE_RE)].length;
    });
    expect(unparsed).toEqual([]);
    // Who can give what (PO, 17 Oct 2026) is the one migration that rewrites rows so far.
    const rewriters = readdirSync(migrationsDir).filter(
      (f) => [...readFileSync(join(migrationsDir, f), 'utf8').matchAll(REWRITE_RE)].length > 0,
    );
    expect(rewriters.map((f) => f.replace(/^\d+/, ''))).toEqual([
      '_platform__who_can_give_what.sql',
    ]);
  });

  it('lists the needs-form permissions in custom roles since who can give what (T-M3-10; PO, 17 Oct 2026)', () => {
    expect(Object.keys(tmsRolePermissions)).toEqual([
      'tms.needs_form.read',
      'tms.needs_form.manage',
    ]);
    // The Organization Admin builds roles with permissions it does not hold (it holds no training one).
    expect(customRolePermission('tms.needs_form.read')).toMatchObject({
      group: 'planning',
      use: 'organization',
    });
    expect(customRolePermission('tms.needs_form.manage')).toMatchObject({
      group: 'planning',
      use: 'organization_only',
    });
    for (const code of Object.keys(tmsRolePermissions)) {
      expect(permissionMakesPrivileged(code), code).toBe(false);
    }
    expect(customRoleIsPrivileged(['tms.needs_form.manage'])).toBe(false);
  });

  it('keeps the admin-only permissions out of custom roles (BR-IAM-4; PO, 17 Oct 2026)', () => {
    // Role management, privileged role assignment and the organization structure (the HR Manager's).
    expect(customRolePermission('platform.role.assign_privileged')).toBeUndefined();
    expect(customRolePermission('platform.role.manage')).toBeUndefined();
    expect(customRolePermission('platform.org.manage')).toBeUndefined();
    expect(STANDARD_ONLY_PERMISSIONS.map((e) => e.permission.code)).toEqual([
      'platform.org.manage',
    ]);
    // …which still makes a role privileged (a role copied from the HR Manager, a platform operation).
    expect(permissionMakesPrivileged('platform.org.manage')).toBe(true);
    // The catalogue: every other platform permission and the module permissions, once, in a named group.
    expect(CUSTOM_ROLE_PERMISSIONS).toHaveLength(
      Object.keys(platformPermissions).length -
        3 +
        Object.keys(coursePermissions).length +
        Object.keys(tmsPlanningPermissions).length +
        Object.keys(tmsRolePermissions).length,
    );
    expect(new Set(CUSTOM_ROLE_PERMISSIONS.map((e) => e.permission.code)).size).toBe(
      CUSTOM_ROLE_PERMISSIONS.length,
    );
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
    // «A department» (stored `departments`): the unit picked when the role is given (EP-ORG, T-M3-09).
    expect(CUSTOM_ROLE_SCOPE_MAP).toEqual({
      own: 'own',
      team: 'direct_reports',
      departments: 'assigned_unit',
      organization: 'tenant',
    });
    expect(customRoleGrantScope('platform.user.read', 'departments')).toBe('assigned_unit');
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

  it('checks a role’s permissions like the database guards (who can give what, PO 17 Oct 2026)', () => {
    expect(customRolePermissionProblems(['platform.user.read'], 'team')).toEqual([]);
    expect(
      customRolePermissionProblems(
        ['platform.user.invite', 'tms.course.manage', 'platform.role.manage'],
        'team',
      ),
    ).toEqual([
      { code: 'platform.user.invite', reason: 'needs_organization_scope' },
      { code: 'tms.course.manage', reason: 'needs_organization_scope' },
      { code: 'platform.role.manage', reason: 'unknown' },
    ]);
    // Training permissions the Organization Admin does not hold: allowed organization-wide.
    expect(
      customRolePermissionProblems(
        ['tms.course.manage', 'tms.plan_cycle.manage', 'tms.needs_form.manage'],
        'organization',
      ),
    ).toEqual([]);
    // Admin-only permissions: never (not in the catalogue).
    expect(
      customRolePermissionProblems(
        ['platform.role.manage', 'platform.role.assign_privileged', 'platform.org.manage'],
        'organization',
      ),
    ).toEqual([
      { code: 'platform.role.manage', reason: 'unknown' },
      { code: 'platform.role.assign_privileged', reason: 'unknown' },
      { code: 'platform.org.manage', reason: 'unknown' },
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
      expect(customRolePermissionProblems(template.permissions, template.dataScope)).toEqual([]);
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
      permissions: [
        'platform.user.read',
        'platform.role.read',
        'platform.org.read',
        'tms.course.read',
        'tms.course_cost.read',
      ],
    });
    // Reading the course library (organization data) does not widen a role's data scope.
    expect(
      standardRoleScope({
        grants: [
          { permission: platformPermissions['platform.user.read'], scope: 'own' },
          { permission: coursePermissions['tms.course.read'], scope: 'tenant' },
        ],
      }),
    ).toBe('own');
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
