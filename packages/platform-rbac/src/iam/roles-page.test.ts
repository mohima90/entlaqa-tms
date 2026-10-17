import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grant } from '../authorize';
import type { ActionRuntime } from '../define-action';
import { createDefineQuery } from '../define-query';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  roleDetailQueryDefinition,
  roleEditorQueryDefinition,
  rolesPageQueryDefinition,
} from './roles-page';

const db = vi.hoisted(() => ({
  countMembersByRole: vi.fn(),
  listCustomRoles: vi.fn(),
  getCustomRole: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;

function runtime(grants: readonly Grant[]) {
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
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
    loadGrants: () => Promise.resolve(grants),
    resolveResource: () => Promise.resolve(null),
    writeAudit: vi.fn(() => Promise.resolve()),
    logError: vi.fn(),
  };
  return { rt, getClaims };
}
const forRoles = (roles: TestRoleCode[]) => runtime(testRoleGrants(roles)).rt;

const reviewer = {
  id: '44444444-4444-4444-8444-444444444444',
  code: 'custom_a00000000001',
  nameAr: 'مراجع الدورات',
  nameEn: 'Course reviewer',
  description: 'Reviews courses.',
  dataScope: 'organization',
  permissions: ['platform.org.read', 'platform.audit.read'],
  memberCount: 2,
  pendingInvitationCount: 0,
  version: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.countMembersByRole.mockResolvedValue({ learner: 3, [reviewer.code]: 2 });
  db.listCustomRoles.mockResolvedValue([reviewer]);
  db.getCustomRole.mockResolvedValue(reviewer);
});

describe('roles page query (EP-ROLES)', () => {
  it('lists the six standard roles and the custom roles, with member counts', async () => {
    const result = await createDefineQuery(forRoles(['training_coordinator']))(
      rolesPageQueryDefinition(),
    )({});
    expect(result.ok && result.value.memberCounts).toEqual({ learner: 3, [reviewer.code]: 2 });
    expect(result.ok && result.value.canManage).toBe(false);
    const roles = result.ok ? result.value.roles : [];
    expect(roles.map((r) => `${r.code}:${r.kind}`)).toEqual([
      'tenant_admin:standard',
      'hr_manager:standard',
      'training_manager:standard',
      'training_coordinator:standard',
      'department_head:standard',
      'learner:standard',
      'custom_a00000000001:custom',
    ]);
    expect(roles.at(-1)).toEqual({
      code: reviewer.code,
      kind: 'custom',
      name: { ar: 'مراجع الدورات', en: 'Course reviewer' },
      description: { ar: 'Reviews courses.', en: 'Reviews courses.' },
      // audit.read is high risk: a privileged role.
      privileged: true,
      permissions: reviewer.permissions,
      id: reviewer.id,
      version: 4,
    });
    expect(roles[0]).toMatchObject({ privileged: true, id: null, version: null });
    expect(roles[0]?.permissions).toContain('platform.role.manage');
  });

  it('the Organization Admin may manage roles', async () => {
    const result = await createDefineQuery(forRoles(['tenant_admin']))(rolesPageQueryDefinition())(
      {},
    );
    expect(result.ok && result.value.canManage).toBe(true);
  });

  it('without user.read tenant-wide: no counts; scoped or no role.read: FORBIDDEN', async () => {
    const roleReadOnly: Grant[] = [{ permission: 'platform.role.read', scope: { type: 'tenant' } }];
    const result = await createDefineQuery(runtime(roleReadOnly).rt)(rolesPageQueryDefinition())(
      {},
    );
    expect(result.ok && result.value.memberCounts).toBeNull();
    for (const roles of [['line_manager'], ['department_head'], ['learner']] as TestRoleCode[][]) {
      const refused = await createDefineQuery(forRoles(roles))(rolesPageQueryDefinition())({});
      expect(!refused.ok && refused.error.code, roles[0]).toBe('FORBIDDEN');
    }
  });
});

describe('role detail query', () => {
  it('a standard role: view only, its permissions and holders', async () => {
    const result = await createDefineQuery(forRoles(['tenant_admin']))(roleDetailQueryDefinition())(
      {
        code: 'learner',
      },
    );
    expect(result.ok && result.value).toMatchObject({
      role: { code: 'learner', kind: 'standard', permissions: ['platform.user.read'] },
      custom: null,
      memberCount: 3,
      canManage: true,
    });
    expect(db.getCustomRole).not.toHaveBeenCalled();
  });

  it('a custom role: the stored row; the Organization Admin may edit it', async () => {
    const admin = await createDefineQuery(forRoles(['tenant_admin']))(roleDetailQueryDefinition())({
      code: reviewer.code,
    });
    expect(db.getCustomRole).toHaveBeenCalledWith(TX, { code: reviewer.code });
    expect(admin.ok && admin.value).toMatchObject({
      custom: reviewer,
      memberCount: 2,
      canManage: true,
    });
    const reader = await createDefineQuery(forRoles(['hr_manager']))(roleDetailQueryDefinition())({
      code: reviewer.code,
    });
    expect(reader.ok && reader.value).toMatchObject({ canManage: false });
  });

  it('an unknown role: NOT_FOUND; a malformed code: VALIDATION_FAILED', async () => {
    db.getCustomRole.mockResolvedValueOnce(null);
    const query = createDefineQuery(forRoles(['tenant_admin']))(roleDetailQueryDefinition());
    const missing = await query({ code: 'custom_ffffffffffff' });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    const former = await query({ code: 'auditor' });
    expect(!former.ok && former.error.code).toBe('NOT_FOUND');
    const bad = await query({ code: 'Bad Code' });
    expect(!bad.ok && bad.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('role editor query', () => {
  it('the Organization Admin only (platform.role.manage, strict session check)', async () => {
    const { rt, getClaims } = runtime(testRoleGrants(['tenant_admin']));
    const result = await createDefineQuery(rt)(roleEditorQueryDefinition())({});
    expect(result.ok && result.value.canManage).toBe(true);
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    const hr = await createDefineQuery(forRoles(['hr_manager']))(roleEditorQueryDefinition())({});
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
  });
});
