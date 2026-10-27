import { describe, expect, it } from 'vitest';
import { grantsWithinPlan, permissionFeature } from './plan-features';

describe('plan features (WP-ADM-06): the database mapping, on the app side', () => {
  it('maps the training permissions to their feature; the platform ones are always included', () => {
    expect(permissionFeature('tms.plan_cycle.manage')).toBe('planning');
    expect(permissionFeature('tms.plan_needs.submit')).toBe('planning');
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

describe('planRefusal (WP-ADM-06): the database refuses at the moment of the action', () => {
  it('maps JL001–JL003 (also wrapped as a cause) to the client errors; anything else to null', async () => {
    const { planRefusal } = await import('./plan-features');
    expect(planRefusal({ code: 'JL001' })?.code).toBe('PLAN_PEOPLE_LIMIT');
    expect(planRefusal(new Error('query failed', { cause: { code: 'JL002' } }))?.code).toBe(
      'PLAN_STORAGE_LIMIT',
    );
    expect(planRefusal({ code: 'JL003' })?.code).toBe('PLAN_FEATURE_OFF');
    expect(planRefusal({ code: '23505' })).toBeNull();
    expect(planRefusal(new Error('x'))).toBeNull();
    expect(planRefusal(null)).toBeNull();
  });
});
