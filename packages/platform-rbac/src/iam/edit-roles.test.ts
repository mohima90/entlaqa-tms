import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  EditRolesInput,
  PRIVILEGED_ROLE_CODES,
  ROLE_CODE,
  VERSION_TOKEN,
  editRolesQueryDefinition,
  updateMemberPrivilegedRolesActionDefinition,
  updateMemberRolesActionDefinition,
} from './edit-roles';

const db = vi.hoisted(() => ({
  getEditableRole: vi.fn(),
  lockTenantRoles: vi.fn(() => Promise.resolve()),
  replaceMemberRole: vi.fn(),
  getCustomRole: vi.fn(),
  listCustomRoles: vi.fn(),
  listStructureUnitOptions: vi.fn(),
  listStructureLevelLabels: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const SARA = '44444444-4444-4444-8444-444444444444';

function runtime(roles: TestRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') {
  const writeAudit = vi.fn(() => Promise.resolve());
  const getClaims = vi.fn((_options: { strict: boolean }) => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal,
      tenant_id: TENANT,
      person_id: ME,
    });
    if (!r.ok) throw new Error('fixture');
    return Promise.resolve(ok(r.value));
  });
  const rt: ActionRuntime<UserTx> = {
    getClaims,
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: aal === 'aal2' }),
    loadGrants: () => Promise.resolve(testRoleGrants(roles)),
    resolveResource: (_tx, ref) =>
      Promise.resolve(
        ref.id === SARA
          ? { type: 'person', id: SARA, tenantId: TENANT, subjectPersonId: SARA }
          : null,
      ),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit, getClaims };
}

const TOKEN = 'training_coordinator:5c1d2b3f-9a4e-4d2f-8b8c-3e6f7a8b9c0d:1';
const editable = (over: Record<string, unknown> = {}) => ({
  personId: SARA,
  membershipId: 'm1',
  membershipStatus: 'active',
  isSelf: false,
  mayManage: true,
  roleCode: 'training_coordinator',
  version: TOKEN,
  ...over,
});
/** Custom roles of the organization: an ordinary reader and a privileged auditor. */
const customRow = (code: string, permissions: string[]) => ({
  id: `id-${code}`,
  code,
  nameAr: 'دور',
  nameEn: 'Role',
  description: null,
  dataScope: 'organization',
  permissions,
  memberCount: 0,
  pendingInvitationCount: 0,
  version: 1,
});
const READER = customRow('custom_a00000000001', ['platform.user.read', 'platform.org.read']);
const AUDITOR = customRow('custom_a00000000002', ['platform.user.read', 'platform.audit.read']);
const PROFILE = customRow('custom_a00000000003', ['platform.tenant.read']);
/** «A department» (EP-ORG, T-M3-09): given for one unit. */
const BRANCH_READER = {
  ...customRow('custom_a00000000004', ['platform.user.read', 'platform.org.read']),
  dataScope: 'departments',
};
const CUSTOM = [READER, AUDITOR, PROFILE];
/** Found by code (getCustomRole) but not in the lists above. */
const FINDABLE = [...CUSTOM, BRANCH_READER];
const SALES = '55555555-5555-4555-8555-555555555555';
const CLOSED = '66666666-6666-4666-8666-666666666666';
const UNITS = [
  {
    id: SALES,
    code: 'SAL',
    nameAr: 'المبيعات',
    nameEn: 'Sales',
    parentId: null,
    levelOrdinal: 1,
    active: true,
  },
  {
    id: CLOSED,
    code: 'OLD',
    nameAr: 'قديم',
    nameEn: 'Old',
    parentId: null,
    levelOrdinal: 1,
    active: false,
  },
];
const LEVELS = [{ ordinal: 1, nameEn: 'Department', nameAr: 'إدارة' }];
const form = (role: string) => ({ personId: SARA, version: TOKEN, role });

beforeEach(() => {
  vi.clearAllMocks();
  db.getEditableRole.mockResolvedValue(editable());
  db.listCustomRoles.mockResolvedValue(CUSTOM);
  db.getCustomRole.mockImplementation((_tx: unknown, key: { code: string }) =>
    Promise.resolve(FINDABLE.find((r) => r.code === key.code) ?? null),
  );
  db.listStructureUnitOptions.mockResolvedValue(UNITS);
  db.listStructureLevelLabels.mockResolvedValue(LEVELS);
  db.replaceMemberRole.mockImplementation(
    (
      _tx: unknown,
      _person: string,
      _version: string,
      code: string,
      _options: unknown,
      unit: string | null = null,
    ) =>
      Promise.resolve({
        ok: true,
        before: 'training_coordinator',
        after: code,
        beforeUnit: null,
        afterUnit: unit,
        changed: true,
      }),
  );
});

