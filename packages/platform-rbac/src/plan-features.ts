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
  if (permission.startsWith('tms.plan_cycle.')) return 'planning';
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
