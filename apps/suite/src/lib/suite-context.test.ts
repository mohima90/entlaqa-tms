import { describe, expect, it, vi } from 'vitest';
import { loadMemberGrants, type Grant } from '@jadarat/platform-rbac';
import { getConfigStatus } from './config-status';
import { getSessionState } from './session-state';
import { getSuiteContext, navigationFor } from './suite-context';
import { myIdentityQuery } from './users-queries';

vi.mock('@jadarat/platform-rbac', () => ({
  loadMemberGrants: vi.fn(),
  coursePermissions: { 'tms.course.read': { code: 'tms.course.read' } },
  platformPermissions: {
    'platform.user.read': { code: 'platform.user.read' },
    'platform.user.update': { code: 'platform.user.update' },
    'platform.role.read': { code: 'platform.role.read' },
    'platform.tenant.read': { code: 'platform.tenant.read' },
    'platform.tenant.manage': { code: 'platform.tenant.manage' },
    'platform.org.manage': { code: 'platform.org.manage' },
  },
  tmsPlanningPermissions: {
    'tms.plan_cycle.read': { code: 'tms.plan_cycle.read' },
    'tms.training_plan.approve': { code: 'tms.training_plan.approve' },
    'tms.training_plan.confirm': { code: 'tms.training_plan.confirm' },
    'tms.session.manage': { code: 'tms.session.manage' },
  },
  tmsRolePermissions: {
    'tms.needs_form.read': { code: 'tms.needs_form.read' },
    'tms.plan_needs.submit': { code: 'tms.plan_needs.submit' },
  },
}));
vi.mock('./session-state', () => ({ getSessionState: vi.fn(), redirectFor: vi.fn(() => null) }));
vi.mock('./config-status', () => ({ getConfigStatus: vi.fn() }));
vi.mock('./users-queries', () => ({ myIdentityQuery: vi.fn() }));
vi.mock('./training-plan-queries', () => ({
  approvalsCountQuery: vi.fn(() => Promise.resolve({ ok: true, value: { waiting: 2 } })),
}));

