import type { Aal } from '@jadarat/platform-core';
import type { PermissionDefinition } from './permissions';
import { type DataScope, type ResourceAttributes, scopeCovers } from './scopes';

/** A role assignment's permission with its data scope (effective grants = union of assignments). */
export interface Grant {
  readonly permission: string;
  readonly scope: DataScope;
  readonly validFrom?: Date;
  readonly validUntil?: Date;
  /** Set when the grant comes from a time-boxed delegation (FR-IAM-14). */
  readonly delegatedByPersonId?: string;
}

export interface AuthorizationSubject {
  readonly tenantId: string;
  readonly personId: string | null;
  readonly aal: Aal;
  readonly grants: readonly Grant[];
}

/**
 * - missing_permission → 403: no active grant for the permission at all.
 * - insufficient_scope → 403: grants exist, but none is tenant-wide for an action without a resource.
 * - out_of_scope → 404: resource in another tenant, unresolved, or outside every grant's scope.
 * - step_up_required: the permission requires AAL2 and the session is AAL1.
 */
export type DenyReason =
  'missing_permission' | 'insufficient_scope' | 'out_of_scope' | 'step_up_required';

export type AuthorizationDecision =
  | {
      readonly allowed: true;
      /**
       * The grants that authorize this call (never empty):
       * - with a resource: every active grant whose scope covers it;
       * - tenant-wide (no resource): the active `tenant`-scope grants;
       * - scoped (no resource, `scoped: true`): ALL active grants for the permission — the caller must
       *   restrict its queries to their union with scopeFilter (ADR 0003 §4.2).
       */
      readonly grants: readonly [Grant, ...Grant[]];
    }
  | { readonly allowed: false; readonly reason: DenyReason };

export interface AuthorizeOptions {
  /**
   * For actions without a single resource (lists, bulk operations) that restrict what they touch by
   * the member's scopes themselves. Without it, an action without a resource is TENANT-WIDE and needs
   * a grant with scope `tenant`: an `own` or `org_units` grant must never authorize it.
   */
  readonly scoped?: boolean;
  readonly now?: Date;
}

function grantActive(grant: Grant, now: Date): boolean {
  if (grant.validFrom && now < grant.validFrom) return false;
  if (grant.validUntil && now >= grant.validUntil) return false;
  return true;
}

function isNonEmpty(grants: readonly Grant[]): grants is readonly [Grant, ...Grant[]] {
  return grants.length > 0;
}

/** The grants that authorize the target, or why none does (AAL is checked afterwards). */
function authorizingGrants(
  subject: AuthorizationSubject,
  active: readonly [Grant, ...Grant[]],
  resource: ResourceAttributes | null | undefined,
  scoped: boolean,
): readonly [Grant, ...Grant[]] | DenyReason {
  if (resource === null || (resource !== undefined && resource.tenantId !== subject.tenantId)) {
    return 'out_of_scope';
  }
  if (resource !== undefined) {
    const covering = active.filter((g) => scopeCovers(g.scope, subject.personId, resource));
    return isNonEmpty(covering) ? covering : 'out_of_scope';
  }
  if (scoped) return active;
  const tenantWide = active.filter((g) => g.scope.type === 'tenant');
  return isNonEmpty(tenantWide) ? tenantWide : 'insufficient_scope';
}

/**
 * Decides whether `subject` may perform `permission` — on `resource` when given, else tenant-wide
 * (or scoped with `options.scoped`). Deny by default; see DenyReason for the outcomes.
 */
export function authorize(
  subject: AuthorizationSubject,
  permission: PermissionDefinition,
  resource?: ResourceAttributes | null,
  options: AuthorizeOptions = {},
): AuthorizationDecision {
  const now = options.now ?? new Date();
  const active = subject.grants.filter(
    (g) => g.permission === permission.code && grantActive(g, now),
  );
  if (!isNonEmpty(active)) return { allowed: false, reason: 'missing_permission' };

  const grants = authorizingGrants(subject, active, resource, options.scoped === true);
  if (typeof grants === 'string') return { allowed: false, reason: grants };

  if (permission.requiresAal2 && subject.aal !== 'aal2') {
    return { allowed: false, reason: 'step_up_required' };
  }
  return { allowed: true, grants };
}
