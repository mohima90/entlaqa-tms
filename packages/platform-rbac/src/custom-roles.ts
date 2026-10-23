import { coursePermissions } from './course-permissions';
import type { LocalizedText, PermissionDefinition } from './permissions';
import { platformPermissions, tmsRolePermissions } from './platform-permissions';
import { tmsPlanningPermissions } from './tms-planning-permissions';
import type { RoleScope, SystemRoleDefinition } from './system-roles';

/**
 * Custom roles (FR-IAM-07, EP-ROLES; PO 17 Oct 2026, option B): the Organization Admin names a role
 * (Arabic, English), ticks permissions from the permission catalogue below and gives the role ONE data
 * scope. Stored per organization (`platform.custom_roles`, `platform.custom_role_permissions`); the
 * database repeats every rule of this file (migrations 20261019090000…090200, drift tests in
 * custom-roles.test.ts).
 *
 * Rules (business flow docs/business-flows/EP-ROLES-roles-and-custom-roles.md §5; who can give what, PO
 * 17 Oct 2026 — migration 20261020200000):
 * - only the Organization Admin creates, changes or deletes custom roles (`platform.role.manage`), and may
 *   put in them ANY permission of the catalogue below — also training permissions it does not hold itself
 *   (it holds none, BR-IAM-4); never the admin-only ones (role management, privileged role assignment,
 *   the organization structure), which are not in the catalogue;
 * - a custom role with any high-risk or user / role / structure management permission is PRIVILEGED: only
 *   the Organization Admin gives it; every other (ordinary) role the HR Manager gives too.
 */

/** The data a custom role reaches (one per role; per-assignment scopes are FR-IAM-08, R2). */
export const CUSTOM_ROLE_SCOPES = ['own', 'team', 'departments', 'organization'] as const;
export type CustomRoleScope = (typeof CUSTOM_ROLE_SCOPES)[number];

/**
 * The existing scope type each choice maps to (scopes.ts / role-grants.ts): «their team» = the member's
 * direct reports (least privilege; the reports tree stays with standard roles); «A department» (stored
 * code `departments`, kept for expand-first compatibility — migration 20261020090400) = the ONE unit of
 * the structure picked when the role is given, at any level, with everything under it (EP-ORG, PO 17 Oct
 * 2026; it replaced «their departments», the departments the member heads, which stays the Department
 * Head's own scope). Without a picked unit (or with a unit deactivated since) the role grants nothing
 * scoped (deny by default).
 */
export const CUSTOM_ROLE_SCOPE_MAP: Readonly<Record<CustomRoleScope, RoleScope>> = {
  own: 'own',
  team: 'direct_reports',
  departments: 'assigned_unit',
  organization: 'tenant',
};

/** Does a role with this data scope need ONE unit picked when it is given (EP-ORG, T-M3-09)? */
export function scopeNeedsUnit(dataScope: CustomRoleScope): boolean {
  return dataScope === 'departments';
}

/**
 * How a permission behaves in a custom role:
 * - `scoped`: follows the role's data scope (who the member may see);
 * - `organization`: organization-wide whatever the scope (names of branches and departments, the
 *   organization's profile — no personal data), like for the standard roles;
 * - `organization_only`: an administrative permission, available only to a role whose scope is the whole
 *   organization (the database guards check these organization-wide).
 * Permissions not listed here are never part of a custom role (`custom_role_use = 'none'`): the
 * Organization Admin's own (`platform.role.assign_privileged`, `platform.role.manage`, BR-IAM-4) and the
 * organization structure (`platform.org.manage`, the HR Manager's — PO, 11 and 17 Oct 2026).
 */
export type CustomRoleUse = 'scoped' | 'organization' | 'organization_only';

