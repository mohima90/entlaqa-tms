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
  memberSecurityQueryDefinition,
  mySecurityQueryDefinition,
  securityPageQueryDefinition,
  updateSecurityPolicyActionDefinition,
} from './security';

const db = vi.hoisted(() => ({
  MFA_MODES: ['off', 'optional', 'required_all', 'required_roles'] as const,
  SECURITY_LIMITS: {
    mfaGraceDays: { min: 0, max: 30 },
    passwordMinLength: { min: 12, max: 36 },
    lockoutThreshold: { min: 3, max: 10 },
    lockoutMinutes: { min: 5, max: 60 },
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
  mayManagePerson: vi.fn(),
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

function runtime(grants: readonly Grant[], aal: 'aal1' | 'aal2' = 'aal1', found = true) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const getClaims = vi.fn(() => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal,
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
  db.getMemberMfa.mockResolvedValue({ usesApp: true, since: new Date(1) });
  db.mayManagePerson.mockResolvedValue(true);
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

describe('own password rule and authenticator app (My profile)', () => {
  it('every member reads their own password rule and whether they use an app', async () => {
    const query = createDefineQuery(runtime([]).rt)(mySecurityQueryDefinition());
    expect(await query({})).toEqual(ok({ passwordMinLength: 16, usesApp: true }));
    expect(db.getMemberMfa).toHaveBeenCalledWith(TX, ME);
    db.passwordMinLengthForCaller.mockResolvedValue(null);
    const gone = await query({});
    expect(!gone.ok && gone.error.code).toBe('UNAUTHENTICATED');
  });
});

describe("a member's authenticator app (screen 3: user managers)", () => {
  it('the Organization Admin and the HR Manager see whether the member uses one', async () => {
    for (const role of ['tenant_admin', 'hr_manager'] as const) {
      const { rt } = runtime(forRoles(role));
      const query = createDefineQuery(rt)(memberSecurityQueryDefinition());
      expect(await query({ personId: SARA })).toEqual(ok({ usesApp: true, appSince: new Date(1) }));
    }
  });

  it('roles without user management are FORBIDDEN; out of scope 404; the manage rule FORBIDDEN', async () => {
    for (const role of ['learner', 'line_manager', 'auditor', 'training_manager'] as const) {
      const { rt } = runtime(forRoles(role));
      const list = await createDefineQuery(rt)(memberSecurityQueryDefinition())({ personId: SARA });
      expect(!list.ok && list.error.code, role).toBe('FORBIDDEN');
    }
    const outOfScope = runtime(forRoles('hr_manager'), 'aal1', false);
    const missing = await createDefineQuery(outOfScope.rt)(memberSecurityQueryDefinition())({
      personId: SARA,
    });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    // An HR Manager on a member with a privileged role (only the Organization Admin manages them).
    db.mayManagePerson.mockResolvedValue(false);
    const { rt } = runtime(forRoles('hr_manager'));
    const denied = await createDefineQuery(rt)(memberSecurityQueryDefinition())({ personId: SARA });
    expect(!denied.ok && denied.error.code).toBe('FORBIDDEN');
    expect(db.getMemberMfa).not.toHaveBeenCalled();
  });
});
