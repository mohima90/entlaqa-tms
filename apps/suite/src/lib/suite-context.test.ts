import { describe, expect, it, vi } from 'vitest';
import { loadMemberGrants, type Grant } from '@jadarat/platform-rbac';
import { getConfigStatus } from './config-status';
import { getSessionState } from './session-state';
import { getSuiteContext, navigationFor } from './suite-context';
import { myIdentityQuery } from './users-queries';

vi.mock('@jadarat/platform-rbac', () => ({
  loadMemberGrants: vi.fn(),
  platformPermissions: {
    'platform.user.read': { code: 'platform.user.read' },
    'platform.role.read': { code: 'platform.role.read' },
    'platform.tenant.read': { code: 'platform.tenant.read' },
    'platform.tenant.manage': { code: 'platform.tenant.manage' },
  },
}));
vi.mock('./session-state', () => ({ getSessionState: vi.fn(), redirectFor: vi.fn(() => null) }));
vi.mock('./config-status', () => ({ getConfigStatus: vi.fn() }));
vi.mock('./users-queries', () => ({ myIdentityQuery: vi.fn() }));

describe('navigationFor', () => {
  it('shows Users to members who see more than themselves', () => {
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'direct_reports' } }]),
    ).toEqual({
      users: true,
      roles: false,
      security: false,
      organizationSetup: false,
      training: true,
    });
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'tenant' } }]),
    ).toEqual({
      users: true,
      roles: false,
      security: false,
      organizationSetup: false,
      training: true,
    });
  });

  it('hides Users from learners (own record only) and members without the permission', () => {
    expect(navigationFor([{ permission: 'platform.user.read', scope: { type: 'own' } }])).toEqual({
      users: false,
      roles: false,
      security: false,
      organizationSetup: false,
      training: true,
    });
    expect(navigationFor([{ permission: 'platform.org.read', scope: { type: 'tenant' } }])).toEqual(
      {
        users: false,
        roles: false,
        security: false,
        organizationSetup: false,
        training: true,
      },
    );
    expect(navigationFor([])).toEqual({
      users: false,
      roles: false,
      security: false,
      organizationSetup: false,
      training: true,
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
      organizationSetup: false,
      training: true,
    });
    expect(
      navigationFor([{ permission: 'platform.role.read', scope: { type: 'direct_reports' } }]),
    ).toEqual({
      users: false,
      roles: false,
      security: false,
      organizationSetup: false,
      training: true,
    });
  });

  it('shows Security to members who read the organization settings (T-M2-10)', () => {
    expect(
      navigationFor([{ permission: 'platform.tenant.read', scope: { type: 'tenant' } }]),
    ).toEqual({
      users: false,
      roles: false,
      security: true,
      organizationSetup: false,
      training: true,
    });
    expect(navigationFor([{ permission: 'platform.tenant.read', scope: { type: 'own' } }])).toEqual(
      { users: false, roles: false, security: false, organizationSetup: false, training: true },
    );
  });

  it('shows every entry in the data-less preview', () => {
    expect(navigationFor(null)).toEqual({
      users: true,
      roles: true,
      security: true,
      organizationSetup: true,
      training: true,
    });
  });

  it('gives organization-wide `platform.tenant.manage` (the Organization Admin) the set-up sections and no training entries', () => {
    expect(
      navigationFor([{ permission: 'platform.tenant.manage', scope: { type: 'tenant' } }]),
    ).toEqual({
      users: false,
      roles: false,
      security: false,
      organizationSetup: true,
      training: false,
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
      defaultLocale: 'ar',
    });
  });
});
