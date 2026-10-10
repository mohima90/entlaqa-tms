import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grant } from '../authorize';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { MEMBER_GRANTS } from '../member-permissions';
import { grantsForAssignments } from '../role-grants';
import type { ResourceAttributes } from '../scopes';
import { SYSTEM_ROLES, type SystemRoleCode } from '../system-roles';
import {
  SecuritySettingsInput,
  endMemberSessionsActionDefinition,
  endMySessionsActionDefinition,
  memberSecurityQueryDefinition,
  mySecurityQueryDefinition,
  resetMemberMfaActionDefinition,
  securityPageQueryDefinition,
  updateSecurityPolicyActionDefinition,
} from './security';

const db = vi.hoisted(() => ({
  MFA_MODES: ['off', 'optional', 'required_all', 'required_roles'] as const,
  SECURITY_LIMITS: {
    mfaGraceDays: { min: 0, max: 30 },
    passwordMinLength: { min: 12, max: 36 },
    lockoutThreshold: { min: 3, max: 5 },
    lockoutMinutes: { min: 15, max: 60 },
    sessionIdleMinutes: { min: 5, max: 480 },
    sessionMaxHours: { min: 1, max: 24 },
    sessionMaxDevices: { min: 1, max: 10 },
  },
  changedSettings: (before: Record<string, unknown>, after: Record<string, unknown>) =>
    Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])),
  getSecurityPolicy: vi.fn(),
  updateSecurityPolicy: vi.fn(),
  passwordMinLengthForCaller: vi.fn(),
  getMemberMfa: vi.fn(),
  listMySessions: vi.fn(),
  endMySessions: vi.fn(),
  listMemberSessions: vi.fn(),
  endMemberSessions: vi.fn(),
  mayManagePerson: vi.fn(),
  resetMemberMfa: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const SARA = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';

const sara: ResourceAttributes = {
  type: 'person',
  id: SARA,
  tenantId: TENANT,
  subjectPersonId: SARA,
};

/** `codeAgeSeconds`: how long ago the session passed its authenticator code (aal2). */
function runtime(
  grants: readonly Grant[],
  aal: 'aal1' | 'aal2' = 'aal1',
  found = true,
  codeAgeSeconds = 0,
) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const getClaims = vi.fn(() => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal,
      ...(aal === 'aal2'
        ? { amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - codeAgeSeconds }] }
        : {}),
      session_id: SESSION,
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
    loadGrants: () => Promise.resolve([...grants, ...MEMBER_GRANTS]),
    resolveResource: () => Promise.resolve(found ? sara : null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit, getClaims };
}

const forRoles = (...roles: SystemRoleCode[]) =>
  grantsForAssignments(
    roles.map((roleCode) => ({ roleCode })),
    { headedDepartmentIds: [] },
  );

const settings = {
  mfaMode: 'off' as const,
  mfaRequiredRoles: ['tenant_admin'] as SystemRoleCode[],
  mfaGraceDays: 7,
  mfaPromptAdmins: true,
  passwordMinLength: 12,
  lockoutThreshold: 5,
  lockoutMinutes: 15,
  sessionIdleMinutes: 30,
  sessionMaxHours: 12,
  sessionMaxDevices: 3,
};
const policy = {
  ...settings,
  mfaRequiredSince: null,
  updatedAt: new Date(0),
  updatedBy: null,
  version: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.getSecurityPolicy.mockResolvedValue(policy);
  db.passwordMinLengthForCaller.mockResolvedValue(16);
  db.getMemberMfa.mockResolvedValue({ usesApp: true, since: new Date(1), pending: false });
  db.listMySessions.mockResolvedValue([]);
  db.listMemberSessions.mockResolvedValue([]);
  db.endMySessions.mockResolvedValue(1);
  db.endMemberSessions.mockResolvedValue(2);
  db.mayManagePerson.mockResolvedValue(true);
  db.resetMemberMfa.mockResolvedValue('reset');
});

