import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  CustomRoleInput,
  createCustomRoleActionDefinition,
  deleteCustomRoleActionDefinition,
  updateCustomRoleActionDefinition,
} from './custom-roles';

const db = vi.hoisted(() => ({
  createCustomRole: vi.fn(),
  updateCustomRole: vi.fn(),
  deleteCustomRole: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const ROLE_ID = '44444444-4444-4444-8444-444444444444';

function runtime(roles: TestRoleCode[]) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const getClaims = vi.fn((_options: { strict: boolean }) => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal: 'aal1',
      tenant_id: '22222222-2222-4222-8222-222222222222',
      person_id: '33333333-3333-4333-8333-333333333333',
    });
    if (!r.ok) throw new Error('fixture');
    return Promise.resolve(ok(r.value));
  });
  const rt: ActionRuntime<UserTx> = {
    getClaims,
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () => Promise.resolve(testRoleGrants(roles)),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit, getClaims };
}

const input = {
  nameEn: ' Finance approver ',
  nameAr: 'معتمد مالي',
  description: '',
  dataScope: 'organization' as const,
  permissions: ['platform.user.read', 'platform.audit.read'],
};
const row = (over: Record<string, unknown> = {}) => ({
  id: ROLE_ID,
  code: 'custom_a00000000001',
  nameAr: 'معتمد مالي',
  nameEn: 'Finance approver',
  description: null,
  dataScope: 'organization',
  permissions: ['platform.audit.read', 'platform.user.read'],
  memberCount: 0,
  pendingInvitationCount: 0,
  version: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.createCustomRole.mockResolvedValue({ ok: true, before: null, after: row() });
  db.updateCustomRole.mockResolvedValue({
    ok: true,
    before: row(),
    after: row({ version: 2, nameEn: 'Approver' }),
  });
  db.deleteCustomRole.mockResolvedValue({ ok: true, before: row(), after: null });
});

