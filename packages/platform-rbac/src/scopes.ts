/** Data scopes (ADR 0003 §3): which records a role assignment covers. */
export type DataScope =
  | { readonly type: 'own' }
  | { readonly type: 'direct_reports' }
  | { readonly type: 'reports_tree' }
  | {
      readonly type: 'org_units';
      readonly orgUnitIds: readonly string[];
      readonly includeDescendants: boolean;
    }
  | { readonly type: 'branches'; readonly branchIds: readonly string[] }
  | { readonly type: 'legal_entity'; readonly legalEntityIds: readonly string[] }
  | { readonly type: 'tenant' }
  | { readonly type: 'assigned' };

export type DataScopeType = DataScope['type'];

/**
 * Attributes of a concrete resource needed to evaluate scopes. Loaded server-side (never from the
 * client) by the resource resolver of the action.
 */
export interface ResourceAttributes {
  readonly type: string;
  readonly id: string;
  readonly tenantId: string;
  /** The person the record is about (e.g., the learner of an enrollment). */
  readonly subjectPersonId?: string;
  /** Direct manager of the subject person. */
  readonly subjectManagerPersonId?: string;
  /** All managers above the subject (direct and indirect). */
  readonly subjectManagerChain?: readonly string[];
  /** Org unit of the record and its ancestors (nearest first). */
  readonly orgUnitId?: string;
  readonly orgUnitAncestorIds?: readonly string[];
  readonly branchId?: string;
  readonly legalEntityId?: string;
  /** Persons explicitly assigned to the resource (instructor, mentor, provider staff). */
  readonly assigneePersonIds?: readonly string[];
}

/** Does `scope`, held by `personId`, cover `resource`? Unknown data → not covered (deny by default). */
export function scopeCovers(
  scope: DataScope,
  personId: string | null,
  resource: ResourceAttributes,
): boolean {
  switch (scope.type) {
    case 'tenant':
      return true;
    case 'own':
      return personId !== null && resource.subjectPersonId === personId;
    case 'direct_reports':
      return personId !== null && resource.subjectManagerPersonId === personId;
    case 'reports_tree':
      return (
        personId !== null &&
        (resource.subjectManagerPersonId === personId ||
          (resource.subjectManagerChain ?? []).includes(personId))
      );
    case 'org_units': {
      if (resource.orgUnitId === undefined) return false;
      if (scope.orgUnitIds.includes(resource.orgUnitId)) return true;
      return (
        scope.includeDescendants &&
        (resource.orgUnitAncestorIds ?? []).some((id) => scope.orgUnitIds.includes(id))
      );
    }
    case 'branches':
      return resource.branchId !== undefined && scope.branchIds.includes(resource.branchId);
    case 'legal_entity':
      return (
        resource.legalEntityId !== undefined &&
        scope.legalEntityIds.includes(resource.legalEntityId)
      );
    case 'assigned':
      return personId !== null && (resource.assigneePersonIds ?? []).includes(personId);
  }
}
