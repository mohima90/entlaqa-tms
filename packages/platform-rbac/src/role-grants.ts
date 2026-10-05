import type { Grant } from './authorize';
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
 * May an actor holding `actorGrants` give or remove `roleCode`? (ADR 0003 §5, PO decision 5 Oct 2026)
 * - privileged roles need `platform.role.assign_privileged`; others need `platform.role.assign` (or
 *   the privileged permission, which includes it);
 * - the actor must hold, tenant-wide, every permission the role grants (no escalation);
 * - never on the actor's own membership (checked by the caller with the target membership, and again
 *   in the database).
 * The AAL2 requirement of the privileged permission is enforced by defineAction / authorize().
 */
export function canAssignRole(actorGrants: readonly Grant[], roleCode: string): boolean {
  if (!isSystemRoleCode(roleCode)) return false;
  const role = getSystemRole(roleCode);
  const tenantWide = new Set(
    actorGrants.filter((g) => g.scope.type === 'tenant').map((g) => g.permission),
  );
  const needed = role.privileged
    ? 'platform.role.assign_privileged'
    : tenantWide.has('platform.role.assign_privileged')
      ? 'platform.role.assign_privileged'
      : 'platform.role.assign';
  if (!tenantWide.has(needed)) return false;
  return role.grants.every((g) => tenantWide.has(g.permission.code));
}