describe('custom role input', () => {
  it('trims names, empties the description, accepts catalogue permissions once', () => {
    expect(CustomRoleInput.parse(input)).toEqual({
      ...input,
      nameEn: 'Finance approver',
      description: null,
    });
    for (const bad of [
      { ...input, nameEn: ' ' },
      { ...input, nameAr: 'x'.repeat(81) },
      { ...input, description: 'x'.repeat(501) },
      { ...input, dataScope: 'branch' },
      { ...input, permissions: ['platform.role.manage'] },
      { ...input, permissions: ['platform.user.read', 'platform.user.read'] },
      { ...input, code: 'custom_0123456789ab' },
    ]) {
      expect(CustomRoleInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('create custom role (FR-IAM-07)', () => {
  it('the Organization Admin creates it (strict session check), audited with the role after', async () => {
    const { rt, writeAudit, getClaims } = runtime(['tenant_admin']);
    const result = await createDefineAction(rt)(createCustomRoleActionDefinition())(input);
    expect(result).toEqual(
      ok({ id: ROLE_ID, code: 'custom_a00000000001', before: null, after: row() }),
    );
    expect(db.createCustomRole).toHaveBeenCalledWith(TX, {
      ...input,
      nameEn: 'Finance approver',
      description: null,
    });
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.role.created',
      entityType: 'custom_role',
      entityId: ROLE_ID,
      data: {
        before: null,
        after: {
          code: 'custom_a00000000001',
          nameEn: 'Finance approver',
          nameAr: 'معتمد مالي',
          dataScope: 'organization',
          permissions: ['platform.audit.read', 'platform.user.read'],
        },
      },
    });
  });

  it('nobody else builds roles: HR Manager, L&D Manager, Employee → FORBIDDEN', async () => {
    for (const roles of [['hr_manager'], ['training_manager'], ['learner']] as TestRoleCode[][]) {
      const result = await createDefineAction(runtime(roles).rt)(createCustomRoleActionDefinition())(
        input,
      );
      expect(!result.ok && result.error.code, roles[0]).toBe('FORBIDDEN');
    }
    expect(db.createCustomRole).not.toHaveBeenCalled();
  });

  it('the builder rules: held permissions only, administrative ones organization-wide only', async () => {
    const create = createDefineAction(runtime(['tenant_admin']).rt)(
      createCustomRoleActionDefinition(),
    );
    const notHeld = await create({ ...input, permissions: ['platform.org.manage'] });
    expect(!notHeld.ok && notHeld.error.fieldErrors).toEqual([
      { path: 'permissions', code: 'PERMISSION_NOT_HELD' },
    ]);
    const scoped = await create({
      ...input,
      dataScope: 'team',
      permissions: ['platform.user.read', 'platform.user.invite'],
    });
    expect(!scoped.ok && scoped.error.fieldErrors).toEqual([
      { path: 'permissions', code: 'NEEDS_ORGANIZATION_SCOPE' },
    ]);
    expect(db.createCustomRole).not.toHaveBeenCalled();
  });

  it('maps database refusals to field errors', async () => {
    const create = createDefineAction(runtime(['tenant_admin']).rt)(
      createCustomRoleActionDefinition(),
    );
    const cases: [string, Record<string, unknown>][] = [
      ['name_en_taken', { fieldErrors: [{ path: 'nameEn', code: 'NAME_TAKEN' }] }],
      ['name_ar_taken', { fieldErrors: [{ path: 'nameAr', code: 'NAME_TAKEN' }] }],
      [
        'needs_organization_scope',
        { fieldErrors: [{ path: 'dataScope', code: 'NEEDS_ORGANIZATION_SCOPE' }] },
      ],
      ['not_allowed', { code: 'FORBIDDEN' }],
    ];
    for (const [refusal, error] of cases) {
      db.createCustomRole.mockResolvedValueOnce({ ok: false, refusal });
      const result = await create(input);
      expect(!result.ok && result.error, refusal).toMatchObject(error);
    }
  });
});

describe('update and delete', () => {
  it('update: audited with before and after; stale version and unknown role are refused', async () => {
    const { rt, writeAudit } = runtime(['tenant_admin']);
    const update = createDefineAction(rt)(updateCustomRoleActionDefinition());
    const result = await update({ ...input, id: ROLE_ID, version: 1 });
    expect(result.ok).toBe(true);
    expect(db.updateCustomRole).toHaveBeenCalledWith(TX, ROLE_ID, 1, expect.objectContaining({
      nameEn: 'Finance approver',
    }));
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'platform.role.updated',
        data: {
          before: expect.objectContaining({ nameEn: 'Finance approver' }) as never,
          after: expect.objectContaining({ nameEn: 'Approver' }) as never,
        },
      }),
    );
    db.updateCustomRole.mockResolvedValueOnce({ ok: false, refusal: 'version_conflict' });
    const stale = await update({ ...input, id: ROLE_ID, version: 1 });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    db.updateCustomRole.mockResolvedValueOnce({ ok: false, refusal: 'not_found' });
    const missing = await update({ ...input, id: ROLE_ID, version: 1 });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    const hr = await createDefineAction(runtime(['hr_manager']).rt)(
      updateCustomRoleActionDefinition(),
    )({ ...input, id: ROLE_ID, version: 1 });
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
  });

  it('delete: only a role nobody holds — otherwise the numbers come back', async () => {
    const { rt, writeAudit } = runtime(['tenant_admin']);
    const remove = createDefineAction(rt)(deleteCustomRoleActionDefinition());
    expect((await remove({ id: ROLE_ID, version: 1 })).ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({ action: 'platform.role.deleted', data: expect.objectContaining({ after: null }) }),
    );
    db.deleteCustomRole.mockResolvedValueOnce({
      ok: false,
      refusal: 'in_use',
      holders: { members: 3, invitations: 1 },
    });
    const held = await remove({ id: ROLE_ID, version: 1 });
    expect(!held.ok && held.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ path: 'role', code: 'ROLE_IN_USE' }],
      params: { members: 3, invitations: 1 },
    });
    db.deleteCustomRole.mockResolvedValueOnce({ ok: false, refusal: 'in_use' });
    const raced = await remove({ id: ROLE_ID, version: 1 });
    expect(!raced.ok && raced.error.fieldErrors).toEqual([{ path: 'role', code: 'ROLE_IN_USE' }]);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });
});
