import { describe, expect, it } from 'vitest';
import { grantsWithinPlan, permissionFeature } from './plan-features';

describe('plan features (WP-ADM-06): the database mapping, on the app side', () => {
  it('maps the training permissions to their feature; the platform ones are always included', () => {
    expect(permissionFeature('tms.plan_cycle.manage')).toBe('planning');
    expect(permissionFeature('tms.needs_form.read')).toBe('needs_forms');
    expect(permissionFeature('tms.course.archive')).toBe('courses');
    expect(permissionFeature('tms.course_cost.read')).toBe('courses');
    expect(permissionFeature('platform.user.invite')).toBeNull();
    expect(permissionFeature('platform.tenant.manage')).toBeNull();
  });

  it('a feature the plan does not include is held by nobody', () => {
    const grants = [
      { permission: 'tms.course.read' },
      { permission: 'tms.plan_cycle.read' },
      { permission: 'platform.user.read' },
    ];
    expect(grantsWithinPlan(grants, ['planning']).map((g) => g.permission)).toEqual([
      'tms.plan_cycle.read',
      'platform.user.read',
    ]);
    expect(grantsWithinPlan(grants, []).map((g) => g.permission)).toEqual(['platform.user.read']);
  });
});
