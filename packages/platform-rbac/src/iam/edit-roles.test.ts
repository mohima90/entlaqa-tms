import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { AssignedRole, UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { grantsForAssignments } from '../role-grants';
import { rolesHeldTogether } from '../separation-of-duties';
import type { SystemRoleCode } from '../system-roles';
import {
  EditRolesInput,
  PRIVILEGED_ROLE_CODES,
  VERSION_TOKEN,
  editRolesQueryDefinition,
  updateMemberPrivilegedRolesActionDefinition,
  updateMemberRolesActionDefinition,
} from './edit-roles';

const db = vi.hoisted(() => ({
  getEditableRoles: vi.fn(),
  replaceMemberRoles: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const SARA = '44444444-4444-4444-8444-444444444444';

function runtime(roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') {
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
    loadGrants: () =>
      Promise.resolve(
        grantsForAssignments(
          roles.map((roleCode) => ({ roleCode })),
          { headedDepartmentIds: [] },
        ),
      ),
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

const role = (roleCode: string, over: Partial<AssignedRole> = {}): AssignedRole => ({
  roleCode,
  isPrimary: false,
  validFrom: null,
  validUntil: null,
  ...over,
});
const TOKEN =
  'learner:4b0c1a2e-8f3d-4c1e-9a7b-2d5e6f7a8b9c:1,training_coordinator:5c1d2b3f-9a4e-4d2f-8b8c-3e6f7a8b9c0d:1';
const current = [role('training_coordinator', { isPrimary: true }), role('learner')];
const editable = (over: Record<string, unknown> = {}) => ({
  personId: SARA,
  membershipId: 'm1',
  membershipStatus: 'active',
  isSelf: false,
  mayManage: true,
  roles: current,
  version: TOKEN,
  timeZone: 'Asia/Riyadh',
  ...over,
});
const form = {
  personId: SARA,
  version: TOKEN,
  primary: 'training_manager' as const,
  additional: [{ roleCode: 'learner' as const, validFrom: '', validUntil: '2026-12-31' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.getEditableRoles.mockResolvedValue(editable());
});

describe('privileged roles', () => {
  it('lists the privileged roles', () => {
    expect(PRIVILEGED_ROLE_CODES).toEqual([
      'tenant_admin',
      'hr_manager',
      'finance_manager',
      'compliance_officer',
      'auditor',
    ]);
  });
});

describe('edit roles input', () => {
  it('one primary, no role twice, last day not before the first day, known roles only', () => {
    // The token getEditableRoles builds (role:row id:version) is accepted as is; so is "no roles".
    expect(VERSION_TOKEN.test(TOKEN)).toBe(true);
    expect(EditRolesInput.safeParse({ ...form, version: '' }).success).toBe(true);
    expect(EditRolesInput.parse(form).additional).toEqual([
      { roleCode: 'learner', validFrom: null, validUntil: '2026-12-31' },
    ]);
    for (const bad of [
      { ...form, additional: [{ roleCode: 'training_manager', validFrom: '', validUntil: '' }] },
      {
        ...form,
        additional: [
          { roleCode: 'learner', validFrom: '', validUntil: '' },
          { roleCode: 'learner', validFrom: '', validUntil: '' },
        ],
      },
      {
        ...form,
        additional: [{ roleCode: 'learner', validFrom: '2026-05-02', validUntil: '2026-05-01' }],
      },
      { ...form, primary: 'platform_super_admin' },
      { ...form, additional: [{ roleCode: 'learner', validFrom: '1999-12-31', validUntil: '' }] },
      { ...form, version: "x'; drop" },
      { ...form, version: 'learner:1' }, // the old token format

      { ...form, extra: true },
    ]) {
      expect(EditRolesInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('edit roles query', () => {
  const query = (roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') =>
    createDefineQuery(runtime(roles, aal).rt)(editRolesQueryDefinition())({ personId: SARA });

  it('Organization Admin: privileged roles need an authenticator code until the session has one', async () => {
    expect(await query(['tenant_admin'])).toMatchObject({
      ok: true,
      value: { blocked: null, privilegedAccess: 'step_up_required' },
    });
    expect(await query(['tenant_admin'], 'aal2')).toMatchObject({
      value: { privilegedAccess: 'allowed' },
    });
    expect(await query(['hr_manager'])).toMatchObject({ value: { privilegedAccess: 'denied' } });
  });

  it('own roles, no account, revoked: shown as blocked; a privileged member for HR: FORBIDDEN', async () => {
    for (const [over, blocked] of [
      [{ isSelf: true }, 'own_roles'],
      [{ membershipId: null, membershipStatus: null, roles: [] }, 'no_account'],
      [{ membershipStatus: 'revoked' }, 'revoked'],
    ] as const) {
      db.getEditableRoles.mockResolvedValue(editable(over));
      expect(await query(['tenant_admin'])).toMatchObject({ value: { blocked } });
    }
    db.getEditableRoles.mockResolvedValue(editable({ mayManage: false }));
    const hr = await query(['hr_manager']);
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
    db.getEditableRoles.mockResolvedValue(null);
    const gone = await query(['tenant_admin']);
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
    const learner = await query(['learner']);
    expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
  });
});

describe('update roles actions', () => {
  it('ordinary roles: saved and audited with the roles before and after', async () => {
    const after = [
      role('training_manager', { isPrimary: true }),
      role('learner', { validUntil: '2026-12-31' }),
    ];
    db.replaceMemberRoles.mockResolvedValue({ ok: true, changed: true, before: current, after });
    const { rt, writeAudit, getClaims } = runtime(['hr_manager']);
    const result = await createDefineAction(rt)(updateMemberRolesActionDefinition())(form);
    expect(result).toEqual(ok({ personId: SARA, changed: true, before: current, after }));
    expect(db.replaceMemberRoles).toHaveBeenCalledWith(TX, SARA, form.version, after, {
      lockedCodes: new Set(PRIVILEGED_ROLE_CODES),
      conflicts: rolesHeldTogether,
    });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.user.roles_changed',
      entityType: 'person',
      entityId: SARA,
      data: { before: current, after },
    });
    expect(getClaims).toHaveBeenCalledWith({ strict: false });
  });

  it('the ordinary action refuses a change that touches a privileged role', async () => {
    const withAuditor = {
      ...form,
      additional: [{ roleCode: 'auditor' as const, validFrom: '', validUntil: '' }],
    };
    db.replaceMemberRoles.mockResolvedValue({ ok: false, refusal: 'privileged_change' });
    const admin = await createDefineAction(runtime(['tenant_admin']).rt)(
      updateMemberRolesActionDefinition(),
    )(withAuditor);
    expect(!admin.ok && admin.error.code).toBe('STEP_UP_REQUIRED');
    const hr = await createDefineAction(runtime(['hr_manager']).rt)(
      updateMemberRolesActionDefinition(),
    )(withAuditor);
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
    // The check runs in the locked save, against the stored roles: privileged roles are locked there.
    expect(db.replaceMemberRoles).toHaveBeenCalledWith(TX, SARA, form.version, expect.anything(), {
      lockedCodes: new Set(PRIVILEGED_ROLE_CODES),
      conflicts: rolesHeldTogether,
    });
  });

  it('privileged action: needs AAL2 (strict session check), then saves', async () => {
    const withAuditor = {
      ...form,
      additional: [{ roleCode: 'auditor' as const, validFrom: '', validUntil: '' }],
    };
    const aal1 = await createDefineAction(runtime(['tenant_admin']).rt)(
      updateMemberPrivilegedRolesActionDefinition(),
    )(withAuditor);
    expect(!aal1.ok && aal1.error.code).toBe('STEP_UP_REQUIRED');
    const hr = await createDefineAction(runtime(['hr_manager'], 'aal2').rt)(
      updateMemberPrivilegedRolesActionDefinition(),
    )(withAuditor);
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
    db.replaceMemberRoles.mockResolvedValue({
      ok: true,
      changed: true,
      before: current,
      after: [],
    });
    const { rt, getClaims } = runtime(['tenant_admin'], 'aal2');
    const saved = await createDefineAction(rt)(updateMemberPrivilegedRolesActionDefinition())(
      withAuditor,
    );
    expect(saved.ok).toBe(true);
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
  });

  it('separation of duties (BR-IAM-4): the privileged save checks it; a refusal is ROLE_CONFLICT', async () => {
    const withHr = {
      ...form,
      primary: 'tenant_admin' as const,
      additional: [{ roleCode: 'hr_manager' as const, validFrom: '', validUntil: '' }],
    };
    db.replaceMemberRoles.mockResolvedValue({ ok: false, refusal: 'role_conflict' });
    const result = await createDefineAction(runtime(['tenant_admin'], 'aal2').rt)(
      updateMemberPrivilegedRolesActionDefinition(),
    )(withHr);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: [{ path: 'additional', code: 'ROLE_CONFLICT' }],
      },
    });
    expect(db.replaceMemberRoles).toHaveBeenCalledWith(TX, SARA, form.version, expect.anything(), {
      conflicts: rolesHeldTogether,
    });
  });

  it('maps refusals; no change → no audit; out of scope → NOT_FOUND', async () => {
    const cases: [string, string, string | undefined][] = [
      ['not_found', 'NOT_FOUND', undefined],
      ['no_account', 'NOT_FOUND', undefined],
      ['own_roles', 'FORBIDDEN', undefined],
      ['not_allowed', 'FORBIDDEN', undefined],
      ['membership_revoked', 'FORBIDDEN', undefined],
      ['version_conflict', 'CONFLICT_VERSION', undefined],
      ['last_admin', 'VALIDATION_FAILED', 'primary'],
      ['dates_invalid', 'VALIDATION_FAILED', 'additional'],
      ['role_conflict', 'VALIDATION_FAILED', 'additional'],
      ['privileged_change', 'STEP_UP_REQUIRED', undefined], // Organization Admin without a code
    ];
    for (const [refusal, code, path] of cases) {
      db.replaceMemberRoles.mockResolvedValue({ ok: false, refusal });
      const result = await createDefineAction(runtime(['tenant_admin']).rt)(
        updateMemberRolesActionDefinition(),
      )(form);
      expect(!result.ok && result.error.code, refusal).toBe(code);
      if (path) expect(!result.ok && result.error.fieldErrors?.[0]?.path).toBe(path);
    }
    db.replaceMemberRoles.mockResolvedValue({
      ok: true,
      changed: false,
      before: current,
      after: current,
    });
    const { rt, writeAudit } = runtime(['tenant_admin']);
    await createDefineAction(rt)(updateMemberRolesActionDefinition())(form);
    expect(writeAudit).not.toHaveBeenCalled();
    db.replaceMemberRoles.mockClear();
    const other = await createDefineAction(runtime(['tenant_admin']).rt)(
      updateMemberRolesActionDefinition(),
    )({ ...form, personId: ME });
    expect(!other.ok && other.error.code).toBe('NOT_FOUND');
    expect(db.replaceMemberRoles).not.toHaveBeenCalled();
  });
});
