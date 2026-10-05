/**
 * Which people a member may see for one permission (ADR 0003 §4.2 "scopeFilter"), as plain data so the
 * authorization package can build it from grants and the database package can turn it into SQL
 * without depending on each other. The union of the parts applies; an empty scope covers nobody.
 */
export interface PersonScope {
  /** Everyone in the organization (a `tenant` grant). */
  readonly all: boolean;
  /** The member's own person (`own`). */
  readonly self: boolean;
  /** People whose direct manager is the member (`direct_reports`). */
  readonly directReports: boolean;
  /** People with the member anywhere above them in the manager chain (`reports_tree`). */
  readonly reportsTree: boolean;
  /** People placed in these departments (and, when flagged, their sub-departments) (`org_units`). */
  readonly departments: readonly {
    readonly ids: readonly string[];
    readonly includeDescendants: boolean;
  }[];
  /** People placed in these branches (`branches`). */
  readonly branchIds: readonly string[];
}

export const EMPTY_PERSON_SCOPE: PersonScope = {
  all: false,
  self: false,
  directReports: false,
  reportsTree: false,
  departments: [],
  branchIds: [],
};

export function isEmptyPersonScope(scope: PersonScope): boolean {
  return (
    !scope.all &&
    !scope.self &&
    !scope.directReports &&
    !scope.reportsTree &&
    scope.departments.every((d) => d.ids.length === 0) &&
    scope.branchIds.length === 0
  );
}
