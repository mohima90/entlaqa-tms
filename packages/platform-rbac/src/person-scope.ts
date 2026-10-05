import { EMPTY_PERSON_SCOPE, type PersonScope } from '@jadarat/platform-core';
import type { PersonResourceFacts } from '@jadarat/platform-db';
import type { Grant } from './authorize';
import type { PermissionDefinition } from './permissions';
import type { ResourceAttributes } from './scopes';

/** A person as a resource for authorize() — the single-record counterpart of personScopeFromGrants. */
export function personResourceAttributes(facts: PersonResourceFacts): ResourceAttributes {
  return {
    type: 'person',
    id: facts.personId,
    tenantId: facts.tenantId,
    subjectPersonId: facts.personId,
    ...(facts.managerPersonId ? { subjectManagerPersonId: facts.managerPersonId } : {}),
    subjectManagerChain: facts.managerChain,
    ...(facts.departmentId
      ? { orgUnitId: facts.departmentId, orgUnitAncestorIds: facts.departmentAncestorIds }
      : {}),
    ...(facts.branchId ? { branchId: facts.branchId } : {}),
  };
}

/**
 * The people `permission` covers through the given grants (normally `ctx.grants` of a `scoped` query,
 * already filtered to active grants by authorize()). Grants of other permissions are ignored, so a
 * tenant-wide `platform.org.read` never widens a `platform.user.read` list. `assigned` and
 * `legal_entity` scopes cover no person records (they apply to sessions, providers, … and legal
 * entities are R3).
 */
export function personScopeFromGrants(
  grants: readonly Grant[],
  permission: PermissionDefinition,
): PersonScope {
  let scope: PersonScope = EMPTY_PERSON_SCOPE;
  for (const { permission: code, scope: s } of grants) {
    if (code !== permission.code) continue;
    switch (s.type) {
      case 'tenant':
        scope = { ...scope, all: true };
        break;
      case 'own':
        scope = { ...scope, self: true };
        break;
      case 'direct_reports':
        scope = { ...scope, directReports: true };
        break;
      case 'reports_tree':
        scope = { ...scope, reportsTree: true };
        break;
      case 'org_units':
        scope = {
          ...scope,
          departments: [
            ...scope.departments,
            { ids: [...s.orgUnitIds], includeDescendants: s.includeDescendants },
          ],
        };
        break;
      case 'branches':
        scope = { ...scope, branchIds: [...scope.branchIds, ...s.branchIds] };
        break;
      case 'legal_entity':
      case 'assigned':
        break;
    }
  }
  return scope;
}
