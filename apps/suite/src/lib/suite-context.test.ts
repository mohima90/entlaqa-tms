import { describe, expect, it, vi } from 'vitest';
import { navigationFor } from './suite-context';

vi.mock('@jadarat/platform-rbac', () => ({
  loadMemberGrants: vi.fn(),
  platformPermissions: {
    'platform.user.read': { code: 'platform.user.read' },
    'platform.role.read': { code: 'platform.role.read' },
    'platform.tenant.read': { code: 'platform.tenant.read' },
  },
}));
vi.mock('./session-state', () => ({ getSessionState: vi.fn() }));
vi.mock('./config-status', () => ({ getConfigStatus: vi.fn() }));
vi.mock('./users-queries', () => ({ myIdentityQuery: vi.fn() }));

describe('navigationFor', () => {
  it('shows Users to members who see more than themselves', () => {
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'direct_reports' } }]),
    ).toEqual({ users: true, roles: false, security: false });
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'tenant' } }]),
    ).toEqual({ users: true, roles: false, security: false });
  });

  it('hides Users from learners (own record only) and members without the permission', () => {
    expect(navigationFor([{ permission: 'platform.user.read', scope: { type: 'own' } }])).toEqual({
      users: false,
      roles: false,
      security: false,
    });
    expect(navigationFor([{ permission: 'platform.org.read', scope: { type: 'tenant' } }])).toEqual(
      {
        users: false,
        roles: false,
        security: false,
      },
    );
    expect(navigationFor([])).toEqual({ users: false, roles: false, security: false });
  });

  it('shows Roles & permissions to members who read the roles of the whole organization', () => {
    expect(
      navigationFor([
        { permission: 'platform.user.read', scope: { type: 'tenant' } },
        { permission: 'platform.role.read', scope: { type: 'tenant' } },
      ]),
    ).toEqual({ users: true, roles: true, security: false });
    expect(
      navigationFor([{ permission: 'platform.role.read', scope: { type: 'direct_reports' } }]),
    ).toEqual({ users: false, roles: false, security: false });
  });

  it('shows Security to members who read the organization settings (T-M2-10)', () => {
    expect(
      navigationFor([{ permission: 'platform.tenant.read', scope: { type: 'tenant' } }]),
    ).toEqual({ users: false, roles: false, security: true });
    expect(navigationFor([{ permission: 'platform.tenant.read', scope: { type: 'own' } }])).toEqual(
      { users: false, roles: false, security: false },
    );
  });

  it('shows every entry in the data-less preview', () => {
    expect(navigationFor(null)).toEqual({ users: true, roles: true, security: true });
  });
});
