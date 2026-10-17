import type { LocalizedText, PermissionDefinition } from './permissions';
import { platformPermissions } from './platform-permissions';
import type { RoleScope, SystemRoleDefinition } from './system-roles';

/**
 * Custom roles (FR-IAM-07, EP-ROLES; PO 17 Oct 2026, option B): the Organization Admin names a role
 * (Arabic, English), ticks permissions from the permission catalogue below and gives the role ONE data
 * scope. Stored per organization (`platform.custom_roles`, `platform.custom_role_permissions`); the
 * database repeats every rule of this file (migrations 20261019090000…090200, drift tests in
 * custom-roles.test.ts).
 *
 * Rules (business flow docs/business-flows/EP-ROLES-roles-and-custom-roles.md §5):
 * - only the Organization Admin creates, changes or deletes custom roles (`platform.role.manage`);
 * - nobody gives a permission they do not hold themselves (the builder offers only what the actor holds
 *   organization-wide, the database refuses the rest);
 * - a custom role with any high-risk permission is PRIVILEGED: only the Organization Admin gives it.
 */

/** The data a custom role reaches (one per role; per-assignment scopes are FR-IAM-08, R2). */
export const CUSTOM_ROLE_SCOPES = ['own', 'team', 'departments', 'organization'] as const;
export type CustomRoleScope = (typeof CUSTOM_ROLE_SCOPES)[number];

/**
 * The existing scope type each choice maps to (scopes.ts / role-grants.ts): «their team» = the member's
 * direct reports (least privilege; the reports tree stays with standard roles), «their departments» = the
 * departments the member heads in the structure, with their sub-departments (like the Department Head).
 */
export const CUSTOM_ROLE_SCOPE_MAP: Readonly<Record<CustomRoleScope, RoleScope>> = {
  own: 'own',
  team: 'direct_reports',
  departments: 'headed_departments',
  organization: 'tenant',
};

/**
 * How a permission behaves in a custom role:
 * - `scoped`: follows the role's data scope (who the member may see);
 * - `organization`: organization-wide whatever the scope (names of branches and departments, the
 *   organization's profile — no personal data), like for the standard roles;
 * - `organization_only`: an administrative permission, available only to a role whose scope is the whole
 *   organization (the database guards check these organization-wide).
 * Permissions not listed here (`platform.role.assign_privileged`, `platform.role.manage`) define the
 * Organization Admin and are never part of a custom role (BR-IAM-4).
 */
export type CustomRoleUse = 'scoped' | 'organization' | 'organization_only';

/** Module headings of the permissions accordion (Kawadir "categories"). */
export const PERMISSION_GROUPS = ['people', 'roles', 'organization', 'settings', 'audit'] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const PERMISSION_GROUP_NAMES: Readonly<Record<PermissionGroup, LocalizedText>> = {
  people: { ar: 'الأشخاص', en: 'People' },
  roles: { ar: 'الأدوار', en: 'Roles' },
  organization: { ar: 'الهيكل التنظيمي', en: 'Organization structure' },
  settings: { ar: 'إعدادات المنظمة والأمان', en: 'Organization settings and security' },
  audit: { ar: 'سجل التدقيق', en: 'Audit log' },
};

export interface CustomRolePermission {
  readonly permission: PermissionDefinition;
  readonly group: PermissionGroup;
  readonly use: CustomRoleUse;
}

const p = platformPermissions;

/**
 * The permission catalogue of the role builder, in screen order (platform permissions; module permissions
 * join as each module's features ship — none is held by a standard role yet). Mirrored in
 * `platform.ref_permissions` (drift test).
 */
export const CUSTOM_ROLE_PERMISSIONS: readonly CustomRolePermission[] = [
  { permission: p['platform.user.read'], group: 'people', use: 'scoped' },
  { permission: p['platform.user.invite'], group: 'people', use: 'organization_only' },
  { permission: p['platform.user.update'], group: 'people', use: 'organization_only' },
  { permission: p['platform.user.deactivate'], group: 'people', use: 'organization_only' },
  { permission: p['platform.user.reset_mfa'], group: 'people', use: 'organization_only' },
  { permission: p['platform.user.unlock_sign_in'], group: 'people', use: 'organization_only' },
  { permission: p['platform.role.read'], group: 'roles', use: 'scoped' },
  { permission: p['platform.role.assign'], group: 'roles', use: 'organization_only' },
  { permission: p['platform.org.read'], group: 'organization', use: 'organization' },
  { permission: p['platform.org.manage'], group: 'organization', use: 'organization_only' },
  { permission: p['platform.tenant.read'], group: 'settings', use: 'organization' },
  { permission: p['platform.tenant.manage'], group: 'settings', use: 'organization_only' },
  { permission: p['platform.security.manage'], group: 'settings', use: 'organization_only' },
  { permission: p['platform.audit.read'], group: 'audit', use: 'organization_only' },
];

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

/** Privileged = any high-risk permission (PO, 17 Oct 2026). Unknown permissions count as high risk. */
export function customRoleIsPrivileged(permissions: readonly string[]): boolean {
  return permissions.some((code) => (BY_CODE.get(code)?.permission.risk ?? 'high') === 'high');
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
  | { readonly code: string; readonly reason: 'needs_organization_scope' }
  | { readonly code: string; readonly reason: 'not_held' };

/**
 * Checks the permissions of a custom role: from the catalogue, administrative ones only with the whole
 * organization as scope, and each held organization-wide by the actor (`held`).
 */
export function customRolePermissionProblems(
  permissions: readonly string[],
  dataScope: CustomRoleScope,
  held: ReadonlySet<string>,
): CustomRolePermissionProblem[] {
  const problems: CustomRolePermissionProblem[] = [];
  for (const code of permissions) {
    const entry = BY_CODE.get(code);
    if (!entry) problems.push({ code, reason: 'unknown' });
    else if (entry.use === 'organization_only' && dataScope !== 'organization') {
      problems.push({ code, reason: 'needs_organization_scope' });
    } else if (!held.has(code)) problems.push({ code, reason: 'not_held' });
  }
  return problems;
}

/** The data scope of a standard role, in the four words of the role builder. */
export function standardRoleScope(role: Pick<SystemRoleDefinition, 'grants'>): CustomRoleScope {
  const scopes = role.grants.map((g) => g.scope);
  if (scopes.includes('headed_departments')) return 'departments';
  if (scopes.includes('direct_reports') || scopes.includes('reports_tree')) return 'team';
  if (scopes.length > 0 && scopes.every((s) => s === 'own')) return 'own';
  return 'organization';
}
