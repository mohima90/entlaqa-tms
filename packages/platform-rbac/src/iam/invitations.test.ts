import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { InvitationRow, UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
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
  viewInvitationCodeActionDefinition,
  viewPrivilegedInvitationCodeActionDefinition,
} from './invitations';

const db = vi.hoisted(() => ({
  createInvitation: vi.fn(),
  getInvitationRoles: vi.fn(),
  invitationCode: vi.fn(),
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
  requestInvitationResend: vi.fn(),
  listManagerOptions: vi.fn(),
  listOrgUnitOptions: vi.fn(),
  // Custom roles of the organization (EP-ROLES).
  listCustomRoles: vi.fn(),
  getCustomRole: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const INVITATION = '66666666-6666-4666-8666-666666666666';
const PERSON = '77777777-7777-4777-8777-777777777777';
const DEPARTMENT = '88888888-8888-4888-8888-888888888888';

function runtime(roles: TestRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') {
  const writeAudit = vi.fn(() => Promise.resolve());
  const logError = vi.fn();
  const getClaims = vi.fn((_options: { strict: boolean }) => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal,
      ...(aal === 'aal2'
        ? { amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] }
        : {}),
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
  role: 'department_head',
  locale: 'ar' as const,
};

/** Custom roles of the organization: a reader (ordinary) and an auditor (privileged: audit log). */
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
const CUSTOM = [READER, AUDITOR, PROFILE];

const refusal = (code: string) => Object.assign(new Error(code), { code });

const row = (over: Partial<InvitationRow> = {}): InvitationRow => ({
  id: INVITATION,
  personId: PERSON,
  email: 'n@alraya.example',
  displayNameAr: 'نورة الدوسري',
  displayNameEn: null,
  primaryRole: 'learner',
  primaryRoleName: null,
  privileged: false,
  state: 'pending',
  sendCount: 1,
  expiresAt: new Date('2026-10-14T09:00:00Z'),
  createdAt: new Date('2026-10-07T09:00:00Z'),
  importId: null,
  additionalRoles: [],
  hasCode: false,
  locale: 'ar',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.createInvitation.mockResolvedValue({
    invitationId: INVITATION,
    personId: PERSON,
    inviteCode: 'K7M2PQ9XHT4W',
  });
  db.getInvitationRoles.mockResolvedValue({
    primaryRole: 'learner',
    additionalRoles: [],
    privileged: false,
  });
  db.listCustomRoles.mockResolvedValue(CUSTOM);
  db.getCustomRole.mockImplementation((_tx: unknown, key: { code: string }) =>
    Promise.resolve(CUSTOM.find((r) => r.code === key.code) ?? null),
  );
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
    expect(InviteUserInput.parse({ ...form, employeeNumber: ' ' }).employeeNumber).toBeNull();
    expect(InviteUserInput.parse({ ...form, role: READER.code }).role).toBe(READER.code);
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
      { ...form, role: 'Platform Super Admin' },
      { ...form, role: 'custom_XYZ' },
      { ...form, role: '' },
      // One role per person (EP-ROLES): no additional roles any more.
      { ...form, additionalRoles: ['learner'] },
      { ...form, locale: 'fr' },
      { ...form, tenantId: TENANT },
    ]) {
      expect(InviteUserInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('tells privileged invitations apart (computed by the database, custom roles included)', () => {
    expect(invitationGivesPrivilegedRole(row())).toBe(false);
    expect(invitationGivesPrivilegedRole(row({ privileged: true }))).toBe(true);
  });

  it('reads the refusal code of createInvitation errors only', () => {
    expect(invitationRefusalCode(refusal('EMAIL_TAKEN'))).toBe('EMAIL_TAKEN');
    expect(invitationRefusalCode({ code: 'ROLE_NOT_ALLOWED' })).toBe('ROLE_NOT_ALLOWED');
    expect(invitationRefusalCode({ code: 'ROLE_CONFLICT' })).toBe('ROLE_CONFLICT');
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
        role: 'department_head',
        // The first code, for the inviter to copy (Kawadir) — never audited.
        inviteCode: 'K7M2PQ9XHT4W',
        locale: 'ar',
        // No public origin configured: the browser builds the link on its own origin.
        inviteLink: null,
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
      primaryRole: 'department_head',
      additionalRoles: [],
      locale: 'ar',
    });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.invitation.created',
      entityType: 'invitation',
      entityId: INVITATION,
      data: { personId: PERSON, role: 'department_head' },
    });
    const audited = JSON.stringify(writeAudit.mock.calls);
    expect(audited).not.toContain('alraya');
    expect(audited).not.toContain('نورة');
    expect(audited).not.toContain('K7M2PQ9XHT4W');
    expect(getClaims).toHaveBeenCalledWith({ strict: false });
  });

  it('without platform.user.invite: FORBIDDEN, nothing created', async () => {
    for (const roles of [['learner'], ['training_manager'], ['auditor']] as TestRoleCode[][]) {
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

  it('HR Manager giving a privileged role, or one with permissions they lack: ROLE_NOT_ALLOWED, nothing created', async () => {
    const hr = createDefineAction(runtime(['hr_manager']).rt)(inviteUserActionDefinition());
    for (const role of ['tenant_admin', 'hr_manager', AUDITOR.code, PROFILE.code]) {
      const refused = await hr({ ...form, role });
      expect(!refused.ok && refused.error.fieldErrors, role).toEqual([
        { path: 'role', code: 'ROLE_NOT_ALLOWED' },
      ]);
    }
    // An ordinary custom role whose permissions HR holds is fine.
    expect((await hr({ ...form, role: READER.code })).ok).toBe(true);
    db.createInvitation.mockClear();
    // An unknown role (a former one, a deleted custom role): a field error.
    for (const role of ['auditor', 'custom_ffffffffffff']) {
      const unknown = await hr({ ...form, role });
      expect(!unknown.ok && unknown.error.fieldErrors, role).toEqual([
        { path: 'role', code: 'ROLE_UNKNOWN' },
      ]);
    }
    // The privileged action itself: HR does not hold role.assign_privileged.
    const privileged = await createDefineAction(runtime(['hr_manager'], 'aal2').rt)(
      invitePrivilegedUserActionDefinition(),
    )({ ...form, role: 'tenant_admin' });
    expect(!privileged.ok && privileged.error.code).toBe('FORBIDDEN');
    expect(db.createInvitation).not.toHaveBeenCalled();
  });

  it('Organization Admin: privileged roles through the privileged action (strict check), no authenticator code', async () => {
    const withAuditor = { ...form, role: AUDITOR.code };
    // The ordinary action refuses privileged roles at any level (they need the strict check).
    for (const aal of ['aal1', 'aal2'] as const) {
      const ordinary = await createDefineAction(runtime(['tenant_admin'], aal).rt)(
        inviteUserActionDefinition(),
      )(withAuditor);
      expect(!ordinary.ok && ordinary.error.code, aal).toBe('VALIDATION_FAILED');
    }
    expect(db.createInvitation).not.toHaveBeenCalled();

    // AAL1 (PO decision, 14 Oct 2026: no authenticator code for organization-level actions).
    const { rt, getClaims, writeAudit } = runtime(['tenant_admin']);
    const saved = await createDefineAction(rt)(invitePrivilegedUserActionDefinition())(withAuditor);
    expect(saved.ok).toBe(true);
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it('maps createInvitation refusals to field errors; other errors stay internal', async () => {
    const cases = [
      ['EMAIL_TAKEN', 'email'],
      ['EMPLOYEE_NUMBER_TAKEN', 'employeeNumber'],
      ['ROLE_NOT_ALLOWED', 'role'],
      ['ROLE_CONFLICT', 'role'],
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

/** Resend and revoke, as one action shape (neither returns a code). */
const BOTH_DEFINITIONS: readonly (() => ReturnType<typeof revokeInvitationActionDefinition>)[] = [
  resendInvitationActionDefinition,
  revokeInvitationActionDefinition,
];

describe('resend and revoke', () => {
  it('resend: a new code, audited without it; limit and not pending are refused without audit', async () => {
    db.requestInvitationResend.mockResolvedValueOnce({
      status: 'queued',
      inviteCode: 'NEWCQDE2HT4W',
    });
    const { rt, writeAudit } = runtime(['hr_manager']);
    const resend = createDefineAction(rt)(resendInvitationActionDefinition());
    // The new code is not returned: it is copied like any other (authorized and audited, review M2).
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
      db.requestInvitationResend.mockResolvedValueOnce({ status: outcome });
      const result = await resend({ invitationId: INVITATION });
      expect(!result.ok && result.error.fieldErrors).toEqual([{ path: 'invitationId', code }]);
    }
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('resend of a privileged invitation: role.assign_privileged only (as inviting with it)', async () => {
    db.getInvitationRoles.mockResolvedValue({
      primaryRole: 'custom_a00000000002',
      additionalRoles: [],
      privileged: true,
    });
    // HR Manager: not allowed, nothing requested.
    const hr = runtime(['hr_manager']);
    const byHr = await createDefineAction(hr.rt)(resendInvitationActionDefinition())({
      invitationId: INVITATION,
    });
    expect(!byHr.ok && byHr.error.fieldErrors).toEqual([
      { path: 'invitationId', code: 'ROLE_NOT_ALLOWED' },
    ]);
    expect(db.requestInvitationResend).not.toHaveBeenCalled();
    expect(hr.writeAudit).not.toHaveBeenCalled();
    // The Organization Admin, at AAL1 (no authenticator code): the request goes to the database (which
    // checks the actor again).
    db.requestInvitationResend.mockResolvedValueOnce({
      status: 'queued',
      inviteCode: 'NEWCQDE2HT4W',
    });
    const aal1 = await createDefineAction(runtime(['tenant_admin']).rt)(
      resendInvitationActionDefinition(),
    )({ invitationId: INVITATION });
    expect(aal1.ok).toBe(true);
    expect(db.getInvitationRoles).toHaveBeenCalledWith(TX, INVITATION);
  });

  it('resend and revoke: a database refusal of the actor is ROLE_NOT_ALLOWED, not a 500', async () => {
    for (const definition of BOTH_DEFINITIONS) {
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
    for (const definition of BOTH_DEFINITIONS) {
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
    // HR may not copy privileged invitations' codes; the Organization Admin may.
    expect(list.ok && list.value.canCopyPrivileged).toBe(false);
    const admin = await createDefineQuery(runtime(['tenant_admin']).rt)(
      invitationsListQueryDefinition(),
    )({});
    expect(admin.ok && admin.value.canCopyPrivileged).toBe(true);
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
    const query = (roles: TestRoleCode[], aal: 'aal1' | 'aal2' = 'aal1') =>
      createDefineQuery(runtime(roles, aal).rt)(inviteFormQueryDefinition())({});
    expect(await query(['hr_manager'])).toMatchObject({
      ok: true,
      value: { managers: [{ personId: 'm1' }], orgUnits: units, privilegedAccess: 'denied' },
    });
    for (const aal of ['aal1', 'aal2'] as const) {
      expect(await query(['tenant_admin'], aal)).toMatchObject({
        value: { privilegedAccess: 'allowed' },
      });
    }
    const learner = await query(['learner']);
    expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
  });
});

describe('copy an invitation code (security review M2)', () => {
  const link = (locale: 'ar' | 'en', code: string) =>
    `https://tms.example.com/${locale}/sign-up#code=${code}`;

  beforeEach(() => {
    db.invitationCode.mockResolvedValue({ inviteCode: 'K7M2PQ9XHT4W', locale: 'en' });
  });

  it("HR Manager: an ordinary invitation's code and link, audited with ids only (never the code)", async () => {
    const { rt, writeAudit, getClaims } = runtime(['hr_manager']);
    const view = createDefineAction(rt)(viewInvitationCodeActionDefinition({ inviteLinkOf: link }));
    expect(await view({ invitationId: INVITATION })).toEqual(
      ok({
        invitationId: INVITATION,
        inviteCode: 'K7M2PQ9XHT4W',
        locale: 'en',
        inviteLink: 'https://tms.example.com/en/sign-up#code=K7M2PQ9XHT4W',
      }),
    );
    expect(db.invitationCode).toHaveBeenCalledWith(TX, INVITATION);
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.invitation.code_viewed',
      entityType: 'invitation',
      entityId: INVITATION,
      data: { privileged: false },
    });
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain('K7M2PQ9XHT4W');
    expect(getClaims).toHaveBeenCalledWith({ strict: false });
  });

  it('a privileged invitation: not through the ordinary action (ROLE_NOT_ALLOWED, no read, no audit)', async () => {
    db.getInvitationRoles.mockResolvedValue({
      primaryRole: 'custom_a00000000002',
      additionalRoles: [],
      privileged: true,
    });
    for (const roles of [['hr_manager'], ['tenant_admin']] as TestRoleCode[][]) {
      const { rt, writeAudit } = runtime(roles);
      const result = await createDefineAction(rt)(viewInvitationCodeActionDefinition())({
        invitationId: INVITATION,
      });
      expect(!result.ok && result.error.fieldErrors).toEqual([
        { path: 'invitationId', code: 'ROLE_NOT_ALLOWED' },
      ]);
      expect(writeAudit).not.toHaveBeenCalled();
    }
    expect(db.invitationCode).not.toHaveBeenCalled();
  });

  it('the privileged action: role.assign_privileged with the strict session check (getUser)', async () => {
    db.getInvitationRoles.mockResolvedValue({
      primaryRole: 'hr_manager',
      additionalRoles: [],
      privileged: true,
    });
    const admin = runtime(['tenant_admin']);
    const result = await createDefineAction(admin.rt)(
      viewPrivilegedInvitationCodeActionDefinition(),
    )({ invitationId: INVITATION });
    expect(result).toEqual(
      ok({ invitationId: INVITATION, inviteCode: 'K7M2PQ9XHT4W', locale: 'en', inviteLink: null }),
    );
    expect(admin.getClaims).toHaveBeenCalledWith({ strict: true });
    expect(admin.writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.invitation.code_viewed',
      entityType: 'invitation',
      entityId: INVITATION,
      data: { privileged: true },
    });
    // HR Manager: no role.assign_privileged → FORBIDDEN before anything is read.
    const hr = runtime(['hr_manager']);
    const refused = await createDefineAction(hr.rt)(viewPrivilegedInvitationCodeActionDefinition())(
      {
        invitationId: INVITATION,
      },
    );
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    expect(hr.writeAudit).not.toHaveBeenCalled();
  });

  it('no code to copy (expired, held, other organization, unknown): refused without audit', async () => {
    const { rt, writeAudit } = runtime(['tenant_admin']);
    const view = createDefineAction(rt)(viewInvitationCodeActionDefinition());
    db.invitationCode.mockResolvedValueOnce(null);
    const none = await view({ invitationId: INVITATION });
    expect(!none.ok && none.error.fieldErrors).toEqual([{ path: 'invitationId', code: 'NO_CODE' }]);
    db.getInvitationRoles.mockResolvedValueOnce(null);
    const unknown = await view({ invitationId: INVITATION });
    expect(!unknown.ok && unknown.error.fieldErrors).toEqual([
      { path: 'invitationId', code: 'NOT_PENDING' },
    ]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('without platform.user.invite: FORBIDDEN', async () => {
    const result = await createDefineAction(runtime(['learner']).rt)(
      viewInvitationCodeActionDefinition(),
    )({ invitationId: INVITATION });
    expect(!result.ok && result.error.code).toBe('FORBIDDEN');
    expect(db.invitationCode).not.toHaveBeenCalled();
  });
});
