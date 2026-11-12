import type { ActorContext } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionDefinition } from '../permissions';
import { platformPermissions } from '../platform-permissions';
import { giveHeadRole } from './head-role';

const db = vi.hoisted(() => ({
  getEditableRole: vi.fn(),
  lockTenantRoles: vi.fn(() => Promise.resolve()),
  replaceMemberRole: vi.fn(),
  insertAuditEvent: vi.fn(() => Promise.resolve()),
}));
vi.mock('@jadarat/platform-db', () => db);

const SARA = '44444444-4444-4444-8444-444444444444';
const SALES = '55555555-5555-4555-8555-555555555555';
const OPS = '66666666-6666-4666-8666-666666666666';
const ACTOR = { tenantId: 't', userId: 'u', personId: 'p' } as unknown as ActorContext;
const TOKEN = 'learner:5c1d2b3f-9a4e-4d2f-8b8c-3e6f7a8b9c0d:1';

/** A transaction whose savepoint runs the work and rethrows what it throws (as PostgreSQL rolls back). */
const savepoint = vi.fn((work: (tx: unknown) => Promise<unknown>) => work(TX));
const TX = { transaction: savepoint } as unknown as UserTx;

const ctx = (held: readonly PermissionDefinition[]) => ({
  tx: TX,
  actor: ACTOR,
  can: (permission: PermissionDefinition) => held.includes(permission),
});
const HR = ctx([platformPermissions['platform.role.assign']]);

const editable = (over: Record<string, unknown> = {}) => ({
  personId: SARA,
  membershipId: 'm1',
  membershipStatus: 'active',
  isSelf: false,
  mayManage: true,
  roleCode: 'learner',
  scopeUnitId: null,
  version: TOKEN,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.getEditableRole.mockResolvedValue(editable());
  db.replaceMemberRole.mockResolvedValue({
    ok: true,
    before: 'learner',
    after: 'department_head',
    beforeUnit: null,
    afterUnit: null,
    changed: true,
  });
});

describe('giveHeadRole (WP-FIX-03: picking a head gives the Department Head role)', () => {
  it('an Employee becomes a Department Head, under the role lock, audited as automatic with the units', async () => {
    expect(await giveHeadRole(HR, SARA, [SALES, OPS], 'unit_head')).toEqual({
      kind: 'given',
      personId: SARA,
      before: 'learner',
    });
    expect(db.lockTenantRoles.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      db.getEditableRole.mock.invocationCallOrder[0] ?? 0,
    );
    expect(savepoint).toHaveBeenCalledTimes(1);
    expect(db.replaceMemberRole).toHaveBeenCalledWith(TX, SARA, TOKEN, 'department_head', {
      isLocked: expect.any(Function),
    });
    // The ordinary path: a privileged role is never touched here.
    const isLocked = (
      db.replaceMemberRole.mock.lastCall?.[4] as { isLocked: (code: string) => boolean }
    ).isLocked;
    expect(isLocked('department_head')).toBe(false);
    expect(isLocked('learner')).toBe(false);
    expect(isLocked('hr_manager')).toBe(true);
    expect(db.insertAuditEvent).toHaveBeenCalledWith(TX, ACTOR, {
      action: 'platform.user.roles_changed',
      entityType: 'person',
      entityId: SARA,
      data: {
        before: 'learner',
        after: 'department_head',
        automatic: true,
        reason: 'unit_head',
        unitIds: [SALES, OPS].sort(),
      },
    });
  });

  it('a member without a role yet is given it too', async () => {
    db.getEditableRole.mockResolvedValue(editable({ roleCode: null, version: '' }));
    expect(await giveHeadRole(HR, SARA, [SALES], 'unit_import')).toMatchObject({
      kind: 'given',
      before: null,
    });
    expect(db.replaceMemberRole).toHaveBeenCalledWith(
      TX,
      SARA,
      '',
      'department_head',
      expect.anything(),
    );
  });

  it('any other role is kept: a person holds one role (EP-ROLES)', async () => {
    for (const roleCode of [
      'hr_manager',
      'training_manager',
      'training_coordinator',
      'tenant_admin',
      'custom_a00000000001',
    ]) {
      db.getEditableRole.mockResolvedValue(editable({ roleCode }));
      expect(await giveHeadRole(HR, SARA, [SALES], 'unit_head'), roleCode).toEqual({
        kind: 'kept',
        personId: SARA,
        roleCode,
      });
    }
    db.getEditableRole.mockResolvedValue(editable({ roleCode: 'department_head' }));
    expect(await giveHeadRole(HR, SARA, [SALES], 'unit_head')).toEqual({
      kind: 'already',
      personId: SARA,
    });
    expect(db.replaceMemberRole).not.toHaveBeenCalled();
    expect(db.insertAuditEvent).not.toHaveBeenCalled();
  });

  it('no account here (or a revoked one): nothing to change', async () => {
    for (const row of [
      null,
      editable({ membershipId: null, membershipStatus: null }),
      editable({ membershipStatus: 'revoked' }),
    ]) {
      db.getEditableRole.mockResolvedValue(row);
      expect(await giveHeadRole(HR, SARA, [SALES], 'unit_head')).toEqual({
        kind: 'no_account',
        personId: SARA,
      });
    }
    expect(db.replaceMemberRole).not.toHaveBeenCalled();
  });

  it('only when the member could change the role in Team members: never themselves, a person they manage, platform.role.assign', async () => {
    const refused = { kind: 'not_allowed', personId: SARA, roleCode: 'learner' };
    db.getEditableRole.mockResolvedValue(editable({ isSelf: true }));
    expect(await giveHeadRole(HR, SARA, [SALES], 'unit_head')).toEqual(refused);
    db.getEditableRole.mockResolvedValue(editable({ mayManage: false }));
    expect(await giveHeadRole(HR, SARA, [SALES], 'unit_head')).toEqual(refused);
    db.getEditableRole.mockResolvedValue(editable());
    // A custom role that manages the structure but gives no roles.
    const structureOnly = ctx([platformPermissions['platform.org.manage']]);
    expect(await giveHeadRole(structureOnly, SARA, [SALES], 'unit_head')).toEqual(refused);
    expect(db.replaceMemberRole).not.toHaveBeenCalled();
    expect(db.insertAuditEvent).not.toHaveBeenCalled();
  });

  it('a refusal of the database guard is rolled back to the savepoint: the unit change is kept, no audit', async () => {
    db.replaceMemberRole.mockResolvedValue({ ok: false, refusal: 'not_allowed' });
    expect(await giveHeadRole(HR, SARA, [SALES], 'head_hand_over')).toEqual({
      kind: 'not_allowed',
      personId: SARA,
      roleCode: 'learner',
    });
    expect(savepoint).toHaveBeenCalledTimes(1);
    expect(db.insertAuditEvent).not.toHaveBeenCalled();
    // Anything unexpected is not swallowed.
    db.replaceMemberRole.mockRejectedValue(new Error('connection lost'));
    await expect(giveHeadRole(HR, SARA, [SALES], 'unit_head')).rejects.toThrow('connection lost');
  });
});
