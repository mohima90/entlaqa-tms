import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { InvitationRow, UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { grantsForAssignments } from '../role-grants';
import type { SystemRoleCode } from '../system-roles';
import {
  InviteUserInput,
  MAX_INVITATION_SENDS,
  invitationGivesPrivilegedRole,
  invitationRefusalCode,
  invitationsListQueryDefinition,
  inviteFormQueryDefinition,
  invitePrivilegedUserActionDefinition,
  inviteUserActionDefinition,
  resendInvitationActionDefinition,
  revokeInvitationActionDefinition,
} from './invitations';

const db = vi.hoisted(() => ({
  createInvitation: vi.fn(),
  getInvitationRoles: vi.fn(),
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
  requestInvitationResend: vi.fn(),
  listManagerOptions: vi.fn(),
  listOrgUnitOptions: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const INVITATION = '66666666-6666-4666-8666-666666666666';
const PERSON = '77777777-7777-4777-8777-777777777777';
const DEPARTMENT = '88888888-8888-4888-8888-888888888888';

function runtime(roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') {
  const writeAudit = vi.fn(() => Promise.resolve());
  const logError = vi.fn();
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
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError,
  };
  return { rt, writeAudit, getClaims, logError };
}

const form = {
  email: '  Noura.Aldossari@Alraya.Example ',
  firstNameAr: 'نورة',
  familyNameAr: 'الدوسري',
  firstNameEn: 'Noura',
  familyNameEn: '',
  departmentId: DEPARTMENT,
  branchId: '',
  managerPersonId: '',
  employeeNumber: 'EMP-١٤٥٠',
  primaryRole: 'training_coordinator' as const,
  additionalRoles: ['learner' as const],
  locale: 'ar' as const,
};

const refusal = (code: string) => Object.assign(new Error(code), { code });

const row = (over: Partial<InvitationRow> = {}): InvitationRow => ({
  id: INVITATION,
  personId: PERSON,
  email: 'n@alraya.example',
  displayNameAr: 'نورة الدوسري',
  displayNameEn: null,
  primaryRole: 'learner',
  state: 'pending',
  sendCount: 1,
  expiresAt: new Date('2026-10-14T09:00:00Z'),
  createdAt: new Date('2026-10-07T09:00:00Z'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.createInvitation.mockResolvedValue({ invitationId: INVITATION, personId: PERSON });
  db.getInvitationRoles.mockResolvedValue({ primaryRole: 'learner', additionalRoles: [] });
});

describe('invite input', () => {
  it('normalizes the e-mail and employee number; optional fields become null', () => {
    const value = InviteUserInput.parse(form);
    expect(value).toMatchObject({
      email: 'noura.aldossari@alraya.example',
      firstNameEn: 'Noura',
      familyNameEn: null,
      branchId: null,
      managerPersonId: null,
      employeeNumber: 'EMP-1450',
    });
    expect(
      InviteUserInput.parse({ ...form, employeeNumber: ' ', additionalRoles: [] }).employeeNumber,
    ).toBeNull();
  });

  it('refuses a bad e-mail, missing Arabic names, unknown or repeated roles, extra keys', () => {
    for (const bad of [
      { ...form, email: 'not-an-email' },
      { ...form, email: `${'a'.repeat(250)}@x.example` },
      { ...form, firstNameAr: ' ' },
      { ...form, familyNameAr: '' },
      { ...form, firstNameAr: '‏‏' },
      { ...form, firstNameEn: 'x'.repeat(61) },
      { ...form, departmentId: 'not-a-uuid' },
      { ...form, managerPersonId: "1'; drop" },
      { ...form, primaryRole: 'platform_super_admin' },
      { ...form, additionalRoles: ['training_coordinator'] }, // primary repeated
      { ...form, additionalRoles: ['learner', 'learner'] },
      { ...form, additionalRoles: ['nobody'] },
      { ...form, locale: 'fr' },
      { ...form, tenantId: TENANT },
    ]) {
      expect(InviteUserInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('tells privileged roles apart (primary or additional)', () => {
    expect(invitationGivesPrivilegedRole({ primaryRole: 'learner', additionalRoles: [] })).toBe(
      false,
    );
    expect(
      invitationGivesPrivilegedRole({ primaryRole: 'learner', additionalRoles: ['auditor'] }),
    ).toBe(true);
    expect(
      invitationGivesPrivilegedRole({ primaryRole: 'tenant_admin', additionalRoles: [] }),
    ).toBe(true);
  });

  it('reads the refusal code of createInvitation errors only', () => {
    expect(invitationRefusalCode(refusal('EMAIL_TAKEN'))).toBe('EMAIL_TAKEN');
    expect(invitationRefusalCode({ code: 'ROLE_NOT_ALLOWED' })).toBe('ROLE_NOT_ALLOWED');
    expect(invitationRefusalCode(refusal('23505'))).toBeNull();
    expect(invitationRefusalCode({ code: 'toString' })).toBeNull();
    expect(invitationRefusalCode(new Error('boom'))).toBeNull();
    expect(invitationRefusalCode('EMAIL_TAKEN')).toBeNull();
    expect(invitationRefusalCode(null)).toBeNull();
  });
});

describe('invite user action', () => {
  it('HR Manager invites with ordinary roles; audited with ids and role codes only', async () => {
    const { rt, writeAudit, getClaims } = runtime(['hr_manager']);
    const result = await createDefineAction(rt)(inviteUserActionDefinition())(form);
    expect(result).toEqual(
      ok({
        invitationId: INVITATION,
        personId: PERSON,
        primaryRole: 'training_coordinator',
        additionalRoles: ['learner'],
      }),
    );
    expect(db.createInvitation).toHaveBeenCalledWith(TX, {
      email: 'noura.aldossari@alraya.example',
      firstNameAr: 'نورة',
      familyNameAr: 'الدوسري',
      firstNameEn: 'Noura',
      familyNameEn: null,
      departmentId: DEPARTMENT,
      branchId: null,
      managerPersonId: null,
      employeeNumber: 'EMP-1450',
      primaryRole: 'training_coordinator',
      additionalRoles: ['learner'],
      locale: 'ar',
    });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.invitation.created',
      entityType: 'invitation',
      entityId: INVITATION,
      data: { personId: PERSON, primaryRole: 'training_coordinator', additionalRoles: ['learner'] },
    });
    const audited = JSON.stringify(writeAudit.mock.calls);
    expect(audited).not.toContain('alraya');
    expect(audited).not.toContain('نورة');
    expect(getClaims).toHaveBeenCalledWith({ strict: false });
  });

  it('without platform.user.invite: FORBIDDEN, nothing created', async () => {
    for (const roles of [['learner'], ['training_manager'], ['auditor']] as SystemRoleCode[][]) {
      const result = await createDefineAction(runtime(roles).rt)(inviteUserActionDefinition())(
        form,
      );
      expect(!result.ok && result.error.code, roles.join()).toBe('FORBIDDEN');
    }
    expect(db.createInvitation).not.toHaveBeenCalled();
  });

  it('invalid input: VALIDATION_FAILED before anything is created', async () => {
    const { rt, writeAudit } = runtime(['tenant_admin']);
    const result = await createDefineAction(rt)(inviteUserActionDefinition())({
      ...form,
      email: 'nope',
    });
    expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    expect(!result.ok && result.error.fieldErrors?.[0]?.path).toBe('email');
    expect(db.createInvitation).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('HR Manager giving a privileged role: ROLE_NOT_ALLOWED on that field, nothing created', async () => {
    const hr = createDefineAction(runtime(['hr_manager']).rt)(inviteUserActionDefinition());
    const primary = await hr({ ...form, primaryRole: 'tenant_admin' });
    expect(!primary.ok && primary.error.fieldErrors).toEqual([
      { path: 'primaryRole', code: 'ROLE_NOT_ALLOWED' },
    ]);
    const additional = await hr({ ...form, additionalRoles: ['learner', 'finance_manager'] });
    expect(!additional.ok && additional.error.fieldErrors).toEqual([
      { path: 'additionalRoles', code: 'ROLE_NOT_ALLOWED' },
    ]);
    // The privileged action itself: HR does not hold role.assign_privileged.
    const privileged = await createDefineAction(runtime(['hr_manager'], 'aal2').rt)(
      invitePrivilegedUserActionDefinition(),
    )({ ...form, primaryRole: 'tenant_admin' });
    expect(!privileged.ok && privileged.error.code).toBe('FORBIDDEN');
    expect(db.createInvitation).not.toHaveBeenCalled();
  });

  it('Organization Admin: privileged roles need an authenticator code and the strict check', async () => {
    const withAuditor = { ...form, additionalRoles: ['auditor' as const] };
    const ordinary = await createDefineAction(runtime(['tenant_admin']).rt)(
      inviteUserActionDefinition(),
    )(withAuditor);
    expect(!ordinary.ok && ordinary.error.code).toBe('STEP_UP_REQUIRED');
    const aal1 = await createDefineAction(runtime(['tenant_admin']).rt)(
      invitePrivilegedUserActionDefinition(),
    )(withAuditor);
    expect(!aal1.ok && aal1.error.code).toBe('STEP_UP_REQUIRED');
    // Even at AAL2 the ordinary action refuses privileged roles (they need the strict check).
    const ordinaryAal2 = await createDefineAction(runtime(['tenant_admin'], 'aal2').rt)(
      inviteUserActionDefinition(),
    )(withAuditor);
    expect(!ordinaryAal2.ok && ordinaryAal2.error.code).toBe('VALIDATION_FAILED');
    expect(db.createInvitation).not.toHaveBeenCalled();

    const { rt, getClaims, writeAudit } = runtime(['tenant_admin'], 'aal2');
    const saved = await createDefineAction(rt)(invitePrivilegedUserActionDefinition())(withAuditor);
    expect(saved.ok).toBe(true);
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it('maps createInvitation refusals to field errors; other errors stay internal', async () => {
    const cases = [
      ['EMAIL_TAKEN', 'email'],
      ['EMPLOYEE_NUMBER_TAKEN', 'employeeNumber'],
      ['ROLE_NOT_ALLOWED', 'primaryRole'],
    ] as const;
    for (const [code, path] of cases) {
      db.createInvitation.mockRejectedValueOnce(refusal(code));
      const { rt, writeAudit } = runtime(['hr_manager']);
      const result = await createDefineAction(rt)(inviteUserActionDefinition())(form);
      expect(!result.ok && result.error.code, code).toBe('VALIDATION_FAILED');
      expect(!result.ok && result.error.fieldErrors, code).toEqual([{ path, code }]);
      expect(writeAudit).not.toHaveBeenCalled();
    }
    db.createInvitation.mockRejectedValueOnce(new Error('not implemented: track A'));
    const { rt, logError } = runtime(['hr_manager']);
    const failed = await createDefineAction(rt)(inviteUserActionDefinition())(form);
    expect(!failed.ok && failed.error.code).toBe('INTERNAL_ERROR');
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('resend and revoke', () => {
  it('resend: queued and audited; limit and not pending are refused without audit', async () => {
    db.requestInvitationResend.mockResolvedValueOnce('queued');
    const { rt, writeAudit } = runtime(['hr_manager']);
    const resend = createDefineAction(rt)(resendInvitationActionDefinition());
    expect(await resend({ invitationId: INVITATION })).toEqual(ok({ invitationId: INVITATION }));
    expect(db.requestInvitationResend).toHaveBeenCalledWith(TX, INVITATION);
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.invitation.resend_requested',
      entityType: 'invitation',
      entityId: INVITATION,
    });
    writeAudit.mockClear();
    for (const [outcome, code] of [
      ['limit_reached', 'RESEND_LIMIT'],
      ['not_pending', 'NOT_PENDING'],
    ] as const) {
      db.requestInvitationResend.mockResolvedValueOnce(outcome);
      const result = await resend({ invitationId: INVITATION });
      expect(!result.ok && result.error.fieldErrors).toEqual([{ path: 'invitationId', code }]);
    }
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('resend of a privileged invitation: role.assign_privileged only (as inviting with it)', async () => {
    db.getInvitationRoles.mockResolvedValue({
      primaryRole: 'learner',
      additionalRoles: ['auditor'],
    });
    // HR Manager: not allowed, nothing requested.
    const hr = runtime(['hr_manager']);
    const byHr = await createDefineAction(hr.rt)(resendInvitationActionDefinition())({
      invitationId: INVITATION,
    });
    expect(!byHr.ok && byHr.error.fieldErrors).toEqual([
      { path: 'invitationId', code: 'ROLE_NOT_ALLOWED' },
    ]);
    // Organization Admin without an authenticator code: step up first.
    const aal1 = await createDefineAction(runtime(['tenant_admin']).rt)(
      resendInvitationActionDefinition(),
    )({ invitationId: INVITATION });
    expect(!aal1.ok && aal1.error.code).toBe('STEP_UP_REQUIRED');
    expect(db.requestInvitationResend).not.toHaveBeenCalled();
    expect(hr.writeAudit).not.toHaveBeenCalled();
    // At AAL2 the request goes to the database (which checks the actor again).
    db.requestInvitationResend.mockResolvedValueOnce('queued');
    const aal2 = await createDefineAction(runtime(['tenant_admin'], 'aal2').rt)(
      resendInvitationActionDefinition(),
    )({ invitationId: INVITATION });
    expect(aal2.ok).toBe(true);
    expect(db.getInvitationRoles).toHaveBeenCalledWith(TX, INVITATION);
  });

  it('resend and revoke: a database refusal of the actor is ROLE_NOT_ALLOWED, not a 500', async () => {
    for (const definition of [resendInvitationActionDefinition, revokeInvitationActionDefinition]) {
      db.requestInvitationResend.mockRejectedValueOnce(refusal('ROLE_NOT_ALLOWED'));
      db.revokeInvitation.mockRejectedValueOnce(refusal('ROLE_NOT_ALLOWED'));
      const { rt, writeAudit, logError } = runtime(['hr_manager']);
      const result = await createDefineAction(rt)(definition())({ invitationId: INVITATION });
      expect(!result.ok && result.error.fieldErrors).toEqual([
        { path: 'invitationId', code: 'ROLE_NOT_ALLOWED' },
      ]);
      expect(writeAudit).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
      db.requestInvitationResend.mockReset();
      db.revokeInvitation.mockReset();
    }
    // Anything else stays an internal error.
    db.revokeInvitation.mockRejectedValueOnce(new Error('connection lost'));
    const { rt, logError } = runtime(['hr_manager']);
    const failed = await createDefineAction(rt)(revokeInvitationActionDefinition())({
      invitationId: INVITATION,
    });
    expect(!failed.ok && failed.error.code).toBe('INTERNAL_ERROR');
    expect(logError).toHaveBeenCalledTimes(1);
    db.requestInvitationResend.mockRejectedValueOnce(new Error('connection lost'));
    const resendFailed = await createDefineAction(runtime(['hr_manager']).rt)(
      resendInvitationActionDefinition(),
    )({ invitationId: INVITATION });
    expect(!resendFailed.ok && resendFailed.error.code).toBe('INTERNAL_ERROR');
  });

  it('revoke: audited; an invitation no longer pending is refused', async () => {
    db.revokeInvitation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { rt, writeAudit } = runtime(['tenant_admin']);
    const revoke = createDefineAction(rt)(revokeInvitationActionDefinition());
    expect(await revoke({ invitationId: INVITATION })).toEqual(ok({ invitationId: INVITATION }));
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.invitation.revoked',
      entityType: 'invitation',
      entityId: INVITATION,
    });
    const again = await revoke({ invitationId: INVITATION });
    expect(!again.ok && again.error.fieldErrors).toEqual([
      { path: 'invitationId', code: 'NOT_PENDING' },
    ]);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it('without platform.user.invite or with a malformed id: refused before the database', async () => {
    for (const definition of [resendInvitationActionDefinition, revokeInvitationActionDefinition]) {
      const learner = await createDefineAction(runtime(['learner']).rt)(definition())({
        invitationId: INVITATION,
      });
      expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
      const malformed = await createDefineAction(runtime(['tenant_admin']).rt)(definition())({
        invitationId: 'x',
      });
      expect(!malformed.ok && malformed.error.code).toBe('VALIDATION_FAILED');
    }
    expect(db.requestInvitationResend).not.toHaveBeenCalled();
    expect(db.revokeInvitation).not.toHaveBeenCalled();
    expect(MAX_INVITATION_SENDS).toBe(4);
  });
});

describe('invitation queries', () => {
  it('lists pending and expired invitations, newest first; needs platform.user.invite', async () => {
    db.listInvitations.mockResolvedValue([
      row({ id: 'a', createdAt: new Date('2026-10-01T00:00:00Z'), state: 'expired' }),
      row({ id: 'b', state: 'accepted' }),
      row({ id: 'c', state: 'revoked' }),
      row({ id: 'd', createdAt: new Date('2026-10-06T00:00:00Z') }),
    ]);
    const list = await createDefineQuery(runtime(['hr_manager']).rt)(
      invitationsListQueryDefinition(),
    )({});
    expect(list.ok && list.value.invitations.map((i) => i.id)).toEqual(['d', 'a']);
    const learner = await createDefineQuery(runtime(['line_manager', 'learner']).rt)(
      invitationsListQueryDefinition(),
    )({});
    expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
  });

  it('invite form: active managers, org units and what privileged roles need', async () => {
    db.listManagerOptions.mockResolvedValue([
      { personId: 'm1', nameAr: 'أ', nameEn: null, active: true, departmentIds: [] },
      { personId: 'm2', nameAr: 'ب', nameEn: null, active: false, departmentIds: [] },
    ]);
    const units = { departments: [{ id: DEPARTMENT, nameAr: 'ت', nameEn: null }], branches: [] };
    db.listOrgUnitOptions.mockResolvedValue(units);
    const query = (roles: SystemRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') =>
      createDefineQuery(runtime(roles, aal).rt)(inviteFormQueryDefinition())({});
    expect(await query(['hr_manager'])).toMatchObject({
      ok: true,
      value: { managers: [{ personId: 'm1' }], orgUnits: units, privilegedAccess: 'denied' },
    });
    expect(await query(['tenant_admin'])).toMatchObject({
      value: { privilegedAccess: 'step_up_required' },
    });
    expect(await query(['tenant_admin'], 'aal2')).toMatchObject({
      value: { privilegedAccess: 'allowed' },
    });
    const learner = await query(['learner']);
    expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
  });
});
