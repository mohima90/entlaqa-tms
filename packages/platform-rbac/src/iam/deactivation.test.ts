import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { platformPermissions } from '../platform-permissions';
import { grantsForAssignments } from '../role-grants';
import type { SystemRoleCode } from '../system-roles';
import {
  DeactivateMemberInput,
  PLATFORM_RESPONSIBILITIES,
  type ResponsibilityKind,
  assertResponsibilityKinds,
  deactivateMemberActionDefinition,
  deactivatePrivilegedMemberActionDefinition,
  deactivationQueryDefinition,
  reactivateMemberActionDefinition,
  reactivatePrivilegedMemberActionDefinition,
} from './deactivation';

const db = vi.hoisted(() => ({
  getMemberLifecycleTarget: vi.fn(),
  lockMemberLifecycle: vi.fn(),
  listDirectReports: vi.fn(),
  listHeadedDepartments: vi.fn(),
  reassignDirectReports: vi.fn(),
  reassignHeadedDepartments: vi.fn(),
  listReplacementCandidates: vi.fn(),
  revokePendingInvitationsOf: vi.fn(),
  deactivateMembership: vi.fn(),
  reactivateMembership: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const SARA = '44444444-4444-4444-8444-444444444444';
const NEW_MANAGER = '55555555-5555-4555-8555-555555555555';

function runtime(roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') {
  const writeAudit = vi.fn((_tx: unknown, _actor: unknown, _record: unknown) => Promise.resolve());
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
    // SARA exists in the organization; any other id is unknown (or out of scope): 404.
    resolveResource: (_tx, ref) =>
      Promise.resolve(
        ref.id === SARA
          ? { type: 'person', id: ref.id, tenantId: TENANT, subjectPersonId: ref.id }
          : null,
      ),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit, getClaims };
}

const target = (over: Record<string, unknown> = {}) => ({
  personId: SARA,
  displayNameAr: 'سارة',
  displayNameEn: 'Sarah',
  personStatus: 'active',
  membershipId: 'm1',
  membershipStatus: 'active',
  isSelf: false,
  mayManage: true,
  privileged: false,
  lastAdmin: false,
  ...over,
});
const report = { id: 'r1', nameAr: 'منى', nameEn: null, movable: true };
const department = { id: 'd1', nameAr: 'التدريب', nameEn: 'Training', movable: true };
const deactivateInput = (over: Record<string, unknown> = {}) =>
  ({
    personId: SARA,
    reason: 'end_of_service',
    reassign: [
      { kind: 'platform.direct_reports', toPersonId: NEW_MANAGER },
      { kind: 'platform.headed_departments', toPersonId: NEW_MANAGER },
    ],
    ...over,
  }) as z.input<typeof DeactivateMemberInput>;

beforeEach(() => {
  vi.clearAllMocks();
  db.getMemberLifecycleTarget.mockResolvedValue(target());
  db.lockMemberLifecycle.mockResolvedValue(undefined);
  db.listDirectReports.mockResolvedValue([]);
  db.listHeadedDepartments.mockResolvedValue([]);
  db.reassignDirectReports.mockResolvedValue({ ok: true, moved: ['r1'] });
  db.reassignHeadedDepartments.mockResolvedValue({ ok: true, moved: ['d1'] });
  db.listReplacementCandidates.mockResolvedValue([
    { personId: NEW_MANAGER, nameAr: 'خالد', nameEn: null },
  ]);
  db.revokePendingInvitationsOf.mockResolvedValue([]);
  db.deactivateMembership.mockResolvedValue({ ok: true });
  db.reactivateMembership.mockResolvedValue({ ok: true, membershipId: 'm1' });
});

describe('responsibility kinds (the reassignment hook)', () => {
  it('platform kinds: direct reports (user.update) and headed departments (org.manage)', () => {
    expect(PLATFORM_RESPONSIBILITIES.map((k) => [k.code, k.permission.code])).toEqual([
      ['platform.direct_reports', 'platform.user.update'],
      ['platform.headed_departments', 'platform.org.manage'],
    ]);
  });

  it('refuses invalid or repeated codes when the definitions are created', () => {
    const kind = (code: string): ResponsibilityKind => ({
      code,
      permission: platformPermissions['platform.user.update'],
      list: () => Promise.resolve([]),
      reassign: () => Promise.resolve({ ok: true, moved: [] }),
    });
    expect(() => {
      assertResponsibilityKinds([kind('tms.sessions'), kind('tms.sessions')]);
    }).toThrow('registered twice');
    expect(() => {
      assertResponsibilityKinds([kind('Sessions')]);
    }).toThrow('invalid code');
    expect(() => deactivateMemberActionDefinition([kind('no-dot')])).toThrow('invalid code');
    expect(() => {
      assertResponsibilityKinds([kind('tms.sessions'), kind('tms.tasks')]);
    }).not.toThrow();
  });
});

describe('deactivation screen query', () => {
  const query = (
    roles: SystemRoleCode[],
    kinds?: readonly ResponsibilityKind[],
    aal: 'aal1' | 'aal2' = 'aal1',
  ) => createDefineQuery(runtime(roles, aal).rt)(deactivationQueryDefinition(kinds));

  it('Organization Admin: the person, what they hold and who can take it over', async () => {
    db.listDirectReports.mockResolvedValue([report]);
    db.listHeadedDepartments.mockResolvedValue([department]);
    const result = await query(['tenant_admin'])({ personId: SARA });
    expect(result).toEqual(
      ok({
        target: { personId: SARA, displayNameAr: 'سارة', displayNameEn: 'Sarah' },
        blocked: null,
        privileged: false,
        responsibilities: [
          { code: 'platform.direct_reports', items: [report], blocked: null },
          { code: 'platform.headed_departments', items: [department], blocked: null },
        ],
        candidates: [{ personId: NEW_MANAGER, nameAr: 'خالد', nameEn: null }],
      }),
    );
    expect(db.listReplacementCandidates).toHaveBeenCalledWith(TX, SARA);
  });

  it('HR Manager: departments need org.manage, a privileged report needs the Organization Admin', async () => {
    db.listDirectReports.mockResolvedValue([report, { ...report, id: 'r2', movable: false }]);
    db.listHeadedDepartments.mockResolvedValue([department]);
    const result = await query(['hr_manager'])({ personId: SARA });
    expect(result.ok && result.value.responsibilities.map((r) => [r.code, r.blocked])).toEqual([
      ['platform.direct_reports', 'item_not_allowed'],
      ['platform.headed_departments', 'permission'],
    ]);
  });

  it('a privileged member: the authenticator-code step first (AAL1), the screen at AAL2 (review M4)', async () => {
    db.getMemberLifecycleTarget.mockResolvedValue(target({ privileged: true }));
    db.listDirectReports.mockResolvedValue([report]);
    const atAal1 = await query(['tenant_admin'])({ personId: SARA });
    expect(atAal1.ok && atAal1.value).toMatchObject({
      blocked: 'step_up_required',
      privileged: true,
      responsibilities: [],
      candidates: [],
    });
    expect(db.listDirectReports).not.toHaveBeenCalled();
    const atAal2 = await query(['tenant_admin'], undefined, 'aal2')({ personId: SARA });
    expect(atAal2.ok && atAal2.value).toMatchObject({ blocked: null, privileged: true });
    expect(atAal2.ok && atAal2.value.responsibilities).toHaveLength(1);
  });

  it('nothing to move: no candidates are loaded', async () => {
    const result = await query(['hr_manager'])({ personId: SARA });
    expect(result.ok && result.value).toMatchObject({ responsibilities: [], candidates: [] });
    expect(db.listReplacementCandidates).not.toHaveBeenCalled();
  });

  it.each([
    [{ isSelf: true }, 'own_account'],
    [{ membershipId: null, membershipStatus: null }, 'no_account'],
    [{ membershipStatus: 'suspended' }, 'not_active'],
    [{ membershipStatus: 'revoked' }, 'not_active'],
    [{ lastAdmin: true }, 'last_admin'],
  ] as const)('says why it cannot be deactivated (%j → %s)', async (over, blocked) => {
    db.getMemberLifecycleTarget.mockResolvedValue(target(over));
    const result = await query(['tenant_admin'])({ personId: SARA });
    expect(result.ok && result.value).toMatchObject({
      blocked,
      responsibilities: [],
      candidates: [],
    });
    expect(db.listDirectReports).not.toHaveBeenCalled();
  });

  it('authorization: a privileged member for HR → 403; no permission → 403; unknown → 404', async () => {
    db.getMemberLifecycleTarget.mockResolvedValue(target({ mayManage: false }));
    const hr = await query(['hr_manager'])({ personId: SARA });
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
    for (const roles of [
      ['learner'],
      ['line_manager'],
      ['training_manager'],
      ['auditor'],
    ] as const) {
      const denied = await query([...roles])({ personId: SARA });
      expect(!denied.ok && denied.error.code, roles.join()).toBe('FORBIDDEN');
    }
    const unknown = await query(['tenant_admin'])({ personId: NEW_MANAGER });
    expect(!unknown.ok && unknown.error.code).toBe('NOT_FOUND');
    db.getMemberLifecycleTarget.mockResolvedValue(null);
    const gone = await query(['tenant_admin'])({ personId: SARA });
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
  });
});

describe('deactivate input', () => {
  it('a reason from the list (or none), known kind codes, each kind once, nothing else', () => {
    expect(DeactivateMemberInput.parse(deactivateInput({ reason: '' })).reason).toBeNull();
    for (const bad of [
      deactivateInput({ reason: 'fired' }),
      deactivateInput({ reassign: [{ kind: 'Platform.Reports', toPersonId: NEW_MANAGER }] }),
      deactivateInput({ reassign: [{ kind: 'platform.direct_reports', toPersonId: 'x' }] }),
      deactivateInput({
        reassign: [
          { kind: 'platform.direct_reports', toPersonId: NEW_MANAGER },
          { kind: 'platform.direct_reports', toPersonId: SARA },
        ],
      }),
      deactivateInput({ extra: true }),
      deactivateInput({ personId: 'not-a-uuid' }),
    ]) {
      expect(DeactivateMemberInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('deactivate action', () => {
  const action = (roles: SystemRoleCode[], kinds?: readonly ResponsibilityKind[]) => {
    const r = runtime(roles);
    return { ...r, run: createDefineAction(r.rt)(deactivateMemberActionDefinition(kinds)) };
  };

  it('moves every responsibility, revokes invitations, deactivates; audited with changed facts only', async () => {
    db.listDirectReports.mockResolvedValue([report]);
    db.listHeadedDepartments.mockResolvedValue([department]);
    db.revokePendingInvitationsOf.mockResolvedValue(['i1']);
    const { run, writeAudit, getClaims } = action(['tenant_admin']);
    const result = await run(deactivateInput());
    expect(result).toEqual(
      ok({
        personId: SARA,
        membershipId: 'm1',
        reason: 'end_of_service',
        reassigned: [
          { kind: 'platform.direct_reports', toPersonId: NEW_MANAGER, ids: ['r1'] },
          { kind: 'platform.headed_departments', toPersonId: NEW_MANAGER, ids: ['d1'] },
        ],
        invitationsRevoked: ['i1'],
      }),
    );
    // Locks first, then the person is read again, then the moves, then the deactivation.
    const order = [
      db.lockMemberLifecycle,
      db.getMemberLifecycleTarget,
      db.reassignDirectReports,
      db.reassignHeadedDepartments,
      db.revokePendingInvitationsOf,
      db.deactivateMembership,
    ].map((fn) => fn.mock.invocationCallOrder[0] ?? 0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(db.reassignDirectReports).toHaveBeenCalledWith(TX, SARA, NEW_MANAGER);
    expect(db.deactivateMembership).toHaveBeenCalledWith(TX, {
      personId: SARA,
      membershipId: 'm1',
    });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.user.deactivated',
      entityType: 'person',
      entityId: SARA,
      data: {
        membershipId: 'm1',
        reason: 'end_of_service',
        reassigned: [
          { kind: 'platform.direct_reports', toPersonId: NEW_MANAGER, ids: ['r1'] },
          { kind: 'platform.headed_departments', toPersonId: NEW_MANAGER, ids: ['d1'] },
        ],
        invitationsRevoked: ['i1'],
      },
    });
    // Medium risk, AAL1 (platform permission registry): no strict Auth round trip.
    expect(getClaims).toHaveBeenCalledWith({ strict: false });
  });

  it('nothing to move: no owner needed; no reason: none recorded', async () => {
    const { run, writeAudit } = action(['hr_manager']);
    expect((await run(deactivateInput({ reason: '', reassign: [] }))).ok).toBe(true);
    expect(db.reassignDirectReports).not.toHaveBeenCalled();
    expect(writeAudit.mock.calls[0]?.[2]).toMatchObject({
      data: { membershipId: 'm1', reassigned: [], invitationsRevoked: [] },
    });
    expect(writeAudit.mock.calls[0]?.[2]).not.toHaveProperty('data.reason');
  });

  it('a module kind takes part in the same transaction', async () => {
    const moduleKind: ResponsibilityKind = {
      code: 'tms.sessions',
      permission: platformPermissions['platform.user.deactivate'],
      list: vi.fn(() =>
        Promise.resolve([{ id: 's1', nameAr: 'جلسة', nameEn: null, movable: true }]),
      ),
      reassign: vi.fn(() => Promise.resolve({ ok: true as const, moved: ['s1'] })),
    };
    const { run } = action(['hr_manager'], [...PLATFORM_RESPONSIBILITIES, moduleKind]);
    const result = await run(
      deactivateInput({ reassign: [{ kind: 'tms.sessions', toPersonId: NEW_MANAGER }] }),
    );
    expect(result.ok && result.value.reassigned).toEqual([
      { kind: 'tms.sessions', toPersonId: NEW_MANAGER, ids: ['s1'] },
    ]);
    expect(moduleKind.reassign).toHaveBeenCalledWith(TX, SARA, NEW_MANAGER);
  });

  it('refuses a kind nobody registered', async () => {
    const result = await action(['tenant_admin']).run(
      deactivateInput({ reassign: [{ kind: 'tms.sessions', toPersonId: NEW_MANAGER }] }),
    );
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'reassign.0.kind', code: 'UNKNOWN' },
    ]);
    expect(db.lockMemberLifecycle).not.toHaveBeenCalled();
  });

  it.each([
    ['no owner chosen', 'OWNER_REQUIRED', { reassign: [] }, null],
    ['an owner the guards refuse', 'OWNER_INVALID', {}, 'owner_invalid'],
    ['an owner inside the team below', 'OWNER_REPORTS_TO_PERSON', {}, 'owner_reports_to_person'],
    ['a move the guards refuse', 'NOT_ALLOWED', {}, 'not_allowed'],
  ] as const)('%s → %s on the kind, nothing deactivated', async (_name, code, over, refusal) => {
    db.listDirectReports.mockResolvedValue([report]);
    if (refusal) db.reassignDirectReports.mockResolvedValue({ ok: false, refusal });
    const result = await action(['tenant_admin']).run(deactivateInput(over));
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'reassign.platform.direct_reports', code },
    ]);
    expect(db.deactivateMembership).not.toHaveBeenCalled();
  });

  it('an owner the screen did not offer (not a replacement candidate) → OWNER_INVALID (review I1)', async () => {
    db.listDirectReports.mockResolvedValue([report]);
    const result = await action(['tenant_admin']).run(
      deactivateInput({ reassign: [{ kind: 'platform.direct_reports', toPersonId: ME }] }),
    );
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'reassign.platform.direct_reports', code: 'OWNER_INVALID' },
    ]);
    expect(db.listReplacementCandidates).toHaveBeenCalledWith(TX, SARA);
    expect(db.reassignDirectReports).not.toHaveBeenCalled();
    expect(db.deactivateMembership).not.toHaveBeenCalled();
  });

  it('HR Manager: departments they cannot restructure, or a privileged report → NOT_ALLOWED', async () => {
    db.listHeadedDepartments.mockResolvedValue([department]);
    const departments = await action(['hr_manager']).run(deactivateInput());
    expect(!departments.ok && departments.error.fieldErrors).toEqual([
      { path: 'reassign.platform.headed_departments', code: 'NOT_ALLOWED' },
    ]);
    expect(db.reassignHeadedDepartments).not.toHaveBeenCalled();
    db.listHeadedDepartments.mockResolvedValue([]);
    db.listDirectReports.mockResolvedValue([{ ...report, movable: false }]);
    const privilegedReport = await action(['hr_manager']).run(deactivateInput());
    expect(!privilegedReport.ok && privilegedReport.error.fieldErrors).toEqual([
      { path: 'reassign.platform.direct_reports', code: 'NOT_ALLOWED' },
    ]);
    expect(db.deactivateMembership).not.toHaveBeenCalled();
  });

  it.each([
    [{ isSelf: true }, 'FORBIDDEN', undefined],
    [{ mayManage: false }, 'FORBIDDEN', undefined],
    [{ membershipId: null, membershipStatus: null }, 'NOT_FOUND', undefined],
    [{ membershipStatus: 'suspended' }, 'VALIDATION_FAILED', 'NOT_ACTIVE'],
    [{ lastAdmin: true }, 'VALIDATION_FAILED', 'LAST_ADMIN'],
  ] as const)('the person rechecked after the locks: %j → %s', async (over, code, field) => {
    db.getMemberLifecycleTarget.mockResolvedValue(target(over));
    const result = await action(['tenant_admin']).run(deactivateInput());
    expect(!result.ok && result.error.code).toBe(code);
    if (field) expect(!result.ok && result.error.fieldErrors?.[0]?.code).toBe(field);
    expect(db.deactivateMembership).not.toHaveBeenCalled();
  });

  it('maps the database refusals of the deactivation itself', async () => {
    for (const [refusal, code, field] of [
      ['not_allowed', 'FORBIDDEN', undefined],
      ['step_up_required', 'STEP_UP_REQUIRED', undefined],
      ['last_admin', 'VALIDATION_FAILED', 'LAST_ADMIN'],
      ['not_active', 'VALIDATION_FAILED', 'NOT_ACTIVE'],
    ] as const) {
      db.deactivateMembership.mockResolvedValue({ ok: false, refusal });
      const result = await action(['tenant_admin']).run(deactivateInput());
      expect(!result.ok && result.error.code, refusal).toBe(code);
      if (field) expect(!result.ok && result.error.fieldErrors?.[0]?.code).toBe(field);
    }
    db.deactivateMembership.mockResolvedValue({ ok: true });
    db.revokePendingInvitationsOf.mockRejectedValue(
      Object.assign(new Error('refused'), { code: 'ROLE_NOT_ALLOWED' }),
    );
    const invitation = await action(['hr_manager']).run(deactivateInput());
    expect(!invitation.ok && invitation.error.code).toBe('FORBIDDEN');
  });

  it('authorization: without user.deactivate → 403; out of every scope → 404; nothing touched', async () => {
    for (const roles of [
      ['learner'],
      ['line_manager'],
      ['department_head'],
      ['training_manager'],
    ] as const) {
      const result = await action([...roles]).run(deactivateInput());
      expect(!result.ok && result.error.code, roles.join()).toBe('FORBIDDEN');
    }
    const unknown = await action(['tenant_admin']).run(deactivateInput({ personId: NEW_MANAGER }));
    expect(!unknown.ok && unknown.error.code).toBe('NOT_FOUND');
    expect(db.lockMemberLifecycle).not.toHaveBeenCalled();
    expect(db.deactivateMembership).not.toHaveBeenCalled();
  });
});

