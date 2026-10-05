import { EMPTY_PERSON_SCOPE, type PersonScope } from '@jadarat/platform-core';
import type { Grant } from './authorize';

/**
 * The people covered by the given grants (normally `ctx.grants` of a `scoped` query for one permission,
 * already filtered to active grants by authorize()). `assigned` and `legal_entity` scopes cover no
 * person records (they apply to sessions, providers, … and legal entities are R3).
 */
export function personScopeFromGrants(grants: readonly Grant[]): PersonScope {
  let scope: PersonScope = EMPTY_PERSON_SCOPE;
  for (const { scope: s } of grants) {
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
