import { type AuthorizationSubject, type Grant, authorize } from './authorize';
import type { PermissionDefinition } from './permissions';
import { platformPermissions } from './platform-permissions';
import type { DataScope } from './scopes';
import { type RoleScope, getSystemRole, isSystemRoleCode } from './system-roles';

/** A role held by the member (one row of platform.role_assignments). */
export interface RoleAssignment {
  readonly roleCode: string;
  readonly validFrom?: Date;
  readonly validUntil?: Date;
}

/** Facts about the member needed to turn role scopes into data scopes. */
export interface GrantContext {
  /** Departments the member heads (platform.departments.head_person_id), not deleted. */
  readonly headedDepartmentIds: readonly string[];
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

/**
 * Effective grants of a member = the union of their roles' grants (ADR 0003 §3, BR-IAM-1). Unknown role
 * codes contribute nothing (deny by default) — e.g. a role removed from the code while rows remain.
 */
export function grantsForAssignments(
  assignments: readonly RoleAssignment[],
  context: GrantContext,
): Grant[] {
  const grants: Grant[] = [];
  for (const assignment of assignments) {
    if (!isSystemRoleCode(assignment.roleCode)) continue;
    const role = getSystemRole(assignment.roleCode);
    for (const roleGrant of role.grants) {
      const scope = toDataScope(roleGrant.scope, context);
      if (!scope) continue;
      grants.push({
        permission: roleGrant.permission.code,
        scope,
        ...(assignment.validFrom ? { validFrom: assignment.validFrom } : {}),
        ...(assignment.validUntil ? { validUntil: assignment.validUntil } : {}),
      });
    }
  }
  return grants;
}

/**
 * May the actor give or remove `roleCode`? (ADR 0003 §5, PO decision 5 Oct 2026)
 * - privileged roles need `platform.role.assign_privileged` (high risk: AAL2), other roles
 *   `platform.role.assign` or the privileged permission — both tenant-wide and active now, checked
 *   with authorize() so validity windows and the AAL step-up apply exactly as in defineAction;
 * - never on the actor's own membership (checked by the caller, and again in the database).
 * The PO decision replaces ADR 0003 §5's "only roles whose permissions the assigner holds": an HR
 * Manager gives every non-privileged role; what makes a role powerful is its `privileged` flag.
 */
export function canAssignRole(
  subject: AuthorizationSubject,
  roleCode: string,
  now: Date = new Date(),
): boolean {
  if (!isSystemRoleCode(roleCode)) return false;
  const role = getSystemRole(roleCode);
  const allowed = (permission: PermissionDefinition) =>
    authorize(subject, permission, undefined, { now }).allowed;
  if (allowed(platformPermissions['platform.role.assign_privileged'])) return true;
  return !role.privileged && allowed(platformPermissions['platform.role.assign']);
}
