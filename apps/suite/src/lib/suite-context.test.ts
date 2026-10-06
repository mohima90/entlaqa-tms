import { describe, expect, it, vi } from 'vitest';
import { navigationFor } from './suite-context';

vi.mock('@jadarat/platform-rbac', () => ({
  loadMemberGrants: vi.fn(),
  platformPermissions: { 'platform.user.read': { code: 'platform.user.read' } },
}));
vi.mock('./session-state', () => ({ getSessionState: vi.fn() }));
vi.mock('./config-status', () => ({ getConfigStatus: vi.fn() }));
vi.mock('./users-queries', () => ({ myIdentityQuery: vi.fn() }));

describe('navigationFor', () => {
  it('shows Users to members who see more than themselves', () => {
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'direct_reports' } }]),
    ).toEqual({ users: true });
    expect(
      navigationFor([{ permission: 'platform.user.read', scope: { type: 'tenant' } }]),
    ).toEqual({ users: true });
  });

  it('hides Users from learners (own record only) and members without the permission', () => {
    expect(navigationFor([{ permission: 'platform.user.read', scope: { type: 'own' } }])).toEqual({
      users: false,
    });
    expect(navigationFor([{ permission: 'platform.org.read', scope: { type: 'tenant' } }])).toEqual(
      {
        users: false,
      },
    );
    expect(navigationFor([])).toEqual({ users: false });
  });

  it('shows every entry in the data-less preview', () => {
    expect(navigationFor(null)).toEqual({ users: true });
  });
});