describe('navigationFor', () => {
  it('shows Users to members who see more than themselves', () => {
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'direct_reports' } }]),
    ).toEqual({
      users: true,
      roles: false,
      security: false,
      organizationProfile: false,
      structure: false,
      grades: false,
      organizationSetup: false,
      training: true,
      courses: false,
      calendar: false,
      planning: false,
      needsForms: false,
      needsEntry: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: false,
      approvalsWaiting: 0,
    });
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'tenant' } }]),
    ).toEqual({
      users: true,
      roles: false,
      security: false,
      organizationProfile: false,
      structure: false,
      grades: false,
      organizationSetup: false,
      training: true,
      courses: false,
      calendar: false,
      planning: false,
      needsForms: false,
      needsEntry: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: false,
      approvalsWaiting: 0,
    });
  });

  it('shows Grades to members who change people organization-wide (HR Manager, Organization Admin; WP-ADM-04)', () => {
    const update = (scope: Grant['scope']): Grant[] => [
      { permission: 'platform.user.update', scope },
    ];
    expect(navigationFor(update({ type: 'tenant' })).grades).toBe(true);
    expect(navigationFor(update({ type: 'direct_reports' })).grades).toBe(false);
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'tenant' } }]).grades,
    ).toBe(false);
    expect(navigationFor([]).grades).toBe(false);
    expect(navigationFor(null).grades).toBe(true);
  });

  it('hides Users from learners (own record only) and members without the permission', () => {
    expect(navigationFor([{ permission: 'platform.user.read', scope: { type: 'own' } }])).toEqual({
      users: false,
      roles: false,
      security: false,
      organizationProfile: false,
      structure: false,
      grades: false,
      organizationSetup: false,
      training: true,
      courses: false,
      calendar: false,
      planning: false,
      needsForms: false,
      needsEntry: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: false,
      approvalsWaiting: 0,
    });
    expect(navigationFor([{ permission: 'platform.org.read', scope: { type: 'tenant' } }])).toEqual(
      {
        users: false,
        roles: false,
        security: false,
        organizationProfile: false,
        structure: false,
        grades: false,
        organizationSetup: false,
        training: true,
        courses: false,
        calendar: false,
        planning: false,
        needsForms: false,
        needsEntry: false,
        branding: true,
        emailIntegration: true,
        bulkImport: true,
        approvals: false,
        approvalsWaiting: 0,
      },
    );
    expect(navigationFor([])).toEqual({
      users: false,
      roles: false,
      security: false,
      organizationProfile: false,
      structure: false,
      grades: false,
      organizationSetup: false,
      training: true,
      courses: false,
      calendar: false,
      planning: false,
      needsForms: false,
      needsEntry: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: false,
      approvalsWaiting: 0,
    });
  });

  it('shows Roles & permissions to members who read the roles of the whole organization', () => {
    expect(
      navigationFor([
        { permission: 'platform.user.read', scope: { type: 'tenant' } },
        { permission: 'platform.role.read', scope: { type: 'tenant' } },
      ]),
    ).toEqual({
      users: true,
      roles: true,
      security: false,
      organizationProfile: false,
      structure: false,
      grades: false,
      organizationSetup: false,
      training: true,
      courses: false,
      calendar: false,
      planning: false,
      needsForms: false,
      needsEntry: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: false,
      approvalsWaiting: 0,
    });
    expect(
      navigationFor([{ permission: 'platform.role.read', scope: { type: 'direct_reports' } }]),
    ).toEqual({
      users: false,
      roles: false,
      security: false,
      organizationProfile: false,
      structure: false,
      grades: false,
      organizationSetup: false,
      training: true,
      courses: false,
      calendar: false,
      planning: false,
      needsForms: false,
      needsEntry: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: false,
      approvalsWaiting: 0,
    });
  });

  it('shows Security to members who read the organization settings (T-M2-10)', () => {
    expect(
      navigationFor([{ permission: 'platform.tenant.read', scope: { type: 'tenant' } }]),
    ).toEqual({
      users: false,
      roles: false,
      security: true,
      organizationProfile: true,
      structure: false,
      grades: false,
      organizationSetup: false,
      training: true,
      courses: false,
      calendar: false,
      planning: false,
      needsForms: false,
      needsEntry: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: false,
      approvalsWaiting: 0,
    });
    expect(navigationFor([{ permission: 'platform.tenant.read', scope: { type: 'own' } }])).toEqual(
      {
        users: false,
        roles: false,
        security: false,
        organizationProfile: false,
        structure: false,
        grades: false,
        organizationSetup: false,
        training: true,
        courses: false,
        calendar: false,
        planning: false,
        needsForms: false,
        needsEntry: false,
        branding: true,
        emailIntegration: true,
        bulkImport: true,
        approvals: false,
        approvalsWaiting: 0,
      },
    );
  });

  it('shows Structure and Branches to the member who maintains them (platform.org.manage; T-M3-02)', () => {
    expect(
      navigationFor([
        { permission: 'platform.org.read', scope: { type: 'tenant' } },
        { permission: 'platform.org.manage', scope: { type: 'tenant' } },
      ]).structure,
    ).toBe(true);
    // Reading the structure opens the pages by their address, not the menu entry.
    expect(
      navigationFor([{ permission: 'platform.org.read', scope: { type: 'tenant' } }]).structure,
    ).toBe(false);
  });

  it('shows the course library to members who read it organization-wide (T-M3-03)', () => {
    expect(
      navigationFor([{ permission: 'tms.course.read', scope: { type: 'tenant' } }]).courses,
    ).toBe(true);
    expect(navigationFor([{ permission: 'tms.course.read', scope: { type: 'own' } }]).courses).toBe(
      false,
    );
  });

  it('shows the training calendar to members who plan draft sessions, in any scope (WP-LD-04)', () => {
    expect(
      navigationFor([{ permission: 'tms.session.manage', scope: { type: 'tenant' } }]).calendar,
    ).toBe(true);
    expect(
      navigationFor([
        {
          permission: 'tms.session.manage',
          scope: { type: 'org_units', orgUnitIds: ['u1'], includeDescendants: true },
        },
      ]).calendar,
    ).toBe(true);
    expect(
      navigationFor([{ permission: 'tms.plan_cycle.read', scope: { type: 'tenant' } }]).calendar,
    ).toBe(false);
  });

  it('shows Planning to members who read planning cycles organization-wide (EP-PLN)', () => {
    expect(
      navigationFor([{ permission: 'tms.plan_cycle.read', scope: { type: 'tenant' } }]),
    ).toMatchObject({ planning: true, training: true });
    expect(
      navigationFor([
        {
          permission: 'tms.plan_cycle.read',
          scope: { type: 'org_units', orgUnitIds: ['u1'], includeDescendants: true },
        },
      ]),
    ).toMatchObject({ planning: false });
  });

  it('shows Approvals to whoever decides a step of the training plan (WP-LD-03)', () => {
    for (const code of ['tms.training_plan.approve', 'tms.training_plan.confirm']) {
      expect(navigationFor([{ permission: code, scope: { type: 'tenant' } }])).toMatchObject({
        approvals: true,
        approvalsWaiting: 0,
      });
    }
    expect(
      navigationFor([{ permission: 'tms.training_plan.read', scope: { type: 'tenant' } }])
        .approvals,
    ).toBe(false);
  });

  it('shows every entry in the data-less preview', () => {
    expect(navigationFor(null)).toEqual({
      users: true,
      roles: true,
      security: true,
      organizationProfile: true,
      structure: true,
      grades: true,
      organizationSetup: true,
      training: true,
      courses: true,
      calendar: true,
      planning: true,
      needsForms: true,
      needsEntry: true,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: true,
      approvalsWaiting: 0,
    });
  });

  it('shows Planning → Needs forms to members who read the needs forms organization-wide (T-M3-10)', () => {
    expect(
      navigationFor([{ permission: 'tms.needs_form.read', scope: { type: 'tenant' } }]),
    ).toMatchObject({ needsForms: true, training: true });
    expect(
      navigationFor([
        {
          permission: 'tms.needs_form.read',
          scope: { type: 'org_units', orgUnitIds: ['u1'], includeDescendants: true },
        },
      ]),
    ).toMatchObject({ needsForms: false });
    // Never for the Organization Admin, a set-up role (BR-IAM-4), even with the permission.
    expect(
      navigationFor([
        { permission: 'platform.tenant.manage', scope: { type: 'tenant' } },
        { permission: 'tms.needs_form.read', scope: { type: 'tenant' } },
      ]),
    ).toMatchObject({ needsForms: false, training: false });
  });

  it('gives organization-wide `platform.tenant.manage` (the Organization Admin) the set-up sections and no training entries', () => {
    expect(
      navigationFor([{ permission: 'platform.tenant.manage', scope: { type: 'tenant' } }]),
    ).toEqual({
      users: false,
      roles: false,
      security: false,
      organizationProfile: false,
      structure: false,
      grades: false,
      organizationSetup: true,
      training: false,
      courses: false,
      calendar: false,
      planning: false,
      needsForms: false,
      needsEntry: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
      approvals: false,
      approvalsWaiting: 0,
    });
    // Any narrower scope is not enough (deny by default).
    const narrower: Grant['scope'][] = [
      { type: 'own' },
      { type: 'direct_reports' },
      { type: 'org_units', orgUnitIds: ['u1'], includeDescendants: true },
    ];
    for (const scope of narrower) {
      expect(navigationFor([{ permission: 'platform.tenant.manage', scope }])).toMatchObject({
        organizationSetup: false,
        training: true,
        courses: false,
        calendar: false,
        needsForms: false,
        needsEntry: false,
        branding: true,
        emailIntegration: true,
        bulkImport: true,
        approvals: false,
        approvalsWaiting: 0,
      });
    }
  });
});