/** Module headings of the permissions accordion (Kawadir "categories"). */
export const PERMISSION_GROUPS = [
  'people',
  'roles',
  'organization',
  'settings',
  'audit',
  'courses',
  // TMS module (EP-PLN, T-M3-04).
  'planning',
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const PERMISSION_GROUP_NAMES: Readonly<Record<PermissionGroup, LocalizedText>> = {
  people: { ar: 'الأشخاص', en: 'People' },
  roles: { ar: 'الأدوار', en: 'Roles' },
  organization: { ar: 'الهيكل التنظيمي', en: 'Organization structure' },
  settings: { ar: 'إعدادات المنظمة والأمان', en: 'Organization settings and security' },
  audit: { ar: 'سجل التدقيق', en: 'Audit log' },
  // TMS course library (T-M3-03): glossary #32 «الدورات».
  courses: { ar: 'الدورات', en: 'Courses' },
  planning: { ar: 'التخطيط', en: 'Planning' },
};

export interface CustomRolePermission {
  readonly permission: PermissionDefinition;
  readonly group: PermissionGroup;
  readonly use: CustomRoleUse;
}

const p = platformPermissions;
const c = coursePermissions;

/**
 * Every permission of the catalogue by code: the platform's and the module permissions held by the
 * standard roles (course library, T-M3-03; planning cycles, EP-PLN T-M3-04; needs forms, T-M3-10). Unknown
 * codes are not in it (callers fail closed).
 */
export const CATALOGUE_PERMISSIONS: Readonly<Record<string, PermissionDefinition>> = Object.freeze({
  ...platformPermissions,
  ...coursePermissions,
  ...tmsPlanningPermissions,
  ...tmsRolePermissions,
});

/**
 * The permission catalogue of the role builder, in screen order (platform permissions, then module
 * permissions as each module's features ship: the course library since T-M3-03, planning cycles since
 * T-M3-04, needs forms since who can give what — PO, 17 Oct 2026). Mirrored in `platform.ref_permissions`
 * (drift test).
 */
export const CUSTOM_ROLE_PERMISSIONS: readonly CustomRolePermission[] = [
  { permission: p['platform.user.read'], group: 'people', use: 'scoped' },
  { permission: p['platform.user.invite'], group: 'people', use: 'organization_only' },
  { permission: p['platform.user.update'], group: 'people', use: 'organization_only' },
  { permission: p['platform.user.deactivate'], group: 'people', use: 'organization_only' },
  { permission: p['platform.user.reset_mfa'], group: 'people', use: 'organization_only' },
  { permission: p['platform.user.unlock_sign_in'], group: 'people', use: 'organization_only' },
  // HR-only fields (WP-ADM-04): gender, date of birth, employment category of every member; a role holding
  // it is privileged (only the Organization Admin gives it).
  { permission: p['platform.person.hr_details'], group: 'people', use: 'organization_only' },
  { permission: p['platform.role.read'], group: 'roles', use: 'scoped' },
  { permission: p['platform.role.assign'], group: 'roles', use: 'organization_only' },
  { permission: p['platform.org.read'], group: 'organization', use: 'organization' },
  { permission: p['platform.tenant.read'], group: 'settings', use: 'organization' },
  { permission: p['platform.tenant.manage'], group: 'settings', use: 'organization_only' },
  { permission: p['platform.security.manage'], group: 'settings', use: 'organization_only' },
  { permission: p['platform.audit.read'], group: 'audit', use: 'organization_only' },
  // Course library (T-M3-03): organization data — reading follows no data scope; changing it is
  // administrative (a role that sees the whole organization).
  { permission: c['tms.course.read'], group: 'courses', use: 'organization' },
  { permission: c['tms.course_cost.read'], group: 'courses', use: 'organization' },
  { permission: c['tms.course.manage'], group: 'courses', use: 'organization_only' },
  { permission: c['tms.course.archive'], group: 'courses', use: 'organization_only' },
  // Planning cycles span departments: organization-wide only (migration 20261020150000).
  {
    permission: tmsPlanningPermissions['tms.plan_cycle.read'],
    group: 'planning',
    use: 'organization_only',
  },
  {
    permission: tmsPlanningPermissions['tms.plan_cycle.manage'],
    group: 'planning',
    use: 'organization_only',
  },
  // Needs forms (T-M3-10; usable in custom roles since PO, 17 Oct 2026 — migration 20261020200000): the
  // forms library is organization data without personal data (like the course library); designing forms
  // is administrative (a role that sees the whole organization).
  { permission: tmsRolePermissions['tms.needs_form.read'], group: 'planning', use: 'organization' },
  {
    permission: tmsRolePermissions['tms.needs_form.manage'],
    group: 'planning',
    use: 'organization_only',
  },
];

/**
 * Permissions of standard roles that are never part of a custom role (`custom_role_use = 'none'`) but are
 * shown, read-only, in their module group on a role's page: the organization structure, the HR Manager's
 * (PO, 11 and 17 Oct 2026). The Organization Admin's own permissions are shown as «Organization Admin
 * only» instead.
 */
export const STANDARD_ONLY_PERMISSIONS: readonly Omit<CustomRolePermission, 'use'>[] = [
  { permission: p['platform.org.manage'], group: 'organization' },
];

const PERMISSIONS_BY_CODE: ReadonlyMap<string, PermissionDefinition> = new Map(
  Object.values(CATALOGUE_PERMISSIONS).map((permission) => [permission.code, permission]),
);

const BY_CODE: ReadonlyMap<string, CustomRolePermission> = new Map(
  CUSTOM_ROLE_PERMISSIONS.map((entry) => [entry.permission.code, entry]),
);

export function customRolePermission(code: string): CustomRolePermission | undefined {
  return BY_CODE.get(code);
}

/** Codes of custom roles: `custom_` + 12 hex characters, generated by the database. */
export const CUSTOM_ROLE_CODE_RE = /^custom_[0-9a-f]{12}$/;

export function isCustomRoleCode(code: string): boolean {
  return CUSTOM_ROLE_CODE_RE.test(code);
}

/** A custom role as stored (permission codes from the catalogue). */
export interface CustomRoleDefinition {
  readonly code: string;
  readonly dataScope: CustomRoleScope;
  readonly permissions: readonly string[];
}

/**
 * Permissions that make a role privileged although they are not high-risk: managing users or roles
 * (PO rule of 5 Oct 2026, kept for custom roles — security review H1). Mirrored by
 * `platform.ref_permissions.privileged` (drift test). `platform.org.manage` is no longer part of a custom
 * role (PO, 17 Oct 2026) but still makes a role privileged (the HR Manager's).
 */
export const USER_MANAGEMENT_PERMISSIONS: readonly string[] = [
  'platform.user.invite',
  'platform.user.update',
  'platform.user.deactivate',
  'platform.role.assign',
  'platform.org.manage',
  // Personal data of every member (WP-ADM-04, PO 21 Oct 2026: "privileged permission").
  'platform.person.hr_details',
];

/** Does holding this permission make a custom role privileged? Unknown permissions do (fail closed). */
export function permissionMakesPrivileged(code: string): boolean {
  const permission: PermissionDefinition | undefined = PERMISSIONS_BY_CODE.get(code);
  return (
    permission === undefined ||
    permission.risk === 'high' ||
    USER_MANAGEMENT_PERMISSIONS.includes(code)
  );
}

/**
 * Privileged = any high-risk permission or any permission that manages users or roles (PO, 5 and 17 Oct
 * 2026) — the database's private.role_is_privileged. Unknown permissions count as privileged.
 */
export function customRoleIsPrivileged(permissions: readonly string[]): boolean {
  return permissions.some(permissionMakesPrivileged);
}

/** The scope a permission of the role is granted with (null: not part of a custom role). */
export function customRoleGrantScope(code: string, dataScope: CustomRoleScope): RoleScope | null {
  const entry = BY_CODE.get(code);
  if (!entry) return null;
  if (entry.use === 'organization') return 'tenant';
  if (entry.use === 'organization_only' && dataScope !== 'organization') return null;
  return CUSTOM_ROLE_SCOPE_MAP[dataScope];
}

/** Why a set of permissions cannot make a custom role (same rules as the database guards). */
export type CustomRolePermissionProblem =
  | { readonly code: string; readonly reason: 'unknown' }
  | { readonly code: string; readonly reason: 'needs_organization_scope' };

/**
 * Checks the permissions of a custom role: from the catalogue (never an admin-only one), administrative
 * ones only with the whole organization as scope. Whether the builder holds a permission does not matter
 * (who can give what, PO 17 Oct 2026 — replacing "nobody gives a permission they do not hold").
 */
export function customRolePermissionProblems(
  permissions: readonly string[],
  dataScope: CustomRoleScope,
): CustomRolePermissionProblem[] {
  const problems: CustomRolePermissionProblem[] = [];
  for (const code of permissions) {
    const entry = BY_CODE.get(code);
    if (!entry) problems.push({ code, reason: 'unknown' });
    else if (entry.use === 'organization_only' && dataScope !== 'organization') {
      problems.push({ code, reason: 'needs_organization_scope' });
    }
  }
  return problems;
}

/**
 * The data scope of a standard role, in the four words of the role builder — from the grants that follow a
 * data scope (people, roles); organization-wide reference data (structure names, the course library) does
 * not widen it: an Employee who reads the course library still sees only their own record.
 */
export function standardRoleScope(role: Pick<SystemRoleDefinition, 'grants'>): CustomRoleScope {
  const scopes = role.grants
    .filter((g) => BY_CODE.get(g.permission.code)?.use !== 'organization')
    .map((g) => g.scope);
  if (scopes.includes('headed_departments')) return 'departments';
  if (scopes.includes('direct_reports') || scopes.includes('reports_tree')) return 'team';
  if (scopes.length > 0 && scopes.every((s) => s === 'own')) return 'own';
  return 'organization';
}