describe('input', () => {
  it('lists the privileged standard roles', () => {
    expect(PRIVILEGED_ROLE_CODES).toEqual(['tenant_admin', 'hr_manager']);
  });

  it('accepts one standard or custom role and a single version token', () => {
    expect(EditRolesInput.safeParse(form('learner')).success).toBe(true);
    expect(EditRolesInput.safeParse(form('custom_a00000000001')).success).toBe(true);
    expect(EditRolesInput.safeParse({ ...form('learner'), version: '' }).success).toBe(true);
    for (const bad of ['', 'Learner', 'custom_XYZ', 'learner;drop']) {
      expect(EditRolesInput.safeParse(form(bad)).success, bad).toBe(false);
    }
    expect(
      EditRolesInput.safeParse({ ...form('learner'), additional: [{ roleCode: 'learner' }] })
        .success,
    ).toBe(false);
    expect(VERSION_TOKEN.test(`${TOKEN},${TOKEN}`)).toBe(false);
    expect(ROLE_CODE.test('custom_0123456789ab')).toBe(true);
  });
});

describe('edit role query', () => {
  it('returns the role, what blocks it, privileged access and the choices', async () => {
    const query = createDefineQuery(runtime(['tenant_admin']).rt)(editRolesQueryDefinition());
    const result = await query({ personId: SARA });
    expect(result.ok && result.value).toMatchObject({
      role: editable(),
      blocked: null,
      privilegedAccess: 'allowed',
    });
    const choices = result.ok ? result.value.choices : [];
    expect(choices.map((c) => c.code)).toEqual([
      'tenant_admin',
      'hr_manager',
      'training_manager',
      'training_coordinator',
      'department_head',
      'learner',
      READER.code,
      AUDITOR.code,
      PROFILE.code,
    ]);
    expect(choices.every((c) => c.assignable)).toBe(true);
    expect(choices.find((c) => c.code === AUDITOR.code)).toMatchObject({
      kind: 'custom',
      privileged: true,
    });
  });

  it('HR Manager: every ordinary role is assignable (who can give what, PO 17 Oct 2026)', async () => {
    const query = createDefineQuery(runtime(['hr_manager']).rt)(editRolesQueryDefinition());
    const result = await query({ personId: SARA });
    const assignable = result.ok ? result.value.choices.filter((c) => c.assignable) : [];
    // The L&D Manager and the Training Coordinator (course, planning and needs-form permissions the HR
    // Manager does not hold) and an ordinary custom role with a permission HR does not hold (PROFILE); no
    // privileged role (Organization Admin, HR Manager, AUDITOR).
    expect(assignable.map((c) => c.code)).toEqual([
      'training_manager',
      'training_coordinator',
      'department_head',
      'learner',
      READER.code,
      PROFILE.code,
    ]);
    expect(result.ok && result.value.privilegedAccess).toBe('denied');
  });

  it('says why the role cannot be changed; a privileged member is refused for HR', async () => {
    const query = createDefineQuery(runtime(['tenant_admin']).rt)(editRolesQueryDefinition());
    db.getEditableRole.mockResolvedValueOnce(editable({ isSelf: true }));
    expect((await query({ personId: SARA })).ok).toBe(true);
    db.getEditableRole.mockResolvedValueOnce(editable({ membershipId: null }));
    const noAccount = await query({ personId: SARA });
    expect(noAccount.ok && noAccount.value.blocked).toBe('no_account');
    db.getEditableRole.mockResolvedValueOnce(editable({ membershipStatus: 'revoked' }));
    const revoked = await query({ personId: SARA });
    expect(revoked.ok && revoked.value.blocked).toBe('revoked');
    db.getEditableRole.mockResolvedValueOnce(null);
    const missing = await query({ personId: SARA });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    const hr = createDefineQuery(runtime(['hr_manager']).rt)(editRolesQueryDefinition());
    db.getEditableRole.mockResolvedValueOnce(editable({ mayManage: false }));
    const denied = await hr({ personId: SARA });
    expect(!denied.ok && denied.error.code).toBe('FORBIDDEN');
  });

  it('is refused without role.assign', async () => {
    const query = createDefineQuery(runtime(['learner']).rt)(editRolesQueryDefinition());
    const result = await query({ personId: SARA });
    expect(!result.ok && result.error.code).toBe('FORBIDDEN');
    expect(db.getEditableRole).not.toHaveBeenCalled();
  });
});