describe('security settings page (screen 6)', () => {
  it('the Organization Admin reads it; editing needs a code first (AAL2, PO D-IAM-01)', async () => {
    const admin = createDefineQuery(runtime(forRoles('tenant_admin')).rt)(
      securityPageQueryDefinition(),
    );
    expect(await admin({})).toEqual(ok({ policy, editAccess: 'step_up_required' }));
    const verified = createDefineQuery(runtime(forRoles('tenant_admin'), 'aal2').rt)(
      securityPageQueryDefinition(),
    );
    expect(await verified({})).toEqual(ok({ policy, editAccess: 'allowed' }));
  });

  it('the Auditor reads it, cannot edit; roles without organization settings: FORBIDDEN', async () => {
    const auditor = createDefineQuery(runtime(forRoles('auditor'), 'aal2').rt)(
      securityPageQueryDefinition(),
    );
    expect(await auditor({})).toEqual(ok({ policy, editAccess: 'denied' }));
    for (const role of ['hr_manager', 'training_manager', 'learner', 'line_manager'] as const) {
      const query = createDefineQuery(runtime(forRoles(role), 'aal2').rt)(
        securityPageQueryDefinition(),
      );
      const result = await query({});
      expect(!result.ok && result.error.code, role).toBe('FORBIDDEN');
    }
  });
});

