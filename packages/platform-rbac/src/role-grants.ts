import { type AuthorizationSubject, type Grant, authorize } from './authorize';
import {
  type CustomRoleDefinition,
  customRoleGrantScope,
  customRoleIsPrivileged,
  isCustomRoleCode,
} from './custom-roles';
import type { PermissionDefinition } from './permissions';
import { platformPermissions } from './platform-permissions';
import type { DataScope } from './scopes';
import { type RoleScope, getSystemRole, isSystemRoleCode } from './system-roles';

/** The role held by the member (one row of platform.role_assignments; one per person since EP-ROLES). */
export interface RoleAssignment {
  readonly roleCode: string;
  readonly validFrom?: Date;
  readonly validUntil?: Date;
}

/** Facts about the member needed to turn role scopes into data scopes. */
export interface GrantContext {
  /** Departments the member heads (platform.departments.head_person_id), not deleted. */
  readonly headedDepartmentIds: readonly string[];
  /**
   * The member's custom roles as stored now (platform.custom_roles + permissions), read on every request
   * with the assignments, so a change to a custom role applies at the holder's next request.
   */
  readonly customRoles?: readonly CustomRoleDefinition[];
}

function toDataScope(scope: RoleScope, context: GrantContext): DataScope | null {
  switch (scope) {
    case 'tenant':
      return { type: 'tenant' };
    case 'own':
      return { type: 'own' };
    case 'direct_reports':
      return { type: 'direct_reports' };
    case 'reports_tree':
      return { type: 'reports_tree' };
    case 'headed_departments':
      // A department head who heads no department (yet) gets nothing from this grant.
      return context.headedDepartmentIds.length > 0
        ? { type: 'org_units', orgUnitIds: context.headedDepartmentIds, includeDescendants: true }
        : null;
  }
}

/** The (permission, role scope) pairs a role grants, standard or custom; unknown roles grant nothing. */
function roleGrants(
  roleCode: string,
  context: GrantContext,
): readonly { readonly permission: string; readonly scope: RoleScope }[] {
  if (isSystemRoleCode(roleCode)) {
    return getSystemRole(roleCode).grants.map((g) => ({
      permission: g.permission.code,
      scope: g.scope,
    }));
  }
  if (!isCustomRoleCode(roleCode)) return [];
  const custom = context.customRoles?.find((role) => role.code === roleCode);
  if (!custom) return [];
  return custom.permissions.flatMap((permission) => {
    const scope = customRoleGrantScope(permission, custom.dataScope);
    return scope ? [{ permission, scope }] : [];
  });
}

/**
 * Effective grants of a member = the union of their roles' grants (ADR 0003 §3, BR-IAM-1). Unknown role
 * codes contribute nothing (deny by default) — e.g. a former system role, or a custom role deleted
 * meanwhile.
 */
export function grantsForAssignments(
  assignments: readonly RoleAssignment[],
  context: GrantContext,
): Grant[] {
  const grants: Grant[] = [];
  for (const assignment of assignments) {
    for (const roleGrant of roleGrants(assignment.roleCode, context)) {
      const scope = toDataScope(roleGrant.scope, context);
      if (!scope) continue;
      grants.push({
        permission: roleGrant.permission,
        scope,
        ...(assignment.validFrom ? { validFrom: assignment.validFrom } : {}),
        ...(assignment.validUntil ? { validUntil: assignment.validUntil } : {}),
      });
    }
  }
  return grants;
}

/** What deciding about giving a role needs: whether it is privileged and the permissions it grants. */
export interface AssignableRole {
  readonly code: string;
  readonly privileged: boolean;
  readonly permissions: readonly string[];
  /**
   * A standard role (fixed by ENTLAQA, system-roles.ts). «Nobody gives a permission they do not hold»
   * covers its PLATFORM permissions only: its module (training) permissions are part of the role's
   * design, and the people who give roles (HR Manager) hold none of them — T-M3-10: the HR Manager gives
   * the L&D Manager role, which designs needs forms (PO rule of 5 Oct 2026: non-privileged roles are the
   * HR Manager's to give). Every permission of a custom role is checked.
   */
  readonly standard?: boolean;
}

/** A standard role as an AssignableRole (null for unknown codes). */
export function standardAssignableRole(code: string): AssignableRole | null {
  if (!isSystemRoleCode(code)) return null;
  const role = getSystemRole(code);
  return {
    code,
    privileged: role.privileged,
    permissions: [...new Set(role.grants.map((g) => g.permission.code))],
    standard: true,
  };
}

/** A custom role as an AssignableRole (privileged = any high-risk permission). */
export function customAssignableRole(role: CustomRoleDefinition): AssignableRole {
  return {
    code: role.code,
    privileged: customRoleIsPrivileged(role.permissions),
    permissions: role.permissions,
  };
}

/**
 * May the actor give or remove `role`? (ADR 0003 §5; PO decisions 5 Oct 2026 and 17 Oct 2026, EP-ROLES)
 * - `platform.role.assign_privileged` (the Organization Admin) gives every role;
 * - otherwise the role must not be privileged, the actor needs `platform.role.assign`, and — nobody gives
 *   a permission they do not hold — every permission of the role must be the actor's organization-wide
 *   (of a standard role: its platform permissions — givenPermissions, T-M3-10);
 * - all checks tenant-wide and active now, with authorize() so validity windows apply as in defineAction;
 * - never on the actor's own membership (checked by the caller, and again in the database), which runs
 *   the same rule (private.member_may_give_roles).
 */
export function canAssignRole(
  subject: AuthorizationSubject,
  role: AssignableRole | null,
  now: Date = new Date(),
): boolean {
  if (!role) return false;
  const allowed = (permission: PermissionDefinition) =>
    authorize(subject, permission, undefined, { now }).allowed;
  if (allowed(platformPermissions['platform.role.assign_privileged'])) return true;
  if (role.privileged || !allowed(platformPermissions['platform.role.assign'])) return false;
  return givenPermissions(role).every((code) => holdsTenantWide(subject, code, now));
}

/**
 * The permissions of `role` its giver must hold organization-wide: all of a custom role's; a standard
 * role's platform permissions (its module permissions are fixed by ENTLAQA; AssignableRole.standard).
 * The database repeats it (private.member_may_give_roles, migration 20261020180100).
 */
export function givenPermissions(role: AssignableRole): readonly string[] {
  return role.standard === true
    ? role.permissions.filter((code) => code.startsWith('platform.'))
    : role.permissions;
}

/** Does the subject hold `code` organization-wide now (a `tenant`-scope grant in force)? */
export function holdsTenantWide(
  subject: Pick<AuthorizationSubject, 'grants'>,
  code: string,
  now: Date = new Date(),
): boolean {
  return subject.grants.some(
    (g) =>
      g.permission === code &&
      g.scope.type === 'tenant' &&
      (!g.validFrom || g.validFrom <= now) &&
      (!g.validUntil || now < g.validUntil),
  );
}
