import { type AppError, appError } from '@jadarat/platform-core';

/**
 * Plans (WP-ADM-06, FR-ADM-13): the feature a permission belongs to — the same mapping as the database's
 * private.permission_feature (migration 20261027100000). A permission of a feature the organization's plan
 * does not include is held by nobody: the grant loader leaves it out here, the database leaves it out of
 * private.member_permissions (every guard and policy). Null: always included (people, structure, roles,
 * settings, My profile).
 */
export type PlanFeatureCode =
  'planning' | 'needs_forms' | 'courses' | 'bulk_import' | 'branding' | 'email_integration';

export function permissionFeature(permission: string): PlanFeatureCode | null {
  // Needs entry (WP-LD-01) belongs to planning: no planning in the plan, no needs to enter.
  if (permission.startsWith('tms.plan_cycle.') || permission.startsWith('tms.plan_needs.')) {
    return 'planning';
  }
  if (permission.startsWith('tms.needs_form.')) return 'needs_forms';
  if (permission.startsWith('tms.course.') || permission.startsWith('tms.course_cost.')) {
    return 'courses';
  }
  return null;
}

/** Keeps the grants whose permission is always included or whose feature the organization has. */
export function grantsWithinPlan<G extends { readonly permission: string }>(
  grants: readonly G[],
  features: readonly string[],
): G[] {
  return grants.filter((g) => {
    const feature = permissionFeature(g.permission);
    return feature === null || features.includes(feature);
  });
}

/**
 * A refusal of the organization's plan raised by the database at the moment of the action (WP-ADM-06): JL001
 * people limit, JL002 storage limit, JL003 a feature not in the plan — as the client's error (the action's
 * transaction is rolled back); null for anything else. The SQLSTATE is read from the error or its causes
 * (postgres.js errors wrapped by Drizzle).
 */
export function planRefusal(error: unknown): AppError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === 'JL001') return appError('PLAN_PEOPLE_LIMIT');
    if (code === 'JL002') return appError('PLAN_STORAGE_LIMIT');
    if (code === 'JL003') return appError('PLAN_FEATURE_OFF');
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