describe('changing the role', () => {
  it('HR Manager: an ordinary role, audited with the role before and after', async () => {
    const { rt, writeAudit } = runtime(['hr_manager']);
    const save = createDefineAction(rt)(updateMemberRolesActionDefinition());
    // The stored role is read again after the change: its new version lets «Undo» (redesign package 3)
    // put the previous role back through this same action.
    const NEW_TOKEN = 'learner:5c1d2b3f-9a4e-4d2f-8b8c-3e6f7a8b9c0e:1';
    db.getEditableRole
      .mockResolvedValueOnce(editable())
      .mockResolvedValueOnce(editable({ roleCode: 'learner', version: NEW_TOKEN }));
    expect(await save(form('learner'))).toEqual(
      ok({
        personId: SARA,
        changed: true,
        before: 'training_coordinator',
        after: 'learner',
        beforeUnit: null,
        afterUnit: null,
        version: NEW_TOKEN,
      }),
    );
    // The organization's role lock comes first: the roles are read after it (security review L5).
    expect(db.lockTenantRoles).toHaveBeenCalledWith(TX);
    expect(db.lockTenantRoles.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      db.getEditableRole.mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(db.replaceMemberRole).toHaveBeenCalledWith(
      TX,
      SARA,
      TOKEN,
      'learner',
      { isLocked: expect.any(Function) },
      null,
    );
    const isLocked = (
      db.replaceMemberRole.mock.lastCall?.[4] as { isLocked: (c: string) => boolean }
    ).isLocked;
    expect(isLocked('learner')).toBe(false);
    expect(isLocked('training_coordinator')).toBe(false);
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'platform.user.roles_changed',
        entityType: 'person',
        entityId: SARA,
        data: { before: 'training_coordinator', after: 'learner' },
      }),
    );
    // Every ordinary role: custom ones (also with a permission HR does not hold), the training roles.
    for (const code of [READER.code, PROFILE.code, 'training_manager', 'training_coordinator']) {
      expect((await save(form(code))).ok, code).toBe(true);
    }
  });

  it('ordinary path: no privileged role (Organization Admin, HR Manager, high-risk custom role)', async () => {
    const save = createDefineAction(runtime(['hr_manager']).rt)(
      updateMemberRolesActionDefinition(),
    );
    for (const code of ['hr_manager', 'tenant_admin', AUDITOR.code]) {
      const result = await save(form(code));
      expect(!result.ok && result.error, code).toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: [{ path: 'role', code: 'ROLE_NOT_ALLOWED' }],
      });
    }
    // The member's CURRENT role is checked too (after the lock): a privileged one is locked.
    db.getEditableRole.mockResolvedValue(editable({ roleCode: AUDITOR.code }));
    await save(form('learner'));
    const isLocked = (
      db.replaceMemberRole.mock.lastCall?.[4] as { isLocked: (c: string) => boolean }
    ).isLocked;
    expect(isLocked(AUDITOR.code)).toBe(true);
    db.getEditableRole.mockResolvedValue(editable({ roleCode: 'line_manager' }));
    await save(form('learner'));
    const unknown = (
      db.replaceMemberRole.mock.lastCall?.[4] as { isLocked: (c: string) => boolean }
    ).isLocked;
    expect(unknown('line_manager')).toBe(true);
  });

  it('privileged path: the Organization Admin gives privileged roles (strict session check)', async () => {
    const { rt, getClaims } = runtime(['tenant_admin']);
    const save = createDefineAction(rt)(updateMemberPrivilegedRolesActionDefinition());
    expect((await save(form(AUDITOR.code))).ok).toBe(true);
    expect(db.replaceMemberRole).toHaveBeenCalledWith(TX, SARA, TOKEN, AUDITOR.code, {}, null);
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    const hr = createDefineAction(runtime(['hr_manager']).rt)(
      updateMemberPrivilegedRolesActionDefinition(),
    );
    const refused = await hr(form('hr_manager'));
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });

  it('a department-limited role is given for one active unit; any other role for none (EP-ORG, T-M3-09)', async () => {
    const { rt, writeAudit } = runtime(['hr_manager']);
    const save = createDefineAction(rt)(updateMemberRolesActionDefinition());
    const refusals: [Record<string, unknown>, string][] = [
      [form(BRANCH_READER.code), 'UNIT_REQUIRED'],
      [{ ...form(BRANCH_READER.code), scopeUnitId: CLOSED }, 'UNIT_NOT_ALLOWED'],
      [
        { ...form(BRANCH_READER.code), scopeUnitId: '77777777-7777-4777-8777-777777777777' },
        'UNIT_NOT_ALLOWED',
      ],
      // The Department Head keeps the units they head; a unit goes with no standard role.
      [{ ...form('department_head'), scopeUnitId: SALES }, 'UNIT_NOT_ALLOWED'],
      [{ ...form(READER.code), scopeUnitId: SALES }, 'UNIT_NOT_ALLOWED'],
    ];
    for (const [input, code] of refusals) {
      const result = await save(input as never);
      expect(!result.ok && result.error.fieldErrors, code).toEqual([{ path: 'scopeUnitId', code }]);
    }
    expect(db.replaceMemberRole).not.toHaveBeenCalled();

    expect((await save({ ...form(BRANCH_READER.code), scopeUnitId: SALES })).ok).toBe(true);
    expect(db.replaceMemberRole).toHaveBeenLastCalledWith(
      TX,
      SARA,
      TOKEN,
      BRANCH_READER.code,
      { isLocked: expect.any(Function) },
      SALES,
    );
    expect(writeAudit).toHaveBeenLastCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'platform.user.roles_changed',
        data: {
          before: 'training_coordinator',
          after: BRANCH_READER.code,
          beforeUnit: null,
          afterUnit: SALES,
        },
      }),
    );
    // A unit the database refuses meanwhile (deactivated or deleted since the form was opened).
    db.replaceMemberRole.mockResolvedValueOnce({ ok: false, refusal: 'unit_not_allowed' });
    const refused = await save({ ...form(BRANCH_READER.code), scopeUnitId: SALES });
    expect(!refused.ok && refused.error.fieldErrors).toEqual([
      { path: 'scopeUnitId', code: 'UNIT_NOT_ALLOWED' },
    ]);
  });

  it('the edit-role page offers the units and levels to members who read the structure', async () => {
    const query = createDefineQuery(runtime(['hr_manager']).rt)(editRolesQueryDefinition());
    const result = await query({ personId: SARA });
    expect(result.ok && result.value.scopeUnits).toEqual({
      units: UNITS,
      levels: LEVELS,
      structureVisible: true,
    });
  });

  it('an unknown role is a field error before any write', async () => {
    const save = createDefineAction(runtime(['tenant_admin']).rt)(
      updateMemberPrivilegedRolesActionDefinition(),
    );
    for (const code of ['auditor', 'custom_ffffffffffff']) {
      const result = await save(form(code));
      expect(!result.ok && result.error.fieldErrors).toEqual([
        { path: 'role', code: 'ROLE_UNKNOWN' },
      ]);
    }
    expect(db.replaceMemberRole).not.toHaveBeenCalled();
  });

  it('maps refusals; no change → no audit', async () => {
    const { rt, writeAudit } = runtime(['tenant_admin']);
    const save = createDefineAction(rt)(updateMemberPrivilegedRolesActionDefinition());
    const cases: [string, Record<string, unknown>][] = [
      ['not_found', { code: 'NOT_FOUND' }],
      ['no_account', { code: 'NOT_FOUND' }],
      ['own_role', { code: 'FORBIDDEN' }],
      ['not_allowed', { code: 'FORBIDDEN' }],
      ['membership_revoked', { code: 'FORBIDDEN' }],
      ['privileged_change', { code: 'FORBIDDEN' }],
      ['version_conflict', { code: 'CONFLICT_VERSION' }],
      [
        'last_admin',
        { code: 'VALIDATION_FAILED', fieldErrors: [{ path: 'role', code: 'LAST_ADMIN' }] },
      ],
      [
        'unknown_role',
        { code: 'VALIDATION_FAILED', fieldErrors: [{ path: 'role', code: 'ROLE_UNKNOWN' }] },
      ],
    ];
    for (const [refusal, error] of cases) {
      db.replaceMemberRole.mockResolvedValueOnce({ ok: false, refusal });
      const result = await save(form('learner'));
      expect(!result.ok && result.error, refusal).toMatchObject(error);
    }
    db.replaceMemberRole.mockResolvedValueOnce({
      ok: true,
      before: 'learner',
      after: 'learner',
      changed: false,
    });
    expect(await save(form('learner'))).toEqual(
      ok({ personId: SARA, changed: false, before: 'learner', after: 'learner', version: TOKEN }),
    );
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