describe('getSuiteContext: organization name and regional settings (T-M2-22)', () => {
  const tenant = {
    tenantId: 't1',
    nameAr: 'شركة الراية',
    nameEn: 'Al Raya Company' as string | null,
    sessionIdleMinutes: 30,
    regional: { dateDisplay: 'hijri', timeZone: 'Asia/Dubai', defaultLocale: 'en' } as const,
  };
  const live = (current: typeof tenant) => {
    vi.mocked(getConfigStatus).mockReturnValue({ auth: true, database: true });
    vi.mocked(getSessionState).mockResolvedValue({
      kind: 'organization',
      claims: {} as never,
      tenant: current,
    });
    vi.mocked(loadMemberGrants).mockResolvedValue({ ok: true, value: [] } as never);
    vi.mocked(myIdentityQuery).mockResolvedValue({ ok: false, error: {} } as never);
  };

  it('shows the display name in the UI language, else the other one', async () => {
    live(tenant);
    expect((await getSuiteContext('ar')).organizationName).toBe('شركة الراية');
    expect((await getSuiteContext('en')).organizationName).toBe('Al Raya Company');
    live({ ...tenant, nameEn: null });
    expect((await getSuiteContext('en')).organizationName).toBe('شركة الراية');
    live({ ...tenant, nameAr: '' });
    expect((await getSuiteContext('ar')).organizationName).toBe('Al Raya Company');
  });

  it("carries the organization's date display, time zone and default language", async () => {
    live(tenant);
    expect((await getSuiteContext('en')).regional).toEqual(tenant.regional);
  });

  it('uses the defaults in the preview without data', async () => {
    vi.mocked(getConfigStatus).mockReturnValue({ auth: false, database: false });
    expect((await getSuiteContext('en')).regional).toEqual({
      dateDisplay: 'gregorian',
      timeZone: 'Asia/Riyadh',
      defaultLocale: 'en',
    });
  });
});

describe('navigationFor × the plan (WP-ADM-06)', () => {
  it('shows own branding, own e-mail provider and bulk import only when the plan includes them', () => {
    const all = navigationFor([]);
    expect([all.branding, all.emailIntegration, all.bulkImport]).toEqual([true, true, true]);
    const some = navigationFor([], ['courses', 'bulk_import']);
    expect([some.branding, some.emailIntegration, some.bulkImport]).toEqual([false, false, true]);
  });
});