describe('changing the policy (high risk, Organization Admin at AAL2)', () => {
  const input = { ...settings, version: 4, passwordMinLength: 16, sessionIdleMinutes: 15 };

  it('the Organization Admin at AAL2 saves; audited with before/after of the changed settings', async () => {
    db.updateSecurityPolicy.mockResolvedValue({
      outcome: 'updated',
      before: settings,
      after: { ...settings, passwordMinLength: 16, sessionIdleMinutes: 15 },
    });
    const { rt, writeAudit, getClaims } = runtime(forRoles('tenant_admin'), 'aal2');
    const result = await createDefineAction(rt)(updateSecurityPolicyActionDefinition())(input);
    expect(result).toEqual(
      ok({
        tenantId: TENANT,
        changed: ['passwordMinLength', 'sessionIdleMinutes'],
        before: { passwordMinLength: 12, sessionIdleMinutes: 30 },
        after: { passwordMinLength: 16, sessionIdleMinutes: 15 },
      }),
    );
    expect(getClaims).toHaveBeenCalledWith({ strict: true }); // getUser before a high-risk change
    expect(db.updateSecurityPolicy).toHaveBeenCalledWith(
      TX,
      { ...settings, passwordMinLength: 16, sessionIdleMinutes: 15 },
      4,
    );
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.security.policy_changed',
      entityType: 'security_policy',
      entityId: TENANT,
      data: {
        changed: ['passwordMinLength', 'sessionIdleMinutes'],
        before: { passwordMinLength: 12, sessionIdleMinutes: 30 },
        after: { passwordMinLength: 16, sessionIdleMinutes: 15 },
      },
    });
  });

  it('at AAL1 the Organization Admin gets STEP_UP_REQUIRED; nothing is written', async () => {
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'), 'aal1');
    const result = await createDefineAction(rt)(updateSecurityPolicyActionDefinition())(input);
    expect(!result.ok && result.error.code).toBe('STEP_UP_REQUIRED');
    expect(db.updateSecurityPolicy).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('every other role is FORBIDDEN, even at AAL2 (no role but the Organization Admin holds it)', async () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.code !== 'tenant_admin')) {
      const { rt } = runtime(forRoles(role.code), 'aal2');
      const result = await createDefineAction(rt)(updateSecurityPolicyActionDefinition())(input);
      expect(!result.ok && result.error.code, role.code).toBe('FORBIDDEN');
    }
    expect(db.updateSecurityPolicy).not.toHaveBeenCalled();
  });

  it('a changed policy (version) is a conflict; a database refusal FORBIDDEN; no change, no audit', async () => {
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'), 'aal2');
    const action = createDefineAction(rt)(updateSecurityPolicyActionDefinition());
    db.updateSecurityPolicy.mockResolvedValueOnce({ outcome: 'conflict' });
    const conflict = await action(input);
    expect(!conflict.ok && conflict.error.code).toBe('CONFLICT_VERSION');
    db.updateSecurityPolicy.mockResolvedValueOnce({ outcome: 'refused' });
    const refused = await action(input);
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    db.updateSecurityPolicy.mockResolvedValueOnce({
      outcome: 'updated',
      before: settings,
      after: settings,
    });
    expect((await action({ ...settings, version: 4 })).ok).toBe(true);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('keeps the role list for "required for roles" only', async () => {
    db.updateSecurityPolicy.mockResolvedValue({
      outcome: 'updated',
      before: settings,
      after: settings,
    });
    const { rt } = runtime(forRoles('tenant_admin'), 'aal2');
    const action = createDefineAction(rt)(updateSecurityPolicyActionDefinition());
    await action({
      ...input,
      mfaMode: 'required_all',
      mfaRequiredRoles: ['learner'] as SystemRoleCode[],
    });
    expect(db.updateSecurityPolicy.mock.calls[0]?.[1]).toMatchObject({
      mfaRequiredRoles: ['tenant_admin'],
    });
    await action({
      ...input,
      mfaMode: 'required_roles',
      mfaRequiredRoles: ['learner', 'hr_manager'] as SystemRoleCode[],
    });
    expect(db.updateSecurityPolicy.mock.calls[1]?.[1]).toMatchObject({
      mfaRequiredRoles: ['learner', 'hr_manager'],
    });
  });

  it('validates every setting against the platform floors', () => {
    const valid = { ...settings, version: 1 };
    expect(SecuritySettingsInput.safeParse(valid).success).toBe(true);
    for (const bad of [
      { passwordMinLength: 11 },
      { passwordMinLength: 37 },
      { lockoutThreshold: 0 },
      // Never more lenient than the platform default (TM-0003 T-IAM-24).
      { lockoutThreshold: 6 },
      { lockoutMinutes: 14 },
      { lockoutMinutes: 61 },
      { sessionIdleMinutes: 4 },
      { sessionMaxHours: 25 },
      { sessionMaxDevices: 0 },
      { mfaGraceDays: 31 },
      { mfaMode: 'sometimes' },
      { mfaMode: 'required_roles', mfaRequiredRoles: [] },
      { mfaRequiredRoles: ['platform_super_admin'] },
      { sessionMaxHours: 1, sessionIdleMinutes: 90 },
      { passwordMinLength: 12.5 },
      { extra: true },
    ]) {
      expect(
        SecuritySettingsInput.safeParse({ ...valid, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});

describe('own sign-in sessions (My profile)', () => {
  it('every member lists their own sessions and password rule', async () => {
    const query = createDefineQuery(runtime([]).rt)(mySecurityQueryDefinition());
    expect(await query({})).toEqual(
      ok({ sessions: [], passwordMinLength: 16, usesApp: true, appPending: false }),
    );
    expect(db.getMemberMfa).toHaveBeenCalledWith(TX, ME);
    db.passwordMinLengthForCaller.mockResolvedValue(null);
    const gone = await query({});
    expect(!gone.ok && gone.error.code).toBe('UNAUTHENTICATED');
  });

  it('ends one other session or all others; audited without personal data', async () => {
    const { rt, writeAudit } = runtime([]);
    const action = createDefineAction(rt)(endMySessionsActionDefinition());
    expect(await action({ sessionId: null })).toEqual(ok({ ended: 1, scope: 'others' }));
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.auth.own_sessions_ended',
      entityType: 'user',
      data: { scope: 'others', count: 1 },
    });
    db.endMySessions.mockResolvedValue(0);
    const unknown = await action({ sessionId: SESSION });
    expect(!unknown.ok && unknown.error.code).toBe('NOT_FOUND');
    const bad = await action({ sessionId: 'not-a-uuid' });
    expect(!bad.ok && bad.error.code).toBe('VALIDATION_FAILED');
  });
});

describe("a member's sessions (screen 3: user managers)", () => {
  it('the Organization Admin and the HR Manager list them and sign the member out', async () => {
    for (const role of ['tenant_admin', 'hr_manager'] as const) {
      const { rt, writeAudit } = runtime(forRoles(role));
      const query = createDefineQuery(rt)(memberSecurityQueryDefinition());
      expect(await query({ personId: SARA })).toEqual(
        ok({
          sessions: [],
          usesApp: true,
          appSince: new Date(1),
          appPending: false,
          // Only the Organization Admin resets a lost authenticator app (PO answer, 9 Oct 2026),
          // with a code of their own first (this session has none).
          canResetApp: role === 'tenant_admin',
          resetNeedsCode: role === 'tenant_admin',
          maxDevices: 3,
        }),
      );
      const end = createDefineAction(rt)(endMemberSessionsActionDefinition());
      expect(await end({ personId: SARA, sessionId: null })).toEqual(
        ok({ personId: SARA, ended: 2, scope: 'all' }),
      );
      expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
        action: 'platform.user.sessions_ended',
        entityType: 'person',
        entityId: SARA,
        data: { scope: 'all', count: 2 },
      });
    }
  });

  it('roles without user management are FORBIDDEN; out of scope 404; the manage rule FORBIDDEN', async () => {
    for (const role of ['learner', 'line_manager', 'auditor', 'training_manager'] as const) {
      const { rt } = runtime(forRoles(role));
      const end = await createDefineAction(rt)(endMemberSessionsActionDefinition())({
        personId: SARA,
        sessionId: null,
      });
      expect(!end.ok && end.error.code, role).toBe('FORBIDDEN');
      const list = await createDefineQuery(rt)(memberSecurityQueryDefinition())({ personId: SARA });
      expect(!list.ok && list.error.code, role).toBe('FORBIDDEN');
    }
    const outOfScope = runtime(forRoles('hr_manager'), 'aal1', false);
    const missing = await createDefineAction(outOfScope.rt)(endMemberSessionsActionDefinition())({
      personId: SARA,
      sessionId: null,
    });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    // An HR Manager on a member with a privileged role (only the Organization Admin manages them).
    db.mayManagePerson.mockResolvedValue(false);
    const { rt } = runtime(forRoles('hr_manager'));
    const end = await createDefineAction(rt)(endMemberSessionsActionDefinition())({
      personId: SARA,
      sessionId: null,
    });
    expect(!end.ok && end.error.code).toBe('FORBIDDEN');
    expect(db.endMemberSessions).not.toHaveBeenCalled();
  });

  it('a database refusal (insufficient_privilege) is FORBIDDEN; a session not found 404', async () => {
    const { rt } = runtime(forRoles('tenant_admin'));
    const end = createDefineAction(rt)(endMemberSessionsActionDefinition());
    db.endMemberSessions.mockRejectedValueOnce(
      Object.assign(new Error('refused'), { code: '42501' }),
    );
    const refused = await end({ personId: SARA, sessionId: null });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    db.endMemberSessions.mockRejectedValueOnce(
      Object.assign(new Error('wrapped'), { cause: { code: '42501' } }),
    );
    const wrapped = await end({ personId: SARA, sessionId: null });
    expect(!wrapped.ok && wrapped.error.code).toBe('FORBIDDEN');
    db.endMemberSessions.mockResolvedValueOnce(0);
    const gone = await end({ personId: SARA, sessionId: SESSION });
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
    db.endMemberSessions.mockRejectedValueOnce(new Error('db down'));
    const failed = await end({ personId: SARA, sessionId: null });
    expect(!failed.ok && failed.error.code).toBe('INTERNAL_ERROR');
  });
});

describe("a member's lost authenticator app (screen 3; PO answer 9 Oct 2026)", () => {
  const reset = (rt: ActionRuntime<UserTx>) =>
    createDefineAction(rt)(resetMemberMfaActionDefinition());

  it('the Organization Admin with a recent code resets it; audited without personal data', async () => {
    const { rt, writeAudit, getClaims } = runtime(forRoles('tenant_admin'), 'aal2');
    expect(await reset(rt)({ personId: SARA })).toEqual(ok({ personId: SARA }));
    expect(db.resetMemberMfa).toHaveBeenCalledWith(TX, SARA);
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.user.mfa_reset',
      entityType: 'person',
      entityId: SARA,
      data: { method: 'totp' },
    });
  });

  it('authorization negatives: no code, every other role, out of scope, the manage rule, the database', async () => {
    // Without a code (AAL1): STEP_UP_REQUIRED — the /mfa page asks for one first.
    const aal1 = await reset(runtime(forRoles('tenant_admin')).rt)({ personId: SARA });
    expect(!aal1.ok && aal1.error.code).toBe('STEP_UP_REQUIRED');
    // No other role holds the permission, not even the HR Manager who signs members out.
    for (const role of SYSTEM_ROLES.map((r) => r.code).filter((c) => c !== 'tenant_admin')) {
      const result = await reset(runtime(forRoles(role), 'aal2').rt)({ personId: SARA });
      expect(!result.ok && result.error.code, role).toBe('FORBIDDEN');
    }
    const outOfScope = await reset(runtime(forRoles('tenant_admin'), 'aal2', false).rt)({
      personId: SARA,
    });
    expect(!outOfScope.ok && outOfScope.error.code).toBe('NOT_FOUND');
    db.mayManagePerson.mockResolvedValueOnce(false);
    const unmanaged = await reset(runtime(forRoles('tenant_admin'), 'aal2').rt)({ personId: SARA });
    expect(!unmanaged.ok && unmanaged.error.code).toBe('FORBIDDEN');
    db.resetMemberMfa.mockRejectedValueOnce(Object.assign(new Error('refused'), { code: '42501' }));
    const refused = await reset(runtime(forRoles('tenant_admin'), 'aal2').rt)({ personId: SARA });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    expect(db.resetMemberMfa).toHaveBeenCalledTimes(1);
  });

  it("the database's answers: no app, another organization (ENTLAQA support), oneself, gone", async () => {
    const cases = [
      ['no_app', 'MFA_RESET_NO_APP'],
      ['other_organization', 'MFA_RESET_OTHER_ORGANIZATION'],
      ['self', 'FORBIDDEN'],
      ['not_found', 'NOT_FOUND'],
    ] as const;
    for (const [outcome, code] of cases) {
      db.resetMemberMfa.mockResolvedValueOnce(outcome);
      const { rt, writeAudit } = runtime(forRoles('tenant_admin'), 'aal2');
      const result = await reset(rt)({ personId: SARA });
      expect(!result.ok && result.error.code, outcome).toBe(code);
      expect(writeAudit).not.toHaveBeenCalled();
    }
  });

  it("one cannot reset one's own app from the user list (My profile does that)", async () => {
    const { rt } = runtime(forRoles('tenant_admin'), 'aal2');
    const query = createDefineQuery(rt)(memberSecurityQueryDefinition());
    const own = await query({ personId: ME });
    expect(own.ok && own.value.canResetApp).toBe(false);
    expect(own.ok && own.value.resetNeedsCode).toBe(false);
  });

  it('a code older than 15 minutes is asked again before the reset (review L3, PO answer 9 Oct 2026)', async () => {
    const fresh = createDefineQuery(runtime(forRoles('tenant_admin'), 'aal2', true, 14 * 60).rt)(
      memberSecurityQueryDefinition(),
    );
    const view = await fresh({ personId: SARA });
    expect(view.ok && [view.value.canResetApp, view.value.resetNeedsCode]).toEqual([true, false]);
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'), 'aal2', true, 16 * 60);
    const stale = await createDefineQuery(rt)(memberSecurityQueryDefinition())({ personId: SARA });
    expect(stale.ok && [stale.value.canResetApp, stale.value.resetNeedsCode]).toEqual([true, true]);
    const refused = await reset(rt)({ personId: SARA });
    expect(!refused.ok && refused.error.code).toBe('STEP_UP_REQUIRED');
    expect(db.resetMemberMfa).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
