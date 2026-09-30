import { describe, expect, it } from 'vitest';
import { type AuthorizationSubject, authorize } from './authorize';
import { definePermissions } from './permissions';

const label = { ar: 'اعتماد', en: 'Approve' };
const perms = definePermissions('tms', [
  {
    code: 'tms.enrollment.approve',
    label,
    description: label,
    risk: 'medium',
    requiresAal2: false,
  },
  { code: 'tms.settings.manage', label, description: label, risk: 'high', requiresAal2: true },
]);
const approve = perms['tms.enrollment.approve'];
const manage = perms['tms.settings.manage'];

const subject = (over: Partial<AuthorizationSubject> = {}): AuthorizationSubject => ({
  tenantId: 't1',
  personId: 'p-mgr',
  aal: 'aal1',
  grants: [{ permission: approve.code, scope: { type: 'direct_reports' } }],
  ...over,
});
const enrollment = {
  type: 'enrollment',
  id: 'e1',
  tenantId: 't1',
  subjectManagerPersonId: 'p-mgr',
};

describe('authorize (deny by default)', () => {
  it('allows when a grant covers the resource', () => {
    const decision = authorize(subject(), approve, enrollment);
    expect(decision.allowed).toBe(true);
  });

  it('denies with missing_permission when no grant exists (→ 403)', () => {
    expect(authorize(subject({ grants: [] }), approve, enrollment)).toEqual({
      allowed: false,
      reason: 'missing_permission',
    });
  });

  it('denies with out_of_scope for another tenant or an unresolved resource (→ 404)', () => {
    expect(authorize(subject(), approve, { ...enrollment, tenantId: 't2' })).toEqual({
      allowed: false,
      reason: 'out_of_scope',
    });
    expect(authorize(subject(), approve, null)).toEqual({ allowed: false, reason: 'out_of_scope' });
    expect(
      authorize(subject(), approve, { ...enrollment, subjectManagerPersonId: 'other' }),
    ).toEqual({
      allowed: false,
      reason: 'out_of_scope',
    });
  });

  it('tenant-wide actions (no resource) require a grant with scope tenant', () => {
    const tenantGrant = { permission: approve.code, scope: { type: 'tenant' } as const };
    const decision = authorize(subject({ grants: [tenantGrant] }), approve);
    expect(decision).toEqual({ allowed: true, grants: [tenantGrant] });
  });

  it('tenant-wide actions are DENIED for own / org_units / other non-tenant grants (→ 403)', () => {
    const narrow = [
      { permission: approve.code, scope: { type: 'own' } as const },
      {
        permission: approve.code,
        scope: { type: 'org_units', orgUnitIds: ['ou1'], includeDescendants: true } as const,
      },
      { permission: approve.code, scope: { type: 'direct_reports' } as const },
      { permission: approve.code, scope: { type: 'assigned' } as const },
    ];
    for (const grant of narrow) {
      expect(authorize(subject({ grants: [grant] }), approve)).toEqual({
        allowed: false,
        reason: 'insufficient_scope',
      });
    }
    expect(authorize(subject({ grants: narrow }), approve)).toEqual({
      allowed: false,
      reason: 'insufficient_scope',
    });
    // A tenant grant for ANOTHER permission does not help.
    expect(
      authorize(
        subject({ grants: [...narrow, { permission: manage.code, scope: { type: 'tenant' } }] }),
        approve,
      ),
    ).toEqual({ allowed: false, reason: 'insufficient_scope' });
  });

  it('scoped actions (no resource) receive ALL active grants for the permission', () => {
    const own = { permission: approve.code, scope: { type: 'own' } as const };
    const units = {
      permission: approve.code,
      scope: { type: 'org_units', orgUnitIds: ['ou1'], includeDescendants: false } as const,
    };
    const expired = {
      permission: approve.code,
      scope: { type: 'tenant' } as const,
      validUntil: new Date('2020-01-01T00:00:00Z'),
    };
    const other = { permission: manage.code, scope: { type: 'tenant' } as const };
    const decision = authorize(
      subject({ grants: [own, units, expired, other] }),
      approve,
      undefined,
      {
        scoped: true,
      },
    );
    expect(decision).toEqual({ allowed: true, grants: [own, units] });
    expect(authorize(subject({ grants: [other] }), approve, undefined, { scoped: true })).toEqual({
      allowed: false,
      reason: 'missing_permission',
    });
  });

  it('requires AAL2 for privileged permissions (step-up)', () => {
    const grants = [{ permission: manage.code, scope: { type: 'tenant' } as const }];
    expect(authorize(subject({ grants }), manage)).toEqual({
      allowed: false,
      reason: 'step_up_required',
    });
    expect(authorize(subject({ grants, aal: 'aal2' }), manage).allowed).toBe(true);
  });

  it('honours delegation windows (validFrom inclusive, validUntil exclusive)', () => {
    const now = new Date('2026-10-10T10:00:00Z');
    const delegated = {
      permission: approve.code,
      scope: { type: 'tenant' } as const,
      delegatedByPersonId: 'p-boss',
      validFrom: new Date('2026-10-01T00:00:00Z'),
      validUntil: new Date('2026-10-15T00:00:00Z'),
    };
    expect(authorize(subject({ grants: [delegated] }), approve, enrollment, { now }).allowed).toBe(
      true,
    );
    expect(
      authorize(subject({ grants: [delegated] }), approve, enrollment, {
        now: new Date('2026-10-15T00:00:00Z'),
      }),
    ).toEqual({ allowed: false, reason: 'missing_permission' });
    expect(
      authorize(subject({ grants: [delegated] }), approve, enrollment, {
        now: new Date('2026-09-30T23:59:59Z'),
      }),
    ).toEqual({ allowed: false, reason: 'missing_permission' });
  });

  it('uses the union of grants: any covering grant allows', () => {
    const grants = [
      { permission: approve.code, scope: { type: 'own' } as const },
      { permission: approve.code, scope: { type: 'branches', branchIds: ['b1'] } as const },
    ];
    const decision = authorize(subject({ grants }), approve, { ...enrollment, branchId: 'b1' });
    expect(decision.allowed && decision.grants.map((g) => g.scope.type)).toEqual(['branches']);
  });
});