describe('deactivating a member who holds a privileged role (review M4, D-IAM-01)', () => {
  const ordinary = (roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') => {
    const r = runtime(roles, aal);
    return { ...r, run: createDefineAction(r.rt)(deactivateMemberActionDefinition()) };
  };
  const privileged = (roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') => {
    const r = runtime(roles, aal);
    return { ...r, run: createDefineAction(r.rt)(deactivatePrivilegedMemberActionDefinition()) };
  };
  beforeEach(() => {
    db.getMemberLifecycleTarget.mockResolvedValue(target({ privileged: true }));
  });

  it('the ordinary action refuses: STEP_UP_REQUIRED at AAL1, FORBIDDEN at AAL2 (use the privileged one)', async () => {
    const atAal1 = await ordinary(['tenant_admin']).run(deactivateInput({ reassign: [] }));
    expect(!atAal1.ok && atAal1.error.code).toBe('STEP_UP_REQUIRED');
    const atAal2 = await ordinary(['tenant_admin'], 'aal2').run(deactivateInput({ reassign: [] }));
    expect(!atAal2.ok && atAal2.error.code).toBe('FORBIDDEN');
    expect(db.deactivateMembership).not.toHaveBeenCalled();
  });

  it('the privileged action: Organization Admin at AAL2, strict session check; audited the same way', async () => {
    const { run, writeAudit, getClaims } = privileged(['tenant_admin'], 'aal2');
    const result = await run(deactivateInput({ reassign: [] }));
    expect(result.ok).toBe(true);
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    expect(writeAudit.mock.calls[0]?.[2]).toMatchObject({ action: 'platform.user.deactivated' });
    expect(db.deactivateMembership).toHaveBeenCalledWith(TX, {
      personId: SARA,
      membershipId: 'm1',
    });
  });

  it('authorization negatives: AAL1 → STEP_UP_REQUIRED; HR Manager → FORBIDDEN; nothing touched', async () => {
    const atAal1 = await privileged(['tenant_admin']).run(deactivateInput({ reassign: [] }));
    expect(!atAal1.ok && atAal1.error.code).toBe('STEP_UP_REQUIRED');
    for (const aal of ['aal1', 'aal2'] as const) {
      const hr = await privileged(['hr_manager'], aal).run(deactivateInput({ reassign: [] }));
      expect(!hr.ok && hr.error.code, aal).toBe('FORBIDDEN');
    }
    const learner = await privileged(['learner'], 'aal2').run(deactivateInput({ reassign: [] }));
    expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
    expect(db.lockMemberLifecycle).not.toHaveBeenCalled();
    expect(db.deactivateMembership).not.toHaveBeenCalled();
  });
});

describe('reactivate actions', () => {
  const ordinary = (roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') => {
    const r = runtime(roles, aal);
    return { ...r, run: createDefineAction(r.rt)(reactivateMemberActionDefinition()) };
  };
  const privileged = (roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') => {
    const r = runtime(roles, aal);
    return { ...r, run: createDefineAction(r.rt)(reactivatePrivilegedMemberActionDefinition()) };
  };
  beforeEach(() => {
    db.getMemberLifecycleTarget.mockResolvedValue(
      target({ membershipStatus: 'suspended', personStatus: 'inactive' }),
    );
  });

  it('an ordinary member: HR Manager or Organization Admin at AAL1; audited', async () => {
    for (const roles of [['hr_manager'], ['tenant_admin']] as const) {
      const { run, writeAudit } = ordinary([...roles]);
      expect(await run({ personId: SARA })).toEqual(ok({ personId: SARA, membershipId: 'm1' }));
      expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
        action: 'platform.user.reactivated',
        entityType: 'person',
        entityId: SARA,
        data: { membershipId: 'm1' },
      });
    }
    expect(db.reactivateMembership).toHaveBeenCalledWith(TX, SARA);
  });

  it('a privileged member on the ordinary path: STEP_UP_REQUIRED (admin) or FORBIDDEN (HR)', async () => {
    db.getMemberLifecycleTarget.mockResolvedValue(
      target({ membershipStatus: 'suspended', privileged: true }),
    );
    const admin = await ordinary(['tenant_admin']).run({ personId: SARA });
    expect(!admin.ok && admin.error.code).toBe('STEP_UP_REQUIRED');
    const hr = await ordinary(['hr_manager']).run({ personId: SARA });
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
    expect(db.reactivateMembership).not.toHaveBeenCalled();
  });

  it('the privileged path: AAL2 and a strict session check; HR never', async () => {
    db.getMemberLifecycleTarget.mockResolvedValue(
      target({ membershipStatus: 'suspended', privileged: true }),
    );
    const aal1 = await privileged(['tenant_admin']).run({ personId: SARA });
    expect(!aal1.ok && aal1.error.code).toBe('STEP_UP_REQUIRED');
    const hr = await privileged(['hr_manager'], 'aal2').run({ personId: SARA });
    expect(!hr.ok && hr.error.code).toBe('FORBIDDEN');
    expect(db.reactivateMembership).not.toHaveBeenCalled();
    const { run, getClaims } = privileged(['tenant_admin'], 'aal2');
    expect((await run({ personId: SARA })).ok).toBe(true);
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
  });

  it.each([
    [{ isSelf: true }, 'FORBIDDEN', undefined],
    [{ mayManage: false }, 'FORBIDDEN', undefined],
    [{ membershipId: null, membershipStatus: null }, 'NOT_FOUND', undefined],
    [{ membershipStatus: 'active' }, 'VALIDATION_FAILED', 'NOT_DEACTIVATED'],
    [{ membershipStatus: 'revoked' }, 'VALIDATION_FAILED', 'NOT_DEACTIVATED'],
  ] as const)('refuses %j → %s', async (over, code, field) => {
    db.getMemberLifecycleTarget.mockResolvedValue(
      target({ membershipStatus: 'suspended', ...over }),
    );
    const result = await ordinary(['tenant_admin']).run({ personId: SARA });
    expect(!result.ok && result.error.code).toBe(code);
    if (field) expect(!result.ok && result.error.fieldErrors?.[0]?.code).toBe(field);
    expect(db.reactivateMembership).not.toHaveBeenCalled();
  });

  it('maps the database refusals', async () => {
    for (const [refusal, code, field] of [
      ['not_found', 'NOT_FOUND', undefined],
      ['not_deactivated', 'VALIDATION_FAILED', 'NOT_DEACTIVATED'],
      ['placement_deleted', 'VALIDATION_FAILED', 'PLACEMENT_DELETED'],
      ['step_up_required', 'STEP_UP_REQUIRED', undefined],
      ['not_allowed', 'FORBIDDEN', undefined],
    ] as const) {
      db.reactivateMembership.mockResolvedValue({ ok: false, refusal });
      const result = await ordinary(['tenant_admin']).run({ personId: SARA });
      expect(!result.ok && result.error.code, refusal).toBe(code);
      if (field) expect(!result.ok && result.error.fieldErrors?.[0]?.code).toBe(field);
    }
  });

  it('authorization: without user.deactivate → 403 (both paths); out of scope → 404', async () => {
    for (const roles of [['learner'], ['line_manager'], ['auditor']] as const) {
      const result = await ordinary([...roles]).run({ personId: SARA });
      expect(!result.ok && result.error.code, roles.join()).toBe('FORBIDDEN');
      const viaPrivileged = await privileged([...roles], 'aal2').run({ personId: SARA });
      expect(!viaPrivileged.ok && viaPrivileged.error.code, roles.join()).toBe('FORBIDDEN');
    }
    const unknown = await ordinary(['tenant_admin']).run({ personId: NEW_MANAGER });
    expect(!unknown.ok && unknown.error.code).toBe('NOT_FOUND');
    const malformed = await ordinary(['tenant_admin']).run({ personId: 'x' });
    expect(!malformed.ok && malformed.error.code).toBe('VALIDATION_FAILED');
    expect(db.reactivateMembership).not.toHaveBeenCalled();
  });
});
